import fs from "fs";
import path from "path";
import { describe, expect, test, vi } from "vitest";
import {
  allocateOrderTicketNumber,
  allocatePaymentTicketNumber,
} from "@/lib/tickets/allocate-ticket-number";

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const allocator = source("lib/tickets/allocate-ticket-number.js");
const activityKindModule = source("lib/activities/activity-kind.js");
const pieceNumberModule = source("lib/cash-book/piece-number.js");
const ticketDocument = source("lib/pdf/TicketDocument.jsx");

describe("lib/tickets/allocate-ticket-number.js — the shared global ticket sequence", () => {
  test("exports the two allocators and the format helper", () => {
    expect(allocator).toContain(
      "export async function allocateOrderTicketNumber(tx, orderId, now = new Date(), isStaffActor = false)"
    );
    expect(allocator).toContain("export async function allocatePaymentTicketNumber(");
    expect(allocator).toContain("export function formatTicketNumber(year, seq)");
  });

  test("uses its own counter-key namespace, distinct from invoicing and the cash book", () => {
    expect(allocator).toContain("`TICKET-${ticketYear(now)}`");
  });

  test("there is one ticket series only — the never-used staff TS- series is gone", () => {
    expect(allocator).not.toContain("TICKET-STAFF");
    expect(allocator).not.toContain('"TS"');
  });

  test("reuses the same atomic upsert as invoicing/piece-number — no separate retry logic", () => {
    expect(allocator).toContain('INSERT INTO "NumberingCounter"');
    expect(allocator).toContain('ON CONFLICT ("key") DO UPDATE SET "lastNumber" = "NumberingCounter"."lastNumber" + 1');
  });

  test("is idempotent — checks for an existing ticketNumber before allocating", () => {
    expect(allocator).toContain("if (current?.ticketNumber) return current.ticketNumber;");
  });

  test("Workshop vs Event disambiguation goes through the single shared activityKind() helper", () => {
    // Relative, not "@/..." — this module is imported directly by
    // scripts/backfill-ticket-numbers.mjs under plain `node`, which has no
    // "@/" alias resolution (see the module's own import comment).
    expect(allocator).toContain('import { activityKind } from "../activities/activity-kind.js"');
    expect(allocator).toContain('kind === "WORKSHOP" ? activityKind(activityType) : kind');
  });
});

describe("lib/activities/activity-kind.js is the one place Workshop/Event is decided", () => {
  test("piece-number.js and the ticket allocator both import it rather than keeping their own ternary", () => {
    expect(pieceNumberModule).toContain('import { activityKind } from "@/lib/activities/activity-kind"');
    expect(pieceNumberModule).toContain("PIECE_SERIES[activityKind(activityType)]");
    expect(allocator).toContain('import { activityKind } from "../activities/activity-kind.js"');
    expect(activityKindModule).toContain('return activityType === "EVENT" ? "EVENT" : "WORKSHOP";');
  });
});

