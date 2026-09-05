---
"@medalsocial/sdk": minor
---

Add `medal.portal.*` for customer-portal sessions: e-mail code login (`login.start`/`login.verify`), `me`/`updateMe`, `myBookings`, `exportMyData`, `deleteMe`, `logout`. Session-bound calls send the `X-Portal-Session` header; `RequestOptions.headers` is now supported on every verb.
