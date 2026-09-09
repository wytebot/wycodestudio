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
5. Enable Firebase Storage and publish `storage.rules.example` as your production Storage rules (needed for the cover image picker below — public read, admin-only write).

## Cover images

The product form's "Cover image" field is a direct picker — no URL typing. Selecting an image uploads it straight to Firebase Storage (client-side, using the admin's existing sign-in) and stores the resulting public download URL as the product's `coverUrl`. Recommended size: **800×400px** (2:1) — matches how covers are cropped on the storefront cards. Requires Firebase Storage to be enabled and `storage.rules.example` published (see above); no new environment variables needed for this one, since it doesn't go through the API — just Firebase directly.

## File uploads (api/upload.js)

Adding a product now has an "Add file" box that uploads the selected file straight into your shared Google Drive folder and fills in the resulting Drive file ID automatically — no more copying IDs by hand.

Setup required in your Vercel project (Settings → Environment Variables), see `.env.example`:
- `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` — a Google Cloud service account key (JSON) with Editor access. Share your Drive folder with the service account's `client_email`.
- `GOOGLE_DRIVE_FOLDER_ID` — destination folder for uploads. Defaults to `1sywZa56KKtJE0HMoKuCzBdloD_7b-1e-` if unset.

Notes:
- The upload endpoint verifies the admin's Firebase sign-in token server-side before touching Drive — no extra login step needed in the UI.
- Vercel serverless functions cap request bodies around ~4.5MB on the Hobby plan. For larger source zips, upload directly to Drive yourself and paste the file ID into the "Google Drive file ID" field instead — it still works as a manual override.

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
- Direct cover image picker (Firebase Storage), no manual URL entry
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

