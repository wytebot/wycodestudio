# WyCode Admin

Separate mobile-first administration app for WyCode Market. It uses the same Firebase project and Firestore database as the Market app.

## Pages
- Sellers Lab: all listed products with sales, account-level seller star ratings, product-level review counts, syntax audits, Suggested, and an admin-only Special Sales toggle.
- Appeals: approve/reject one-time seller appeals.
- Reports: inspect seller-account report totals/reasons; reports accumulate per seller account and 50 unique buyer reports trigger the ban flow.
- Sellers: inspect seller status, account-level ratings, reports and balances.

## Security
Set `ADMIN_UIDS` to the Firebase Auth UIDs allowed to use the Admin app. The backend rejects every other account. Do not rely on hiding the admin UI for security.

## Gmail
The appeal decision is added to `emailQueue`. `/api/email-worker` sends queued decisions through Gmail API. The worker intentionally batches pending mail so 50 pending decisions process as 15, 15, then 20 on successive cron runs.

Required variables are in `.env.example`.


## Current marketplace flow
- Admin uses Google sign-in plus the server-side `ADMIN_UIDS` allowlist.
- Only a verified buyer of the exact product can submit one review per product and one seller report per seller account. A buyer can edit that existing review but cannot create a second review for the same product.
- Seller star rating is account-level and is shown across that seller's products. Product `ratingCount` is the number of reviews for that individual product.
- Seller reports are account-level. Each buyer can report a seller once; the 50th unique buyer report bans the seller account and the seller's listed products.
- Payment verification and Flutterwave processing are centralized in Wytelab; this Admin app does not require Flutterwave credentials. Seller balances shown here are marketplace ledger data.
- Seller source archives remain in seller-controlled Google Drive. Static code audits read the ZIP and store only audit metadata/errors.

## Vercel deployment
Deploy this directory as its own Vercel project with Root Directory set to the repository root, Framework Preset Vite, Build Command `npm run build`, and Output Directory `dist`.

### Vercel project settings
- Root Directory: repository root (`./`)
- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install --no-audit --no-fund`

## Vercel deployment isolation
Deploy this directory as its **own Vercel project**. Do not deploy it as a second root inside the Market Vercel project. Set Root Directory to `./`, Framework Preset to Vite, Build Command to `npm run build`, and Output Directory to `dist`. If a previously deployed URL still shows WyCode Market, open the Vercel deployment's **Source/Commit** and confirm it is this Admin repository; then redeploy this project. The HTML is configured with `Cache-Control: no-store` so stale HTML is not retained after a new deployment.

## Authentication
Admin access uses Google sign-in only. The backend also requires the Firebase token to have `google.com` as its sign-in provider and then checks `ADMIN_UIDS`.

## Troubleshooting "Loading admin data…"
The Admin screen now shows the real error with Retry / Sign out buttons instead of loading forever. Typical causes:
- `ADMIN_UIDS` missing or not containing your Firebase UID (the error message prints the UID to paste in).
- `FIREBASE_SERVICE_ACCOUNT_JSON` missing or from a different Firebase project than `wycoder`.
- `/api/*` not deployed (check Vercel function logs). After changing env vars, redeploy.
