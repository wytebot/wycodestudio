# WyCode Studio v1.0.9

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
- `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` — a Google Cloud service account key (JSON) with Editor access. Share your Drive folder with the service account's `client_email`.
- `GOOGLE_DRIVE_FOLDER_ID` — destination folder for uploads. Defaults to `1sywZa56KKtJE0HMoKuCzBdloD_7b-1e-` if unset.

Notes:
- The upload endpoint verifies the admin's Firebase sign-in token server-side before touching Drive — no extra login step needed in the UI.
- Direct uploads are intentionally capped below Vercel Hobby request-body limits. For larger source zips, upload directly to Drive and paste the file ID into the "Google Drive file ID" field; the manual override remains supported.

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

The Studio frontend bundle must never contain Flutterwave secret keys, Google Drive service-account credentials, or payment-verification secrets. Those live only in `api/upload.js`, which runs server-side on Vercel — the browser only ever sees the admin's own Firebase sign-in token and the resulting Drive file ID.

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
