---
'@medalsocial/booking': minor
---

`details.emailRequired` (default `false`): a site whose confirmation and reminder go out by e-mail only can make the address required. The details step passes meda's `emailRequired` to `DetailsScreen` (the field is `required` and a blank address is refused on submit with the new `details.email.required` label, nb + en in the built-in packs), the wizard's `canAdvance` holds the details step without a valid address (`canAdvance` / `canGoToStep` take an optional `StepRules` argument; `createWizard` binds the rule from the config), and `POST <api>/create` answers 400 `invalidInput` (`contact.email is required`) without one. Needs `@medalsocial/meda` with `DetailsScreen`'s `emailRequired`.
