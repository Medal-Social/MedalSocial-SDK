---
"@medalsocial/sdk": minor
---

`EmailStatus` gains `not_opted_in`: an address nobody has asked or objected for, which receives no marketing e-mail. `contacts.create`, `contacts.update` and the `email_status` filter on `contacts.list` accept it, and a contact read can return it, so a site can store an enquiry as `not_opted_in` and tell it apart from an explicit `unsubscribed`.
