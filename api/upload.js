import {google} from 'googleapis';
import admin from 'firebase-admin';
import {Readable} from 'node:stream';

const ADMIN_EMAILS = ['frenemy566@gmail.com'];
// Fallback only — set GOOGLE_DRIVE_FOLDER_ID in your Vercel project env vars.
const NORMAL_COVER_FOLDER_ID = '1l9mlgRZgiNwhC5H0moM-4AQiGRSqnb_o';
const SPECIAL_COVER_FOLDER_ID = '1cbtAwTafxCKtaT8SzjW-0XCo66J4hQ5T';
const MAX_SOURCE_BYTES = 3 * 1024 * 1024; // Base64 encoding adds overhead; keep source uploads comfortably below serverless request limits.
const MAX_COVER_BYTES = 2 * 1024 * 1024; // Keep cover uploads small enough for reliable direct browser uploads.

if (!admin.apps.length) {
  // Verifying an ID token only needs the project ID — no service account required for this.
  admin.initializeApp({ projectId: 'wycoder' });
}

function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function rawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody);
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const raw = await rawBody(req);
  try { return JSON.parse(raw.toString('utf8') || '{}'); } catch { throw new Error('Invalid JSON body'); }
}

let driveClient;

const REQUIRED_OAUTH_EMAIL = ADMIN_EMAILS[0];

function configError(message, status = 503, code = 'DRIVE_CONFIG') {
  const e = new Error(message);
  e.status = status;
  e.publicCode = code;
  return e;
}

