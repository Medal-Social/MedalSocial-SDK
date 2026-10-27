---
"@medalsocial/booking": patch
---

Nested providers keep an inner provider's word for a grown-up: `<BookingProvider labels={mergeLabels('nb')}>` around `<BookingProvider labels={{ 'people.adult': 'Gjest' }}>` no longer numbers several guest grown-ups «Person 1», «Person 2». The adult-word check now runs where a provider merges its parent's words, before they are flattened into one layer.
