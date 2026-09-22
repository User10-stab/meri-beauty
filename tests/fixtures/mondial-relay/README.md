# Mondial Relay sandbox fixtures

Captured from real calls to `connect-api-sandbox.mondialrelay.com` (plan
section 3 — sandbox characterization). Never from production.

- `auth-rejected-sample.xml` — real response to a `ShipmentCreationRequest`
  using the credentials currently in `.env`
  (`MONDIAL_RELAY_API_LOGIN`/`_API_PASSWORD`/`_CUSTOMER_ID`). Confirms:
  `Code="10001" Level="Critical error"`, message "Login et/ou mot de passe
  non valide." **These credentials do not currently work against the
  sandbox endpoint** — every other probe (real success, unknown pickup
  point, weight limits, duplicate OrderNo, missing phone) failed at this
  same auth gate before reaching its own scenario, so none of that ground
  truth exists yet. Re-run once the credentials are confirmed/regenerated —
  see `MONDIAL_RELAY_SETUP.md` for the Connect portal generation flow.

One real, useful fact this did confirm: a genuine rejection's `Level` is
`"Critical error"`, not simply `"Error"` — the existing
`statuses.filter(s => s.level !== "Warning")` logic in `lib/mondial-relay.js`
still correctly treats this as blocking (it only special-cases `"Warning"`),
so this doesn't reveal a bug — but it's a reminder not to assume specific
non-Warning level strings anywhere else without checking a real response.

## Root cause of the sandbox auth failure

The `.env` sandbox credentials were the wrong credential *system* entirely —
Mondial Relay's portal shows two unrelated pairs on the same page: "API 1"
(Enseigne code + private key, the old retired WSI2 SOAP webservice,
`WebService.asmx`) and a separate "API 2" / Connect section (Login +
Password + CustomerId, the REST API this codebase actually implements). The
`.env` values were the WSI2 Enseigne code stuffed into the Connect API's
Login field — two different auth models, not just a wrong value.

- `prod-invalid-pickup-point.xml` — real response from the **production**
  endpoint (`connect-api.mondialrelay.com`), using the real Connect API V2.0
  prod credentials (Login/Password/CustomerId, confirmed correct — supplied
  2026-09-22), against a deliberately nonexistent pickup point ID
  (`000000000`) so this could not possibly create a real, billed shipment.
  **Confirms the prod credentials authenticate successfully** — the
  rejection is purely business-level ("Le plan de tri est introuvable…",
  Code 10055, `Level="Error"`), not an auth failure. Also shows a
  same-response mix of `Level="Warning"` (Code 10025, non-blocking) and
  `Level="Error"` (Code 10055, blocking) — confirms multiple `<Status>`
  entries can co-occur and the existing filter handles that correctly.

**Still open:** a genuine *successful* creation has never been observed, so
the B1 question (does a real success ever carry a non-`"Warning"` `Level`,
which the current filter would misreport as a failure) is still unverified.
Resolving it safely needs either working sandbox Connect API V2.0
credentials (same portal, look for a "VOS PARAMÈTRES DE TEST" block with
Login/Password/CustomerId — not the Enseigne/private-key one already found),
or the user's explicit go-ahead to buy one real, supervised prod label as
the actual pilot step (test plan section 5) — not something to do
incidentally while probing.
