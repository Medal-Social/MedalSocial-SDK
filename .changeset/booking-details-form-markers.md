---
'@medalsocial/booking': minor
---

The details step says which fields must be filled in. The built-in `nb` and `en` packs carry meda 3.17's four form labels: `details.required` («(må fylles ut)» / «(required)») and `details.optional` («(valgfritt)» / «(optional)») are drawn after each field's label and are part of its accessible name, `details.terms.error` is shown under an unticked terms box when submit is pressed, and `details.error.nameRequired` is the message for a blank required name. A site whose own labels already end in «(valgfritt)» should drop that from the label, or set `details.optional` to an empty string. Needs `@medalsocial/meda` 3.17; peer range `^3.17.0`.
