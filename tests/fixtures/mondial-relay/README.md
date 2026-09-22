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

## Blocage actuel : aucun plan de tri sur le compte (code 10055)

- `prod-no-sorting-plan-24r.xml` — the rejection that currently prevents
  *any* label from being created, captured 2026-09-22 against production.

  Diagnosed by varying one parameter at a time, always with the nonexistent
  pickup point `000000000` so no variant could ever create a real shipment:

  | variante | résultat |
  | --- | --- |
  | collecte `CCC` / livraison `24R` | 10055 plan de tri introuvable |
  | collecte `REL` / livraison `24R` | 10055 — **identique**, donc le mode de collecte n'est pas en cause |
  | collecte `CCC` / livraison `24L` | 10024 « Le produit de livraison n'est pas autorisé (24L) » |
  | destination BE 1090 / 1000 / 7800 | 10055 à chaque fois |
  | destination FR 59000 | 10055 — **la Belgique n'est pas en cause** |
  | expéditeur FR → destination BE | 10055 — le pays d'expédition n'est pas en cause non plus |
  | `CustomerId` = `41` / `CC` / `CC22` | 10066 « Aucun droit » — donc `CC229KZ2` est bien le bon identifiant |
  | `CustomerId` = `BE-CC229KZ2` | 10002 configuration invalide |
  | + `<Content>` (description colis) | 10055 — identique |
  | + `<InsuranceValue>` (valeur du contenu) | 10055 — identique |
  | + `<CustomerNo>` (référence client) | 10055 — identique |

  Comparaison avec le formulaire manuel du portail Connect (« Créer une
  expédition ») : plusieurs champs qu'il affiche (Adresse Ligne 2, téléphone
  secondaire, Libellé, Référence Client, Valeur du contenu, Contenu,
  Assurance) ne sont pas envoyés par `lib/mondial-relay.js`. Trois d'entre eux
  ont été testés ci-dessus et ne changent rien — la requête atteint le même
  point de blocage avec ou sans eux. Conclusion : la différence de champs
  entre le formulaire et l'API n'explique pas le 10055.

  What this rules out: the pickup point (the `10025` warning shows `Location`
  is *ignored* outright, and the sorting-plan lookup still runs), the
  collection mode, the destination country, the postal code, and our own
  request format — a `24L` request gets a *different, specific* rejection,
  which proves Mondial Relay parses and evaluates our fields correctly.

  What it leaves: `24R` **is** authorized on the account (it passes the
  product-authorization gate that `24L` fails), but **no sorting plan is
  configured for it, for any destination**. That is an operational
  provisioning state on Mondial Relay's side, not something fixable in code.

  Useful consequence while it lasts: no label can be created at all, so the
  production credentials cannot accidentally incur a charge.

## Suivi de colis (API1 / WSI2 SOAP) — vérifié de bout en bout

- `prod-tracing-unknown-shipment.xml` — real response from the **production**
  WSI2 endpoint (`api.mondialrelay.com/WebService.asmx`,
  `WSI2_TracingColisDetaille`) for a deliberately nonexistent shipment number
  (`00000000`), so nothing real was touched. Tracing is a read-only query and
  cannot create or bill anything.

  Captured 2026-09-22 alongside a **differential** check that settles what the
  status code actually means — same bogus shipment, three credential sets:

  | credentials | `STAT` |
  | --- | --- |
  | real (Enseigne `CC229KZ2` + real private key) | `99` |
  | wrong private key | `97` |
  | wrong Enseigne | `1` |

  Because a bad signature returns `97` and a bad Enseigne returns `1`, the
  `99` obtained with the real pair proves **the MD5 signing scheme and the
  credentials are both correct** — `99` means "this shipment is unknown",
  not "authentication failed". This is the ground truth behind `STAT_MESSAGES`
  in `lib/mondial-relay-tracking.js`.

  Note this is a *different* API and credential pair from the label creation
  above: API1/SOAP (Enseigne + private key) does point search and tracing,
  API2/REST (Login + Password + CustomerId) creates shipments. Only shipment
  creation was retired on API1.

**Still open:** a genuine *successful* creation has never been observed, so
the B1 question (does a real success ever carry a non-`"Warning"` `Level`,
which the current filter would misreport as a failure) is still unverified.
Resolving it safely needs either working sandbox Connect API V2.0
credentials (same portal, look for a "VOS PARAMÈTRES DE TEST" block with
Login/Password/CustomerId — not the Enseigne/private-key one already found),
or the user's explicit go-ahead to buy one real, supervised prod label as
the actual pilot step (test plan section 5) — not something to do
incidentally while probing.
