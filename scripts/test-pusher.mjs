/**
 * Quick diagnostic: verify the server-side Pusher client can reach Pusher.
 *
 * Run with:
 *   node scripts/test-pusher.mjs <dashboard-user-id>
 *
 * What it does:
 *   1. Loads .env (same as Next.js) and prints PUSHER_* env status.
 *   2. Does an eligibility check on the given user id.
 *   3. Sends a synthetic `notification:created` event on that user's
 *      private channel via Pusher. If the Pusher API call fails, it
 *      prints the full error with code / http status.
 *
 * If you do not have a dashboard user id handy, pick one via:
 *   psql $DATABASE_URL -c "SELECT id, email, role FROM \"User\" WHERE role IN ('ADMIN','OWNER','STAFF') LIMIT 1;"
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import Pusher from "pusher";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, "..", ".env") });

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: node scripts/test-pusher.mjs <dashboard-user-id>");
  process.exit(1);
}

const {
  PUSHER_APP_ID,
  PUSHER_KEY,
  PUSHER_SECRET,
  PUSHER_CLUSTER,
} = process.env;

console.log("=== Env ===");
console.log("PUSHER_APP_ID     :", PUSHER_APP_ID ? "set (len=" + PUSHER_APP_ID.length + ")" : "MISSING");
console.log("PUSHER_KEY        :", PUSHER_KEY ? "set (len=" + PUSHER_KEY.length + ")" : "MISSING");
console.log("PUSHER_SECRET     :", PUSHER_SECRET ? "set (len=" + PUSHER_SECRET.length + ")" : "MISSING");
console.log("PUSHER_CLUSTER    :", PUSHER_CLUSTER || "MISSING");

if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET || !PUSHER_CLUSTER) {
  console.error("\n❌ One or more required PUSHER_* env vars are missing.");
  process.exit(1);
}

console.log("\n=== User eligibility ===");
const prisma = new PrismaClient();
const user = await prisma.user.findUnique({
  where: { id: userId },
  select: { id: true, email: true, role: true, isActive: true, isDeleted: true },
});
if (!user) {
  console.error(`❌ No user found with id=${userId}`);
  await prisma.$disconnect();
  process.exit(1);
}
console.log("User:", JSON.stringify(user, null, 2));
const DASHBOARD_ROLES = ["ADMIN", "OWNER", "STAFF"];
if (!user.isActive || user.isDeleted || !DASHBOARD_ROLES.includes(user.role)) {
  console.error("❌ User is NOT eligible for dashboard notifications (role or status mismatch)");
  await prisma.$disconnect();
  process.exit(1);
}
console.log("✅ User is ELIGIBLE");

console.log("\n=== Triggering test event via Pusher REST API ===");
const pusher = new Pusher({
  appId: PUSHER_APP_ID,
  key: PUSHER_KEY,
  secret: PUSHER_SECRET,
  cluster: PUSHER_CLUSTER,
  useTLS: true,
});

const channel = `private-user-${userId}`;
const testPayload = {
  notification: {
    id: "test-pusher-cuid",
    userId,
    type: "GENERAL",
    title: "Test — Pusher fonctionnel",
    message: "Si vous voyez ceci sans refresh, la chaîne fonctionne.",
    actionUrl: "/dashboard/notifications",
    appointmentId: null,
    status: "PENDING",
    isRead: false,
    sentAt: null,
    createdAt: new Date().toISOString(),
  },
};

try {
  await pusher.trigger(channel, "notification:created", testPayload);
  console.log(`✅ Pusher.trigger OK  —  event=notification:created  channel=${channel}`);
  console.log("   Aucune erreur HTTP retournée par Pusher. Si rien ne s'affiche dans le");
  console.log("   dashboard, vérifiez côté client :");
  console.log("     1. NEXT_PUBLIC_PUSHER_KEY match-t-il PUSHER_KEY ?");
  console.log("     2. NEXT_PUBLIC_PUSHER_CLUSTER = eu ?");
  console.log("     3. Onglet DevTools → Network : POST /api/pusher/auth (statut 200 ? body ?)");
  console.log("     4. Onglet DevTools → Console : y a-t-il un avertissement Pusher ?");
} catch (err) {
  console.error("❌ Pusher.trigger FAILED:");
  console.error("   message :", err.message);
  console.error("   stack   :", err.stack);
  if (err?.stack?.includes("400") || err?.message?.includes("400")) {
    console.error("\n   HTTP 400 indique souvent un APP_ID / KEY / SECRET invalide.");
  }
  if (err?.message?.includes("403") || err?.stack?.includes("403")) {
    console.error("\n   HTTP 403 indique souvent un CLUSTER incorrect ou signature erronée.");
  }
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
