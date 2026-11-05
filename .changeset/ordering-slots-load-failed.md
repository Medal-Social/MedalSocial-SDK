---
'@medalsocial/ordering': patch
---

Checkout: a failed slot load no longer reads as a fully booked day. When `loadSlots` rejects, the time picker says the free times could not be loaded (`slotsFailed`) and offers «Prøv igjen» (`slotsRetry`) to read the day again; «Ingen ledige tider denne dagen» (`noSlots`) is kept for an answer with no times.
