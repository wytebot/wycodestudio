import {google} from 'googleapis';
import admin from 'firebase-admin';
import {Readable} from 'node:stream';

const ADMIN_EMAILS = ['frenemy566@gmail.com'];
// Fallback only — set GOOGLE_DRIVE_FOLDER_ID in your Vercel project env vars.
const DEFAULT_FOLDER_ID = '1l9mlgRZgiNwhC5H0moM-4AQiGRSqnb_o';
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
function getDrive() {
  if (driveClient) return driveClient;
  const raw = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (!raw) { const e = new Error('Google Drive upload is temporarily unavailable. Please check the production Drive configuration.'); e.status = 503; throw e; }
  let sa; try { sa = JSON.parse(raw.replace(/\n/g, "\n")); } catch { throw new Error("Google Drive configuration is invalid."); }
  const auth = new google.auth.GoogleAuth({ credentials: sa, scopes: ['https://www.googleapis.com/auth/drive'] });
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
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
    const kind = b.kind === 'cover' ? 'cover' : 'source';
    const dataBase64 = String(b.dataBase64 || '');
    if (!filename || !dataBase64) return json(res, 400, { error: 'filename and dataBase64 are required' });
    if (kind === 'cover' && !/^image\//i.test(mimeType)) return json(res, 400, { error: 'Cover uploads must be image files.' });

    const buffer = Buffer.from(dataBase64, 'base64');
    if (!buffer.length) return json(res, 400, { error: 'File is empty' });
    const maxBytes = kind === 'cover' ? MAX_COVER_BYTES : MAX_SOURCE_BYTES;
    if (buffer.length > maxBytes) return json(res, 413, { error: kind === 'cover' ? 'Cover image is too large for direct upload. Please use an image under 2 MB.' : 'Source archive is too large for direct upload. Please use a ZIP under 3 MB or upload it to Drive manually and paste the file ID instead.' });

    const folderId = String(process.env.GOOGLE_DRIVE_FOLDER_ID || DEFAULT_FOLDER_ID).trim();
    const drive = getDrive();
    const created = await drive.files.create({
      requestBody: { name: filename, parents: [folderId] },
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id,name,size,mimeType,webViewLink',
      supportsAllDrives: true
    });
    const fileId = created.data.id;
    let viewUrl = '';
    if (kind === 'cover' && fileId) {
      await drive.permissions.create({
        fileId,
        requestBody: { type: 'anyone', role: 'reader' },
        supportsAllDrives: true
      });
      viewUrl = `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}`;
    }
    json(res, 200, { fileId, name: created.data.name, size: created.data.size || buffer.length, kind, viewUrl, downloadUrl: fileId ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}` : '' });
  } catch (e) {
    const msg = e?.errors?.[0]?.message || e.message || 'Upload failed';
    json(res, e.status && e.status < 500 ? e.status : (e.code === 'auth/id-token-expired' ? 401 : 500), { error: msg });
  }
}
