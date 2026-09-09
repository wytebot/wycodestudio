import {google} from 'googleapis';
import admin from 'firebase-admin';
import {Readable} from 'node:stream';

const ADMIN_EMAILS = ['frenemy566@gmail.com'];
// Fallback only — set GOOGLE_DRIVE_FOLDER_ID in your Vercel project env vars.
const DEFAULT_FOLDER_ID = '1sywZa56KKtJE0HMoKuCzBdloD_7b-1e-';
const MAX_BYTES = 25 * 1024 * 1024; // 25MB — Vercel serverless functions cap request bodies around ~4.5MB on Hobby plans; raise your plan/body limit if you need bigger source zips.

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
  if (!raw) throw new Error('Missing GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON');
  const sa = JSON.parse(raw);
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
    const dataBase64 = String(b.dataBase64 || '');
    if (!filename || !dataBase64) return json(res, 400, { error: 'filename and dataBase64 are required' });

    const buffer = Buffer.from(dataBase64, 'base64');
    if (!buffer.length) return json(res, 400, { error: 'File is empty' });
    if (buffer.length > MAX_BYTES) return json(res, 413, { error: 'File is too large for direct upload. Upload it to Drive manually and paste the file ID instead.' });

    const folderId = String(process.env.GOOGLE_DRIVE_FOLDER_ID || DEFAULT_FOLDER_ID).trim();
    const drive = getDrive();
    const created = await drive.files.create({
      requestBody: { name: filename, parents: [folderId] },
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id,name,size',
      supportsAllDrives: true
    });
    json(res, 200, { fileId: created.data.id, name: created.data.name, size: created.data.size || buffer.length });
  } catch (e) {
    const msg = e?.errors?.[0]?.message || e.message || 'Upload failed';
    json(res, e.status && e.status < 500 ? e.status : (e.code === 'auth/id-token-expired' ? 401 : 500), { error: msg });
  }
}
