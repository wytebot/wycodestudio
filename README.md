# WyCode Studio v1.1.6

Private admin dashboard for the WyCode source-code marketplace.

## Firebase configuration

The supplied Firebase Web SDK configuration is hardcoded in `src/main.jsx` as requested. **No Firebase `VITE_*` environment variables are required.**

Configured Firebase project:
- Project: `wycoder`
- Auth domain: `wycoder.firebaseapp.com`
- Storage bucket: `wycoder.firebasestorage.app`
- Sender ID: `610749661041`
- App ID: `1:610749661041:web:37daf5af5946838914c0d0`
- Analytics ID: `G-RT3WRQPBL3`

Admin allowlist is also hardcoded to `frenemy566@gmail.com`.

## Firebase Console setup

1. Enable Authentication → Google.
2. Create/enable Firestore Database.
3. Add the deployed Vercel domain to Firebase Authentication → Settings → Authorized domains.
4. Publish `firestore.rules.example` as your production Firestore rules.
5. Firebase Storage is **not required** for this Studio. Product files and cover images are uploaded to Google Drive instead.

## Cover images

The product form's "Cover image" field uploads the selected image directly to the configured Google Drive folder. The API makes cover images readable by anyone with the generated image URL and stores that URL in Firestore. No Firebase Storage bucket is used for covers.

## File uploads (api/upload.js)

Adding a product now has an "Add file" box that uploads the selected file straight into your shared Google Drive folder and fills in the resulting Drive file ID automatically — no more copying IDs by hand.

Setup required in your Vercel project (Settings → Environment Variables), see `.env.example`:
- `GOOGLE_DRIVE_OAUTH_CLIENT_ID` — OAuth 2.0 client ID from Google Cloud.
- `GOOGLE_DRIVE_OAUTH_CLIENT_SECRET` — OAuth 2.0 client secret from the same client. Server-side only.
- `GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN` — long-lived OAuth refresh token for the permitted Studio owner Google account. Server-side only; never expose it as a `VITE_*` variable.
- `GOOGLE_DRIVE_FOLDER_ID` — destination folder for product source ZIP files. Normal covers and special covers use their dedicated fixed Drive folders.

Notes:
- The upload endpoint verifies the admin's Firebase sign-in token server-side before touching Drive — no extra login step is needed in the Studio UI.
- Drive access uses OAuth 2.0 on behalf of the permitted owner Google account, so files are stored in that account's Drive instead of relying on a service-account storage quota. The API also checks the connected Drive account email before uploading.
- Direct uploads are intentionally capped below Vercel Hobby request-body limits. For larger source zips, upload directly to Drive and paste the file ID into the "Google Drive file ID" field; the manual override remains supported.

## Drive connection test

The Settings page includes a **Test connection** button. It authenticates the current Studio admin session, checks the server-side Google OAuth refresh token, verifies the connected Drive account, and reports configuration/authentication/folder-access problems without exposing OAuth secrets to the browser.

## Deployment

Vercel settings:
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: only needed for file uploads — see above. The frontend itself needs none.
- Node.js version: 22.x (pinned via `package.json` engines — required by `firebase-admin`)

Local:
```bash
npm install
npm run dev
```

## Current functionality

- Google admin sign-in
- Admin allowlist enforcement
- Product create/edit/delete
- Product search
- Product status/category/version/pricing metadata
- Direct file upload to Google Drive, with manual Drive file ID override
- Direct cover image picker (Google Drive), no manual URL entry
- Normal vs. special sale type, with a special-sale banner image field
- Orders and customers dashboard views
- Revenue/paid-order metrics
- Firestore error handling and empty states

## Security boundary

The Studio frontend bundle must never contain Flutterwave secret keys, Google OAuth client secrets, Google Drive refresh tokens, or payment-verification secrets. Those live only in server-side Vercel environment variables and `api/upload.js` — the browser only ever sees the admin's own Firebase sign-in token and the resulting Drive file ID.

