---
"@medalsocial/booking": minor
---

Several services per person as one visit: the wizard machine holds a person's extra services, the site routes take `extra_service_ids` on availability, schedule and stylists and `extraServiceIds` on create, and `useBooking()` fetches, seats, submits, stashes and confirms the whole visit. New hook actions `toggleServiceFor(index, service)` and `continueFromService()` are ready for a multi-select service screen.
