# WyCode Admin

Separate mobile-first administration app for WyCode Market. It uses the same Firebase project and Firestore database as the Market app.

## Pages
- Sellers Lab: published/listed products with sales, star rating and an admin-only Special Sales toggle.
- Appeals: approve/reject one-time seller appeals.
- Reports: inspect report volume and reasons.
- Sellers: inspect seller status, reports and balances.

## Security
Set `ADMIN_UIDS` to the Firebase Auth UIDs allowed to use the Admin app. The backend rejects every other account. Do not rely on hiding the admin UI for security.

## Gmail
The appeal decision is added to `emailQueue`. `/api/email-worker` sends queued decisions through Gmail API. The worker intentionally batches pending mail so 50 pending decisions process as 15, 15, then 20 on successive cron runs.

Required variables are in `.env.example`.


## Hardened marketplace flow
- Buyers use Firebase Anonymous Auth; completed orders are bound to the anonymous UID.
- Checkout, payment verification, authorization and download require that buyer UID.
- Only a verified buyer of the exact product can submit one review per product and one seller report per seller.
- Seller balances are credited only after server-side Flutterwave verification.
- Automatic seller payouts release USD balance in $50 thresholds when valid bank details exist; provider status is recorded as submitted/pending/failed.
- Seller source archives remain in seller-controlled Google Drive. Static code audits read the ZIP and store only audit metadata/errors.
