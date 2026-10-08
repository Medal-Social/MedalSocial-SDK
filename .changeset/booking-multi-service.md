---
"@medalsocial/booking": minor
---

Several services per person as one visit: the wizard machine holds a person's extra services, the site routes take `extra_service_ids` on availability, schedule and stylists and `extraServiceIds` on create, and `useBooking()` fetches, seats, submits, stashes and confirms the whole visit. New hook actions `toggleServiceFor(index, service)` and `continueFromService()` are ready for a multi-select service screen.

`<BookingWizard>` draws meda 3.5's multi-select service step when `party.maxServicesPerPerson` is above `1`: each person ticks up to that many services, the step's own bar shows the visit's total, and «Neste» moves on once everyone has one. The default is `1`, the one-tap step every site has today. The meda peer is now `^3.5.0`.
