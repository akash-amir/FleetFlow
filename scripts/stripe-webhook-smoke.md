# Manual Stripe webhook testing

A real end-to-end Checkout flow needs a browser (to complete the hosted
payment page), so this is the manual-testing path for the webhook side on
its own, using the [Stripe CLI](https://stripe.com/docs/stripe-cli).

## 1. Forward events to your local server

```
stripe listen --forward-to localhost:3000/api/v1/payments/webhook
```

This prints a webhook signing secret (`whsec_...`) the first time you run
it — put that in `.env` as `STRIPE_WEBHOOK_SECRET` and restart the app.
Leave this command running in its own terminal; it stays connected and
forwards every event Stripe would otherwise send to a real public URL.

## 2. Trigger a synthetic event

In a second terminal, with the app running:

```
stripe trigger checkout.session.completed
```

## What to expect

**In the `stripe listen` terminal:** a line showing the event was received
and forwarded, followed by the HTTP status your server returned — `200`
for a successfully processed (or successfully ignored) event.

**In the app's own log:** `StripeWebhookService` doesn't log on the happy
path (only on a signature failure or a malformed/unresolvable session), so
silence here is success. If the triggered session's metadata doesn't
reference a real invoice id in your database (likely, since `stripe
trigger` fabricates its own test data), you'll see a logged error like:

```
checkout.session.completed cs_test_... references invoice <n>, which does not exist
```

That's expected and correct — the handler is supposed to log and 200 on a
session it can't resolve, not crash or retry-loop. To see the full
success path (a payment row created, invoice status updated, `invoice.paid`
emitted), create a real invoice first via the API, then create a real
Checkout Session for it through `POST
/api/v1/portal/invoices/:id/checkout-session` and complete payment on the
hosted page Stripe gives you back — `stripe trigger` alone only proves the
webhook plumbing (signature verification, idempotency, routing), not the
full flow against real application data.

**In Prisma Studio** (`npx prisma studio`), after a run against a real
invoice: a new `Payment` row with `method: "stripe"` and a
`stripePaymentIntentId`, the `Invoice.status` updated (and `paidAt` set if
it reached `paid`), and a new `ProcessedWebhookEvent` row for the event's id.

## Re-running the same event

`stripe trigger` fabricates a new `event.id` every time — to actually
exercise the idempotency path, resend the identical delivery instead of
triggering a new one. The Stripe CLI's dashboard (or `stripe events resend
<event_id>`) redelivers the same event id; a second delivery should produce
no new `Payment` or `ProcessedWebhookEvent` row and no second `invoice.paid`
emission.
