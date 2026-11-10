---
'@medalsocial/booking': minor
'@medalsocial/sdk': minor
---

Reserve with Google referral. Google appends `rwg_token` to its Book link; the wizard now keeps it for the tab (`sessionStorage` key `medal:booking:rwg`, 30 days, no cookie) and sends it with the booking as `googleReferral`, and `POST <api>/create` forwards it to Medal Social as `google_referral: { rwg_token, captured_at }` so the conversion is reported server-side. The referral is outside the idempotency key and is part of the stored submission, so a resend carries the same body; a malformed one is dropped and the booking goes ahead. `@medalsocial/booking/core` exports `captureGoogleReferral`, `readGoogleReferral` and `GoogleReferral`. `@medalsocial/sdk`: `CreateBookingInput.google_referral` and the `BookingGoogleReferralInput` type (also in the OpenAPI document). A site needs no change beyond the upgrade.
