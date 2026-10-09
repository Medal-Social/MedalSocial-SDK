---
"@medalsocial/booking": patch
---

A login whose profile could not be read no longer falls back to the parent the page arrived as: the family list goes, and the name, phone and e-mail that parent's profile filled in are cleared, so the next parent never books with the previous account's details. A field the visitor changed stays theirs, even typed back to the profile's value. The children's seats that login let go keep their ids out of sight, so a parent who then logs in with a readable profile gets their own child back (by id only); anyone else keeps a blank chair.
