# Booking scheduler contract

Kiso owns qualification, consent, conversation state, and the customer-facing
experience. The design partner's scheduler remains the source of truth for
availability and appointments.

Configure the adapter with:

```env
SCHEDULER_PROVIDER=design_partner
SCHEDULER_API_BASE_URL=https://scheduler.example.com/kiso
SCHEDULER_API_KEY=replace-me
```

The base URL must use HTTPS. Kiso sends the key only as
`Authorization: Bearer …`, applies a 15-second request timeout, and never writes
the credential into request bodies or application logs. Hold, booking, and
cancellation requests include an `Idempotency-Key` header.

## Endpoints

All endpoints accept JSON. Availability, hold, and booking responses return
JSON; a successful cancellation may return JSON or an empty `204` response.

`POST /availability` accepts location and service provider IDs, service name,
duration, timezone, and ISO `windowStart`/`windowEnd`. It returns:

```json
{
  "slots": [
    {
      "id": "slot_123",
      "startsAt": "2026-09-03T14:00:00.000Z",
      "endsAt": "2026-09-03T15:00:00.000Z",
      "timezone": "America/Chicago"
    }
  ]
}
```

`POST /holds` accepts `locationId`, `serviceId`, the selected `slot`, and the
qualified `customer`. It returns `holdId`, the same `slot`, and an ISO
`expiresAt`. Kiso cancels and rejects a hold if the returned slot differs from
the one shown to the visitor.

`POST /bookings` accepts `holdId`, `customer`, and `notes`. It returns
`bookingId` and the exact held `slot`. A mismatch is cancelled and never written
as a Kiso appointment.

`POST /cancellations` accepts either `bookingId` or `holdId`, plus `reason`.

The adapter treats non-2xx responses, malformed JSON, invalid time ranges, and
missing identifiers as failures. Customer-facing uncertainty is handed to a
human rather than converted into invented availability or a booking promise.