describe("every hook point that settles a sale allocates a ticket number", () => {
  // Staff-reachable call sites pass a resolved isStaffActor flag (offTill /
  // offTillActor — see isTillCashOperator) so a non-privileged staff sale
  // gets no salon ticket; the remaining sites have no staff
  // actor at all (customer self-checkout / Stripe webhook) and are
  // deliberately left on the two-argument, admin-series default.
  const cases = [
    ["actions/boutique/point-of-sale.js", "allocateOrderTicketNumber(tx, order.id, new Date(), offTill)"],
    ["lib/orders/fulfill-order-payment.js", "allocateOrderTicketNumber(tx, order.id, new Date(), isStaffActor)"],
    ["actions/boutique/orders.js", "allocateOrderTicketNumber(tx, order.id, new Date(), offTill)"],
    ["lib/workshops/fulfill-workshop-reservation-payment.js", 'allocatePaymentTicketNumber(tx, payment.id, "WORKSHOP"'],
    ["lib/formations/fulfill-formation-reservation-payment.js", 'allocatePaymentTicketNumber(tx, payment.id, "FORMATION")'],
    ["app/api/webhooks/stripe/route.js", 'allocatePaymentTicketNumber(tx, paymentId, "APPOINTMENT")'],
    ["actions/reservation/create-reservation.js", 'allocatePaymentTicketNumber(tx, paymentId, "APPOINTMENT")'],
    ["actions/counter/create-reservation.js", "allocatePaymentTicketNumber("],
    ["lib/reservations/settle-reservation.js", "allocatePaymentTicketNumber(tx, payment.id, kind, activityType, new Date(), offTill)"],
    ["actions/appointment/manage-appointment.js", 'allocatePaymentTicketNumber(tx, updatedPayment.id, "APPOINTMENT", null, new Date(), offTill)'],
  ];

  test.each(cases)("%s calls the shared allocator", (file, expectedSnippet) => {
    expect(source(file)).toContain(expectedSnippet);
  });

  test("actions/counter/create-reservation.js passes offTill for the staff series, whitespace notwithstanding", () => {
    const code = source("actions/counter/create-reservation.js").replace(/\s+/g, " ");
    expect(code).toContain(
      'allocatePaymentTicketNumber( tx, payment.id, data.kind, data.kind === "WORKSHOP" ? catalogue.type : null, new Date(), offTill'
    );
  });

  test("settle-reservation.js allocates on the no-balance-due branch, the balance-due branch, and no-show", () => {
    const code = source("lib/reservations/settle-reservation.js");
    expect(code).toContain("allocatePaymentTicketNumber(tx, payment.id, kind, activityType, new Date(), offTill)");
    expect(code).toContain("allocatePaymentTicketNumber(tx, updatedPayment.id, kind, activityType, new Date(), offTill)");
    expect(code).toContain("allocatePaymentTicketNumber(tx, payment.id, kind, activityType, new Date(), offTillActor)");
  });

  test("manage-appointment.js also tickets a kept no-show deposit, on its own offTillActor", () => {
    const code = source("actions/appointment/manage-appointment.js");
    expect(code).toContain('allocatePaymentTicketNumber(tx, noShowPayment.id, "APPOINTMENT", null, new Date(), offTillActor)');
  });

  // 25/09/2026: or to canUseSalonTill, which starts from isTillCashOperator
  // and adds a staff member granted CAISSE.
  test("every staff-reachable site's isStaffActor traces back to the till predicate, not a bare role check", () => {
    for (const file of [
      "actions/boutique/point-of-sale.js",
      "actions/boutique/orders.js",
      "actions/counter/create-reservation.js",
      "lib/reservations/settle-reservation.js",
      "actions/appointment/manage-appointment.js",
    ]) {
      expect(source(file)).toMatch(/isTillCashOperator|canUseSalonTill/);
    }
  });
});

