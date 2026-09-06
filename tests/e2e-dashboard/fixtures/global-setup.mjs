import { config } from "dotenv";
import { assertSafeMoneyTestEnv } from "../../e2e-money/fixtures/env-guard.mjs";
import { createRunId, publishRunId } from "../../e2e-money/fixtures/run-id.mjs";

/**
 * Same shape as the money suite's, and deliberately the same guard.
 *
 * This suite charges nothing, so the sk_test_ rail is not strictly load-
 * bearing here — but the other three are. It writes to the dev database
 * (which holds real customer rows) and several of the flows it drives send
 * e-mail. Reusing the guard whole means there is one definition of "safe to
 * run destructive-ish tests against", rather than a second, weaker one that
 * drifts.
 */
export default async function globalSetup() {
  config({ path: [".env.local", ".env"], quiet: true });

  assertSafeMoneyTestEnv();

  const runId = createRunId();
  publishRunId(runId);

  console.log("");
  console.log("  ┌─────────────────────────────────────────────────────────────");
  console.log(`  │  dashboard e2e run id : ${runId}`);
  console.log(`  │  purge afterwards     : node scripts/purge-e2e-dashboard-data.mjs --run ${runId}`);
  console.log("  │");
  console.log("  │  No money is moved. Rows are seeded and left behind on");
  console.log("  │  purpose — a suite that tidies up after itself destroys the");
  console.log("  │  evidence needed to read a failure.");
  console.log("  └─────────────────────────────────────────────────────────────");
  console.log("");
}
