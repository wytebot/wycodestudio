# WyCode Studio v1.0.5

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

## Deployment

Vercel settings:
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: **none required for this Studio frontend**

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
- Google Drive file ID metadata
- Orders and customers dashboard views
- Revenue/paid-order metrics
- Firestore error handling and empty states

## Security boundary

The Studio frontend must never contain Flutterwave secret keys, Google Drive service-account credentials, or payment-verification secrets. The frontend only stores a Drive file ID as product metadata.

Before accepting real purchases, implement the shared server-side backend for:
1. Flutterwave payment verification.
2. Order creation after verified payment.
3. Short-lived download tokens.
4. Private Google Drive file retrieval/streaming.
5. Download authorization and rate limiting.

Never expose raw private Google Drive download URLs to buyers.
