---
"@medalsocial/ordering": patch
---

`Checkout` sends a delivery price that was already due when it arrived (a device clock running ahead of Medal's, or a short validity) as it is, and lets Medal decide. Before, every press of the order button asked for a new price, so a guest with a fast clock could never place a delivery order. A `QUOTE_EXPIRED` from Medal still asks for a new price for the guest to accept.
