---
"@medalsocial/sdk": minor
---

`EmailStatus` gains `not_opted_in`: an address nobody has asked or objected for, which receives no marketing e-mail. The Medal API has accepted and returned it on contact create, update, import and the `email_status` list filter since September 2026; the SDK type and OpenAPI contract now say so, so a site can store an enquiry as `not_opted_in` and tell it apart from an explicit `unsubscribed`.
