---
"@medalsocial/sdk": minor
---

Portal families and confirmed Vipps linking (Medal Bookings SP10).

- `medal.portal.persons.create(session, input)`, `.update(session, person_id, patch)` and `.remove(session, person_id)` edit the signed-in customer's children by id (`POST`/`PATCH`/`DELETE /api/v1/portal/me/persons[/{person_id}]`), so a rename keeps the `person_id`. The bound scope gains `createPerson`, `updatePerson` and `removePerson`.
- `medal.portal.login.vipps.verifyLink({ link, code, browser_binding? })` confirms a pending link after the callback answered `?vipps=confirm_email` (`POST /api/v1/portal/vipps/link/verify`) and returns a `PortalSessionResponse`. New error code `VIPPS_IDENTITY_CONFLICT`; the callback's query string is typed as `PortalVippsCallbackParams` / `PortalVippsCallbackOutcome` (`confirm_email`, `cancelled`, `needs_email_login`, `failed`), and `vipps.start` accepts an optional `browser_binding` and `locale` (for the confirmation e-mail); `ContactPerson` (staff persons API) gains `birth_month` and `preferred_resource_id`.
- New read fields: `PortalPerson.birth_month` / `preferred_resource_id`; `family` entries are now `PortalFamilyEntry` with `person_id` / `birth_month` (the `PortalFamilyMember` write shape accepts both so a read can be echoed back); `PortalBooking.booked_for_person_id` / `booked_for_birth_year` / `booked_for_birth_month`; `Booking.booked_for_birth_month`; `BookingService.age_min_years` / `age_max_years`; `PortalSession.expires_at_iso`.
