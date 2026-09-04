import { config } from "dotenv";
import { publishRunId } from "../tests/e2e-money/fixtures/run-id.mjs";
import { assertSafeMoneyTestEnv } from "../tests/e2e-money/fixtures/env-guard.mjs";
import { purgeRun } from "../tests/e2e-money/fixtures/seed-money.mjs";
import { prisma, disconnect } from "../tests/e2e-money/fixtures/db.mjs";

/**
 * Removes the rows one money e2e run created.
 *
 * Run by hand, never from an afterAll hook. A test that tidies up after
 * itself destroys exactly the evidence needed to work out why it failed, and
 * the whole point of this suite is that its failures are about money.
 *
 *   node scripts/purge-e2e-money-data.mjs --run e2e-20260903-abc123
 *   node scripts/purge-e2e-money-data.mjs --run e2e-20260903-abc123 --apply
 *
 * Dry run by default. Invoices and credit notes are never deleted: their
 * numbers are gapless by law, and removing one leaves a hole that has to be
 * renumbered by hand.
 */

config({ path: [".env.local", ".env"], quiet: true });

const args = process.argv.slice(2);
const runId = args[args.indexOf("--run") + 1];
const apply = args.includes("--apply");

if (!args.includes("--run") || !runId || runId.startsWith("--")) {
  console.error("Usage: node scripts/purge-e2e-money-data.mjs --run <runId> [--apply]");
  process.exit(1);
}
if (!runId.startsWith("e2e-")) {
  console.error(`Refusing: "${runId}" is not an e2e run id (they start with "e2e-").`);
  process.exit(1);
}

// The same rails the suite itself runs behind — this deletes rows, so it has
// even less business pointing at production than the tests do. The e-mail
// check is waived: nothing here sends mail, and demanding a mail provider
// would stop an operator cleaning up from a machine that has none.
assertSafeMoneyTestEnv(process.env, { requireMailpit: false });
publishRunId(runId);

const users = await prisma.user.findMany({
  where: { email: { contains: runId } },
  select: { id: true, email: true },
});
const activities = await prisma.activity.findMany({
  where: { title: { contains: runId } },
  select: { id: true, title: true },
});

console.log(`Run ${runId}`);
console.log(`  users      : ${users.length}`);
console.log(`  activities : ${activities.length}`);

if (users.length === 0 && activities.length === 0) {
  console.log("\nNothing found for that run id.");
  await disconnect();
  process.exit(0);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to delete.");
  console.log("Invoices and credit notes will be kept in any case (gapless numbering).");
  await disconnect();
  process.exit(0);
}

const result = await purgeRun(runId);
console.log("\nDeleted:", result.deleted);
console.log("Kept: every Invoice and CreditNote, to preserve gapless numbering.");
await disconnect();
