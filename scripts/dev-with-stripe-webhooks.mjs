import { config } from "dotenv";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

// Match Next.js precedence: machine-specific .env.local overrides .env.
config({ path: [".env.local", ".env"], quiet: true });

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) throw new Error("STRIPE_SECRET_KEY manque dans .env");
if (!secretKey.startsWith("sk_test_") && process.env.ALLOW_LIVE_STRIPE_CLI !== "1") {
  throw new Error("Refus de lancer Stripe CLI en mode live sans ALLOW_LIVE_STRIPE_CLI=1");
}

const localStripe = join(homedir(), ".local", "bin", "stripe");
const stripeCommand = process.env.STRIPE_CLI_PATH || (existsSync(localStripe) ? localStripe : "stripe");
const nextCommand = join(process.cwd(), "node_modules", ".bin", "next");

let nextProcess = null;
let lineBuffer = "";

function stop(exitCode = 0) {
  nextProcess?.kill("SIGTERM");
  stripeProcess.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 50).unref();
}

function processStripeOutput(chunk) {
  lineBuffer += chunk.toString();
  const lines = lineBuffer.split(/\r?\n/);
  lineBuffer = lines.pop() ?? "";

  for (const line of lines) {
    const webhookSecret = line.match(/whsec_[A-Za-z0-9]+/)?.[0];
    if (webhookSecret && !nextProcess) {
      console.log("[dev:stripe] listener prêt → /api/webhooks/stripe");
      nextProcess = spawn(nextCommand, ["dev"], {
        stdio: "inherit",
        env: { ...process.env, STRIPE_WEBHOOK_SECRET: webhookSecret },
      });
      nextProcess.on("exit", (code) => stop(code ?? 0));
      continue;
    }

    // Forward useful event delivery lines, while never printing the signing
    // secret emitted by Stripe CLI's initial readiness message.
    if (line && !line.includes("whsec_")) console.log(`[stripe] ${line}`);
  }
}

const stripeProcess = spawn(
  stripeCommand,
  ["listen", "--forward-to", "http://localhost:3000/api/webhooks/stripe"],
  // Passing the key with --api-key would leave it visible in the local
  // process argument list. Stripe CLI also supports STRIPE_API_KEY, which
  // keeps it out of argv while preserving its normal authentication flow.
  { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, STRIPE_API_KEY: secretKey } }
);

stripeProcess.stdout.on("data", processStripeOutput);
stripeProcess.stderr.on("data", processStripeOutput);
stripeProcess.on("error", (error) => {
  console.error(`[dev:stripe] impossible de lancer Stripe CLI: ${error.message}`);
  process.exit(1);
});
stripeProcess.on("exit", (code) => {
  if (!nextProcess) {
    console.error(`[dev:stripe] Stripe CLI s'est arrêté avant le démarrage de Next (${code ?? "inconnu"}).`);
    process.exit(code ?? 1);
  }
});

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
