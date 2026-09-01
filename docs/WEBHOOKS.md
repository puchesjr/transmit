# Transmit outbound webhooks

Transmit sends three event types from the Postgres outbox:

- `contact.created`
- `message.received`
- `opportunity.stage_changed`

Add an HTTPS endpoint under Settings → Lead capture. The signing secret is shown
once. Store it as a secret; Transmit stores only a short hint in normal settings
responses.

## Request contract

Every delivery is an HTTP `POST` with a JSON envelope:

```json
{
  "id": "019...",
  "type": "contact.created",
  "createdAt": "2026-08-31T20:00:00.000Z",
  "accountId": "019...",
  "locationId": "019...",
  "data": {}
}
```

Headers include:

```text
X-Transmit-Id: <event id>
X-Transmit-Event: <event type>
X-Transmit-Timestamp: <Unix timestamp in seconds>
X-Transmit-Signature: v1=<lowercase HMAC-SHA256 hex>
```

The signed bytes are:

```text
<timestamp>.<exact raw request body>
```

Do not parse and re-serialize the JSON before verification. A Node consumer can
verify the signature with only built-in modules:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyTransmitWebhook(
  rawBody: string,
  timestamp: string,
  signature: string,
  secret: string
): boolean {
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

  const expected = `v1=${createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')}`;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signature);
  return expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes);
}
```

Use the event ID as your idempotency key and reject timestamps older than five
minutes. Return any `2xx` response only after safely accepting the event.

## Delivery behavior

Non-`2xx` responses and network failures are retried with exponential backoff,
capped at five minutes, for up to eight attempts. Redirects are not followed.
Endpoints must use public HTTPS URLs; literal and resolved private or reserved
network addresses are rejected. Recent delivery state is visible in Lead capture
settings.
