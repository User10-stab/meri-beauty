import { config } from "dotenv";
import { assertSafeMoneyTestEnv } from "./env-guard.mjs";
import { createRunId, publishRunId } from "./run-id.mjs";

/**
 * Runs once, before any browser starts.
 *
 * Order matters: the environment is loaded and vetted before a run id is
 * minted, so an unsafe configuration aborts without having created anything
 * at all.
 */
export default async function globalSetup() {
  // Match Next.js precedence, exactly as scripts/dev-with-stripe-webhooks.mjs
  // does — .env.local overrides .env.
  config({ path: [".env.local", ".env"], quiet: true });

  assertSafeMoneyTestEnv();

  const runId = createRunId();
  publishRunId(runId);

  // Printed rather than logged quietly: this is the string the operator needs
  // to purge the run afterwards, and the one to filter by in the Stripe
  // dashboard. Losing it means hunting rows by timestamp.
  console.log("");
  console.log("  ┌─────────────────────────────────────────────────────────────");
  console.log(`  │  money e2e run id : ${runId}`);
  console.log(`  │  purge afterwards : node scripts/purge-e2e-money-data.mjs --run ${runId}`);
  console.log("  │");
  console.log("  │  Requires `npm run dev:stripe` (NOT plain `npm run dev`) —");
  console.log("  │  without the Stripe CLI listener no webhook arrives and");
  console.log("  │  nothing ever settles.");
  console.log("  └─────────────────────────────────────────────────────────────");
  console.log("");
}
