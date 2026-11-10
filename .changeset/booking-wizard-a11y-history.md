---
'@medalsocial/booking': minor
---

Wizard accessibility, history and a one-person flow. All new behaviour is opt-in except the history entries, which only change what the browser's back button does inside the wizard.

- **Browser back walks the steps.** The wizard pushes one history entry per step the visitor moves forward to (`history.pushState`, URL unchanged, the step under `medalBookingStep` in `history.state` beside the router's own fields) and answers `popstate` by going to that step when the machine allows it — answers kept. The arrival entry is tagged with the opening step, so back from there leaves the page; going back inside the wizard walks history back instead of adding entries; the booked screen walks history back to the arrival entry so back never reopens a sent form. Deep links (`?tjeneste=`, `?frisor=`, `?kategori=`) are untouched.
- **`party.skipWhoStep`** (default `false`, needs `party.maxPeople: 1`): no «who» step. A guest starts on the service step, the header/crumbs count three steps, and the desktop panel drops its «who» row. A logged-in parent with saved people is still asked; one with nobody saved books for themselves.
- **`?kategori=`** now scrolls the service list to the linked group when the step opens (once, and not for the first group).
- **Singular/plural counts:** optional labels `who.party.count.one` / `.other`, `who.party.adultCount.one` / `.other` (the «who» steppers) and `people.children.one` (summary and panel). Without them the plain keys read for every number, as before.
- **`priceFormat`** (default `'unit'`, «699 kr»): `'dash'` writes NOK prices as «699,-» / «1 860,-» everywhere the package writes a price. Other currencies are unaffected.
