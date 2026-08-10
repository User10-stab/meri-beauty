# Critical business and security tests

## Commands

```bash
npm test
npm run test:critical
npm run audit:prod
```

- `npm test` runs the existing payment-decision tests and the critical regression suite.
- `npm run test:critical` runs only the security/business regression suite.
- `npm run audit:prod` runs the production dependency audit, lint, all tests, and the production build.

`audit:prod` needs the same environment and database connectivity as a production build. Never point automated tests at the production database.

## Reports and issue logging

Every critical run writes:

- `test-results/critical.xml`: JUnit report for CI dashboards and test annotations.
- `test-results/critical.json`: detailed machine-readable failures, stack traces, names, and durations.

The `test-results` directory is intentionally ignored by Git. GitHub Actions uploads it as the `critical-test-results` artifact even when tests fail.

A failed assertion exits with a non-zero status, causing the CI job and pull request check to fail. The report identifies the affected security or business contract by name.

## Covered contracts

- Stripe webhook signature verification and idempotency.
- Underpayment detection and refund paths.
- Stock reservation, sale, and release.
- Cart and product row locking during concurrent checkout.
- Workshop and formation capacity row locks.
- Return processing locks, duplicate processing prevention, and credit limits.
- Waiting-list ownership and one-time conversion.
- Role/permission policy boundaries.
- Atomic invoice numbering, VAT calculation, and credit-note limits.
- Appointment, workshop, and formation reminder deduplication.
- Password-reset token consumption and session-version invalidation.

## Test levels and limitations

The suite has two layers:

1. Behavioral unit tests execute pure financial and authorization logic with isolated transaction mocks.
2. Security contract tests inspect critical production modules and fail if required locks, ownership checks, idempotency keys, or deduplication markers are removed.

These tests never call Stripe, Resend, or the production database. They are fast and safe for every pull request, but they do not replace staging integration tests. Before release, run sandbox tests against a disposable migrated database and Stripe test mode for full webhook replay and real concurrency verification.
