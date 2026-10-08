---
"@medalsocial/sdk": minor
---

Book one person several services as one visit: `bookings.create` items take `extra_service_ids`, `bookings.availability` and `bookings.schedule` take `extra_service_ids` (slots and last starts then cover the whole visit), and `Booking` carries the visit's `services` lines (`BookingVisitService`, `null` for a one-service booking).
