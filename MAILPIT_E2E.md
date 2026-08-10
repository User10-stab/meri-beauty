# Mailpit inbox for guest-checkout E2E

Mailpit is for local development and staging only. It receives e-mails without sending anything to real inboxes.

## Start the inbox

```bash
docker compose -f docker-compose.mailpit.yml up -d
```

Set the Mailpit variables shown in `.env.example`, then restart the application. Open `http://127.0.0.1:8025` to inspect messages.

## Use in an E2E checkout

1. Submit the normal guest checkout or reservation with a unique test address.
2. Read the verification URL without changing the database:

```bash
node scripts/e2e/get-mailpit-verification-link.mjs customer@example.test
```

3. Open that URL, complete the checkout, then run the normal payment/refund assertions.

Never set `EMAIL_PROVIDER=mailpit` in production. The application refuses Mailpit when `NODE_ENV=production`.
