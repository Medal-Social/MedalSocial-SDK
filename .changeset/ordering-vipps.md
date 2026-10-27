---
"@medalsocial/sdk": minor
---

Restaurant ordering with Vipps: `ordering.orders.create()` takes `payment_method: 'vipps'` with a `return_url` and resolves `status: 'awaiting_payment'` with `payment.redirect_url`, where the guest pays. `orders.status()` now carries `payment: { method, state }`, and `OrderingPaymentState` gains `failed`. `OrderingRefusalCode` gains `PAYMENT_UNAVAILABLE` and `RETURN_URL_NOT_ALLOWED`; `MedalErrorCode` also gains `PAYMENT_PROVIDER_UNAVAILABLE`, `PAYMENT_UNAVAILABLE` and `RETURN_URL_NOT_ALLOWED`.