Before accepting real purchases, implement the shared server-side backend for:
1. Flutterwave payment verification.
2. Order creation after verified payment.
3. Short-lived download tokens.
4. Private Google Drive file retrieval/streaming.
5. Download authorization and rate limiting.

(WyCode Market already implements all five of the above.)

Never expose raw private Google Drive download URLs to buyers.



## Production upload limits
Direct source ZIP uploads are limited to 3 MB and cover images to 2 MB to leave headroom for Base64 request overhead. Larger source archives should be uploaded to the configured Google Drive folder and their file ID pasted into the product form.

### Google Drive upload routing
- Source ZIP (`kind: source`) → `GOOGLE_DRIVE_FOLDER_ID` from Vercel.
- Normal cover (`kind: cover`) → `1l9mlgRZgiNwhC5H0moM-4AQiGRSqnb_o`.
- Special cover (`kind: special-cover`) → `1cbtAwTafxCKtaT8SzjW-0XCo66J4hQ5T`.

The frontend pickers send these exact `kind` values to `/api/upload`; the API rejects unknown kinds instead of silently treating them as source uploads.

## Google Drive OAuth 2.0 setup (Option B — personal Google Drive)

This build no longer requires a Google service account. It uses a server-side OAuth refresh token belonging to the permitted Studio owner account (`frenemy566@gmail.com`).

### 1. Create an OAuth client in Google Cloud
1. Open Google Cloud Console and select the project used for the Drive integration.
2. Enable **Google Drive API**.
3. Configure the OAuth consent screen. If the app is **External** and still in Testing, add the permitted owner Google account as a test user.
4. Create an **OAuth client ID**. A Desktop app client is the simplest choice when generating a refresh token manually.

### 2. Generate a refresh token
Use a trusted OAuth 2.0 authorization flow/tool with the same OAuth client, requesting the scope:
`https://www.googleapis.com/auth/drive`

The authorization must be completed while signed in as the permitted owner account. Request offline access so Google returns a refresh token. Keep the refresh token private.

If using Google's OAuth 2.0 Playground, configure it to use your own OAuth client credentials, authorize the Drive scope, exchange the authorization code for tokens, and copy the returned **refresh token**.

### 3. Add these Vercel Production variables
- `GOOGLE_DRIVE_OAUTH_CLIENT_ID` = OAuth client ID
- `GOOGLE_DRIVE_OAUTH_CLIENT_SECRET` = OAuth client secret
- `GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN` = refresh token
- `GOOGLE_DRIVE_FOLDER_ID` = source ZIP destination folder ID

Do **not** prefix these with `VITE_`. Do not put the refresh token or client secret in `src/main.jsx`.

### 4. Folder permissions
The source, normal-cover, and special-cover folders must be accessible by the Google account that owns the refresh token. For a personal Drive folder owned by that account, no service-account sharing is required.

### 5. Redeploy and test
After saving the Production variables, redeploy the Studio. Sign in with the allowed Studio admin account, upload a small ZIP, and verify the file appears in the configured Drive folder. The API checks the OAuth-connected Drive email before performing the upload, so accidentally using another Google account produces a clear error instead of silently storing files in the wrong Drive.

### OAuth troubleshooting
- **`MISSING_GOOGLE_OAUTH`**: one or more of the three OAuth variables is missing in Vercel Production.
- **`DRIVE_AUTH_FAILED`**: the client credentials or refresh token is invalid/revoked. Generate a new refresh token and redeploy.
- **`DRIVE_ACCOUNT_MISMATCH`**: the refresh token belongs to a different Google account than the Studio owner.
- **`DRIVE_FOLDER_PERMISSION`**: the connected Google account cannot edit the destination folder.
- **`DRIVE_QUOTA`**: the connected Google Drive is out of storage/quota.

The refresh token is long-lived but can be revoked by Google or by changing the account's security/consent state. If that happens, generate a replacement refresh token and update the Vercel variable.
