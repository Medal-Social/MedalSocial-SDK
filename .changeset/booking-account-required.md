---
"@medalsocial/booking": minor
---

Config `account.required`: booking only for a logged-in parent; `/create` answers 401 `accountRequired` without a session and forwards the portal session to Medal; the wizard's details step becomes «Fortsett med Vipps» / «Fortsett med e-post» until the parent is logged in (the e-mail then read-only, a session lost before submit shows the login again with the time kept), and the login page shows the same two buttons.

Requires `@medalsocial/meda` ^3.5.0 (the gate's `emailCollapsed` login, `login.continueEmail`, `details.email.lockedHelp` and the `emailButton` slot).