// 16/09/2026 — every practitioner at Meri Beauty is legally independent, with
// her own VAT number. A sale she collects is hers to document; the salon
// issues nothing for it. `isStaffActor` was already resolved at every call
// site as `!isTillCashOperator(actor)`, so the ADMIN account and Marie
// Mercier (STAFF role, salon VAT number) arrive here as false and are
// ticketed exactly as before — which is the half worth testing, because it
// is the half a future refactor would quietly break.
describe("a non-privileged staff actor gets no ticket number at all", () => {
  const MAY = new Date("2026-05-04T10:00:00Z");

  function txMock({ existing = null, next = 7, payeeStaffId = null } = {}) {
    return {
      order: {
        findUnique: vi.fn(() => Promise.resolve({ ticketNumber: existing })),
        update: vi.fn(() => Promise.resolve({})),
      },
      payment: {
        findUnique: vi.fn(() => Promise.resolve({ ticketNumber: existing, payeeStaffId })),
        update: vi.fn(() => Promise.resolve({})),
      },
      $queryRaw: vi.fn(() => Promise.resolve([{ lastNumber: next }])),
    };
  }

  test("allocateOrderTicketNumber returns null and burns no number", async () => {
    const tx = txMock();
    await expect(allocateOrderTicketNumber(tx, "order_1", MAY, true)).resolves.toBeNull();
    // Not merely "no number returned": the counter must not advance and the
    // row must not be stamped, or the gapless series grows silent holes.
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  test("allocatePaymentTicketNumber returns null and burns no number", async () => {
    const tx = txMock();
    await expect(
      allocatePaymentTicketNumber(tx, "pay_1", "APPOINTMENT", null, MAY, true)
    ).resolves.toBeNull();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  test("the salon's own accounts still get one, on the ordinary T- series", async () => {
    const orderTx = txMock({ next: 7 });
    await expect(allocateOrderTicketNumber(orderTx, "order_1", MAY, false)).resolves.toBe("T-2026-000007");
    expect(orderTx.order.update).toHaveBeenCalled();

    const paymentTx = txMock({ next: 8 });
    await expect(
      allocatePaymentTicketNumber(paymentTx, "pay_1", "APPOINTMENT", null, MAY, false)
    ).resolves.toBe("T-2026-000008");
    expect(paymentTx.payment.update).toHaveBeenCalled();
  });

  test("the guard runs before the idempotency check, so a pre-existing number is not handed back either", async () => {
    // The salon never allocated one for her sale; anything already on the row
    // would predate this rule, and returning it would put the salon's
    // letterhead back on an independent's receipt.
    const tx = txMock({ existing: "T-2026-000003" });
    await expect(allocateOrderTicketNumber(tx, "order_1", MAY, true)).resolves.toBeNull();
    expect(tx.order.findUnique).not.toHaveBeenCalled();
  });

  // 17/09/2026 — whose sale it is, not who clicked. The admin or Marie
  // settling Julie's appointment used to put the salon's ticket on it.
  test("an independent's payment gets no ticket even when the salon settles it", async () => {
    const tx = txMock({ payeeStaffId: "s_julie" });
    await expect(
      allocatePaymentTicketNumber(tx, "pay_1", "APPOINTMENT", null, MAY, false)
    ).resolves.toBeNull();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  test("a stale number on her payment is not handed back either", async () => {
    const tx = txMock({ payeeStaffId: "s_julie", existing: "T-2026-000035" });
    await expect(
      allocatePaymentTicketNumber(tx, "pay_1", "APPOINTMENT", null, MAY, false)
    ).resolves.toBeNull();
  });
});

describe("TicketDocument no longer synthesizes an identity at render time", () => {
  test("the T-C-<orderNumber> fallback string is gone", () => {
    expect(ticketDocument).not.toContain("`T-C-${ticket.orderNumber}`");
  });

  test("ticketNumber is read straight off the ticket object", () => {
    expect(ticketDocument).toContain("const ticketNumber = ticket.ticketNumber;");
  });
});


// 16/09/2026 — both ticket scripts silently wrote to the wrong database.
// `import` is hoisted and evaluated before any statement in a module body,
// and @prisma/client loads `.env` into process.env as it initialises; dotenv
// refuses to overwrite a variable that is already set. So the obvious
// spelling — dotenv first in the import list, `config(...)` underneath — has
// no effect whatsoever, and the script uses `.env` even though `.env.local`
// overrides it everywhere else in this app. Nothing about it looks wrong at
// runtime: it connects, it reports, it writes. It just renumbers the wrong
// rows. These contracts pin the three moving parts.
describe("a maintenance script cannot silently pick the wrong database", () => {
  const resolver = source("scripts/resolve-database-url.mjs");
  const SCRIPTS = ["scripts/backfill-ticket-numbers.mjs", "scripts/renumber-tickets-2026.mjs"];

  test("the resolver snapshots the caller's DATABASE_URL at module load", () => {
    // Read any later and it is indistinguishable from the value Prisma put
    // there — which is the whole bug.
    expect(resolver).toContain("const CALLER_URL = process.env.DATABASE_URL;");
    // The files are parsed directly, never read back out of process.env.
    expect(resolver).toContain('for (const file of [".env.local", ".env"])');
    expect(resolver).toContain("dotenv.parse(readFileSync(file))");
  });

  test.each(SCRIPTS)("%s imports the resolver BEFORE @prisma/client", (path) => {
    const code = source(path);
    const resolverAt = code.indexOf('from "./resolve-database-url.mjs"');
    const prismaAt = code.indexOf('from "@prisma/client"');
    expect(resolverAt, "does not use the shared resolver").toBeGreaterThan(-1);
    expect(prismaAt).toBeGreaterThan(-1);
    // Import order is evaluation order. Swap these two lines and the
    // snapshot above captures Prisma's own value instead of the caller's.
    expect(resolverAt, "resolver must be imported first").toBeLessThan(prismaAt);
  });

  test.each(SCRIPTS)("%s hands the resolved url to PrismaClient explicitly", (path) => {
    const code = source(path);
    expect(code).toMatch(/new PrismaClient\(\{\s*datasources: \{ db: \{ url/);
    // A bare `new PrismaClient()` re-reads the polluted process.env and
    // throws the whole resolution away.
    expect(code).not.toMatch(/new PrismaClient\(\s*\)/);
  });

  test.each(SCRIPTS)("%s no longer calls dotenv config() below its imports", (path) => {
    expect(source(path)).not.toContain('config({ path: [".env.local", ".env"]');
  });

  test.each(SCRIPTS)("%s prints the target, and where it came from", (path) => {
    const code = source(path);
    expect(code).toContain("describeTarget(");
    expect(code).toMatch(/source\s*:?\s*\$\{(DATABASE_URL_SOURCE|from)\}/);
  });
});

// 15/09/2026: the backfill had never actually been runnable on the server it
// exists for. It is ESM (.mjs) importing lib/tickets/allocate-ticket-number.js,
// a `.js` in a package with no "type" — CommonJS to Node's resolver. Node
// >= 22.7 (a dev machine) detects the ESM syntax and reparses; production's
// Node 20.16 does not, and dies with "Named export 'allocateOrderTicketNumber'
// not found". Both scripts that reach into lib/ this way must therefore ship a
// runner carrying --experimental-detect-module, or they are dev-only toys.
describe("the lib-importing scripts stay runnable on production's Node", () => {
  const pkg = JSON.parse(source("package.json"));

  test.each([
    ["backfill:tickets", "scripts/backfill-ticket-numbers.mjs"],
    ["audit:refund-states", "scripts/audit-refund-states.mjs"],
  ])("npm run %s passes the flag that Node 20 needs", (name, scriptPath) => {
    const command = pkg.scripts[name];
    expect(command, `package.json has no "${name}" script`).toBeDefined();
    expect(command).toContain("--experimental-detect-module");
    expect(command).toContain(scriptPath);
  });

  test("every .mjs script that imports from lib/ has a runner in package.json", () => {
    const runners = Object.values(pkg.scripts).join("\n");
    const scripts = fs.readdirSync(path.join(process.cwd(), "scripts")).filter((f) => f.endsWith(".mjs"));
    const importingLib = scripts.filter((f) => /from "\.\.\/lib\//.test(source(`scripts/${f}`)));
    // Guards against a third one being added later without a runner — which
    // is exactly how these two went unnoticed until someone tried prod.
    expect(importingLib.length).toBeGreaterThan(0);
    for (const file of importingLib) {
      expect(runners, `scripts/${file} imports lib/ but no npm script runs it`).toContain(`scripts/${file}`);
    }
  });
});
