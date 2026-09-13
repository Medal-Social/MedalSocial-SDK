---
"@medalsocial/sdk": patch
---

Fix `gdpr.cookieConsent()` sending a body the API rejects.

Through 1.10.0 the method was typed with a `consentStatus` / `consentTimestamp` / `cookiePreferences` body. `POST /api/cookie-consent` has never accepted that shape — called exactly as typed, it answered `400 Invalid event`. The unit test only asserted that `domain` survived serialisation, a field both shapes share, so the drift never showed.

`CookieConsentInput` is now the endpoint's real contract: `event` (`preferences_saved` | `preferences_revoked` | `banner_displayed` | `preferences_expired`), `consentId`, `domain`, a flat `categories` object of booleans (`essential`, `analytics`, `marketing`, `functional`), plus optional `visitorId`, `ipAddress`, `userAgent`, `consentText`, `policyVersion` and a numeric `timestamp`. The return type is the new `CookieConsentResult`. `CookieConsentEvent`, `CookieConsentCategories` and `CookieConsentResult` are exported; `CookieCategoryConsent` is kept but deprecated — it only ever described the shape that did not work.

Also fixed: `MedalApiError` now carries the message from routes that answer `{ success: false, error: "why" }` rather than the `/api/v1/` `{ error: { code, message } }` envelope. Those previously surfaced as `HTTP 403: Error`, so a caller could not tell an unowned domain from a bad key.

The Pilot `recordCookieConsent` tool schema and the README example move to the same shape, and a new test compares the serialised request against a fixture replayed through the endpoint's own validator, so the two cannot drift apart again silently.

Typed as a patch because the old shape could not succeed against the API; any call written to it was already failing.
