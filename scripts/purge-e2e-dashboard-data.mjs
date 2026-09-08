import { config } from "dotenv";
import { publishRunId } from "../tests/e2e-money/fixtures/run-id.mjs";
import { assertSafeMoneyTestEnv } from "../tests/e2e-money/fixtures/env-guard.mjs";
import { purgeDashboardRun } from "../tests/e2e-dashboard/fixtures/seed-dashboard.mjs";
import { prisma, disconnect } from "../tests/e2e-money/fixtures/db.mjs";

/**
 * Removes the rows one dashboard e2e run created.
 *
 * Same contract as purge-e2e-money-data.mjs — by hand, never from an afterAll
 * hook, dry by default — with one difference: this one *does* delete its
 * invoice. The dashboard suite issues its appointment invoice with a number
 * outside the legal series ("E2E-<run>-RDV"), precisely so that proving an
 * access check does not consume a number out of a sequence that must stay
 * gapless. Nothing is preserved by keeping it.
 *
 *   node scripts/purge-e2e-dashboard-data.mjs --run e2e-20260905-abc123
 *   node scripts/purge-e2e-dashboard-data.mjs --run e2e-20260905-abc123 --apply
 */

config({ path: [".env.local", ".env"], quiet: true });

const args = process.argv.slice(2);
const runId = args[args.indexOf("--run") + 1];
const apply = args.includes("--apply");

if (!args.includes("--run") || !runId || runId.startsWith("--")) {
  console.error("Usage: node scripts/purge-e2e-dashboard-data.mjs --run <runId> [--apply]");
  process.exit(1);
}
if (!runId.startsWith("e2e-")) {
  console.error(`Refusing: "${runId}" is not an e2e run id (they start with "e2e-").`);
  process.exit(1);
}

assertSafeMoneyTestEnv(process.env, { requireMailpit: false });
publishRunId(runId);

const users = await prisma.user.findMany({
  where: { email: { contains: runId } },
  select: { id: true, email: true, role: true },
});
const invoices = await prisma.invoice.findMany({
  where: { number: { contains: runId } },
  select: { number: true },
});

/**
 * Refuse a run id that belongs to the money suite.
 *
 * Both suites tag rows with the same `e2e-<stamp>-<rand>` shape, so a
 * loosely-built list of run ids picks up both — which is exactly what
 * happened once. Nothing was lost (Transaction_paymentId_fkey is RESTRICT and
 * aborted the delete), but relying on a foreign key to be the safety net is
 * luck, not design: this script still does not understand workshop
 * reservations and would delete their customers out from under them if the
 * database let it. (Formation reservations are handled — see
 * purgeDashboardRun's formation block.)
 *
 * A dashboard run always seeds at least one `e2e+staff.` or `e2e+admin.`
 * account, an
 * `e2e-<run>` product, or an `E2E-<run>` invoice. A money run never does.
 */
const dashboardShaped =
  users.some((user) => user.email.startsWith("e2e+staff.") || user.email.startsWith("e2e+admin.")) ||
  invoices.length > 0 ||
  (await prisma.product.count({ where: { slug: { contains: runId } } })) > 0;

if (users.length > 0 && !dashboardShaped) {
  console.error(
    `Refusing: run ${runId} has ${users.length} tagged user(s) but none of the rows a dashboard run ` +
      "creates (no e2e+staff. account, no e2e product, no E2E- invoice).\n\n" +
      "That shape belongs to the money suite. Use scripts/purge-e2e-money-data.mjs instead — this " +
      "script does not know about workshop or formation reservations and must not delete their customers.",
  );
  await disconnect();
  process.exit(1);
}

console.log(`Run ${runId}`);
console.log(`  users    : ${users.length} (${users.filter((u) => u.role === "STAFF").length} staff)`);
console.log(`  invoices : ${invoices.length} (${invoices.map((i) => i.number).join(", ") || "none"})`);

if (users.length === 0 && invoices.length === 0) {
  console.log("\nNothing found for that run id.");
  await disconnect();
  process.exit(0);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to delete.");
  await disconnect();
  process.exit(0);
}

const result = await purgeDashboardRun(runId);
console.log("\nDeleted:", result.deleted);
await disconnect();