function getDrive() {
  if (driveClient) return driveClient;

  const clientId = String(process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET || '').trim();
  const refreshToken = String(process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN || '').trim();

  if (!clientId || !clientSecret || !refreshToken) {
    throw configError(
      'Google Drive OAuth is not configured for this deployment. Add GOOGLE_DRIVE_OAUTH_CLIENT_ID, GOOGLE_DRIVE_OAUTH_CLIENT_SECRET, and GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN to the Studio Vercel Production environment, then redeploy.',
      503,
      'MISSING_GOOGLE_OAUTH'
    );
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  driveClient = google.drive({ version: 'v3', auth: oauth2 });
  return driveClient;
}

async function verifyDriveAccount(drive) {
  try {
    const about = await drive.about.get({ fields: 'user(emailAddress,displayName)' });
    const email = String(about?.data?.user?.emailAddress || '').toLowerCase();
    if (!email) {
      throw configError(
        'Google Drive OAuth connected, but Google did not return the Drive account email. Recheck the refresh token and OAuth client configuration.',
        503,
        'DRIVE_ACCOUNT_UNKNOWN'
      );
    }
    if (email !== REQUIRED_OAUTH_EMAIL.toLowerCase()) {
      throw configError(
        `The Google Drive OAuth token belongs to ${email}, but WyCode Studio only permits the owner account ${REQUIRED_OAUTH_EMAIL}. Generate the refresh token while signed in to the permitted Google account.`,
        403,
        'DRIVE_ACCOUNT_MISMATCH'
      );
    }
  } catch (e) {
    if (e?.publicCode) throw e;
    throw driveError(e, '', 'Google Drive account');
  }
}

function driveError(e, folderId, kind) {
  const status = Number(e?.code || e?.response?.status || 0);
  const reason = String(e?.errors?.[0]?.reason || '').toLowerCase();
  const rawMessage = String(e?.errors?.[0]?.message || e?.response?.data?.error?.message || e?.message || 'Unknown Google Drive error');
  if (status === 401 || /unauthenticated|invalid.*credential|invalid_grant|unauthorized/.test(rawMessage.toLowerCase())) {
    return configError('Google Drive rejected the OAuth credentials. Check GOOGLE_DRIVE_OAUTH_CLIENT_ID, GOOGLE_DRIVE_OAUTH_CLIENT_SECRET, and GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN in Studio Vercel Production, then redeploy after correcting them.', 503, 'DRIVE_AUTH_FAILED');
  }
  if (/accessnotconfigured|access not configured|api.*not.*enabled/.test(reason + ' ' + rawMessage.toLowerCase())) {
    return configError(`The Google Drive API is not enabled for the Google Cloud project used by this OAuth client. Enable Google Drive API for that project, then try again.`, 503, 'DRIVE_API_NOT_ENABLED');
  }
  if (/storagequota|storage quota|quota exceeded|dailylimit|daily limit/.test(reason + ' ' + rawMessage.toLowerCase())) {
    return configError(`Google Drive rejected the upload because the connected Google account or destination has a storage/quota limit. Free space in that Google Drive or choose a different supported Drive account, then try again.`, 503, 'DRIVE_QUOTA');
  }
  if (status === 403 || /forbidden|permission|insufficientpermissions/.test(reason + ' ' + rawMessage.toLowerCase())) {
    return configError(`Google Drive denied access to the ${kind} destination folder (${folderId}). Make sure the connected Google account has Editor access to that folder, then try again.`, 503, 'DRIVE_FOLDER_PERMISSION');
  }
  if (status === 404 || /not.?found/.test(rawMessage.toLowerCase())) {
    return configError(`Google Drive could not find the ${kind} destination folder (${folderId}). Check that the folder ID is correct and that the connected Google account can access it.`, 503, 'DRIVE_FOLDER_NOT_FOUND');
  }
  if (status === 400 && /parent|supportsAllDrives|shared drive|storage quota/.test(rawMessage.toLowerCase())) {
    return configError(`Google Drive rejected the ${kind} destination folder (${folderId}). Check the folder type, sharing, and connected Google account access. Google returned: ${rawMessage}`, 503, 'DRIVE_FOLDER_INVALID');
  }
  return configError(`Google Drive upload failed for the ${kind} destination folder (${folderId}). Google returned: ${rawMessage}`, 502, 'DRIVE_UPLOAD_FAILED');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Method not allowed' }); }
  try {
    const authHeader = String(req.headers.authorization || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return json(res, 401, { error: 'Missing sign-in token' });
    const decoded = await admin.auth().verifyIdToken(idToken);
    if (!ADMIN_EMAILS.includes(String(decoded.email || '').toLowerCase())) return json(res, 403, { error: 'Not authorized' });

    const b = await readBody(req);
    const filename = String(b.filename || '').trim();
    const mimeType = String(b.mimeType || 'application/octet-stream');
    const kind = String(b.kind || '').trim();
    if (!['source', 'cover', 'special-cover'].includes(kind)) return json(res, 400, { error: 'Invalid upload kind.' });
    const dataBase64 = String(b.dataBase64 || '');
    if (!filename || !dataBase64) return json(res, 400, { error: 'filename and dataBase64 are required' });
    if ((kind === 'cover' || kind === 'special-cover') && !/^image\//i.test(mimeType)) return json(res, 400, { error: 'Cover uploads must be image files.' });

    const buffer = Buffer.from(dataBase64, 'base64');
    if (!buffer.length) return json(res, 400, { error: 'File is empty' });
    const maxBytes = (kind === 'cover' || kind === 'special-cover') ? MAX_COVER_BYTES : MAX_SOURCE_BYTES;
    if (buffer.length > maxBytes) return json(res, 413, { error: (kind === 'cover' || kind === 'special-cover') ? 'Cover image is too large for direct upload. Please use an image under 2 MB.' : 'Source archive is too large for direct upload. Please use a ZIP under 3 MB or upload it to Drive manually and paste the file ID instead.' });

    const folderId = kind === 'source'
      ? String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim()
      : (kind === 'cover' ? NORMAL_COVER_FOLDER_ID : SPECIAL_COVER_FOLDER_ID);
    if (kind === 'source' && !folderId) return json(res, 503, { error: 'Source-file Drive destination is not configured.' });
    const drive = getDrive();
    await verifyDriveAccount(drive);
    let created;
    try {
      created = await drive.files.create({
        requestBody: { name: filename, parents: [folderId] },
        media: { mimeType, body: Readable.from(buffer) },
        fields: 'id,name,size,mimeType,webViewLink',
        supportsAllDrives: true
      });
    } catch (e) {
      throw driveError(e, folderId, kind === 'source' ? 'source-file' : kind === 'cover' ? 'normal-cover' : 'special-cover');
    }
    const fileId = created.data.id;
    let viewUrl = '';
    if ((kind === 'cover' || kind === 'special-cover') && fileId) {
      try {
        await drive.permissions.create({
          fileId,
          requestBody: { type: 'anyone', role: 'reader' },
          supportsAllDrives: true
        });
      } catch (e) {
        const status = Number(e?.code || e?.response?.status || 0);
        if (status === 403) throw configError(`The ${kind === 'cover' ? 'normal-cover' : 'special-cover'} uploaded successfully, but Google Drive would not allow its public preview permission to be created. Check that the connected Google account can change sharing on folder ${folderId}.`, 503, 'DRIVE_PREVIEW_PERMISSION');
        throw configError(`The ${kind === 'cover' ? 'normal-cover' : 'special-cover'} uploaded successfully, but Google Drive preview setup failed: ${String(e?.errors?.[0]?.message || e?.message || 'Unknown permission error')}`, 502, 'DRIVE_PREVIEW_FAILED');
      }
      viewUrl = `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}`;
    }
    json(res, 200, { fileId, name: created.data.name, size: created.data.size || buffer.length, kind, viewUrl, downloadUrl: fileId ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}` : '' });
  } catch (e) {
    const msg = e?.publicCode ? e.message : (e?.errors?.[0]?.message || e.message || 'Upload failed');
    const status = e.code === 'auth/id-token-expired' ? 401 : (e.status && e.status >= 400 && e.status < 600 ? e.status : 500);
    json(res, status, { error: msg, code: e?.publicCode || undefined });
  }
}
