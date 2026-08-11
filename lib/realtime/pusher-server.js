/**
 * Server-side Pusher integration for realtime dashboard notifications.
 *
 * Design rules (from project_memory.md + task brief):
 *   - Customers NEVER receive dashboard/in-app notifications. Events are
 *     silently skipped when the target userId resolves to a CUSTOMER role.
 *   - Only ADMIN / OWNER / STAFF (dashboard users) receive push events.
 *   - The Prisma Notification model is the source of truth — this module
 *     only fans out already-persisted rows, it never creates data.
 *   - Pusher failures are logged but never re-thrown: a realtime transport
 *     outage must not block the business transaction that created the
 *     notification (users can still refresh the page).
 *   - Private channels only: every dashboard user gets their own
 *     `private-user-{userId}` channel. The auth endpoint validates that
 *     a socket can only subscribe to its own userId channel.
 *
 * Usage:
 *   import { triggerNotificationEvent } from "@/lib/realtime/pusher-server";
 *   await triggerNotificationEvent(userId, "notification:created", { notification });
 */

import Pusher from "pusher";
import { prisma } from "@/lib/prisma";
import { canAccessDashboard } from "@/lib/authorization";
import { userChannelName } from "./pusher-server-shared";

export { userChannelName };

let pusherSingleton = null;
let configWarned = false;

function getPusherClient() {
  if (pusherSingleton) return pusherSingleton;

  const {
    PUSHER_APP_ID,
    PUSHER_KEY,
    PUSHER_SECRET,
    PUSHER_CLUSTER,
  } = process.env;

  if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET || !PUSHER_CLUSTER) {
    if (!configWarned) {
      configWarned = true;
      console.warn(
        "[pusher] Realtime désactivé — variables manquantes dans .env :\n" +
          `  PUSHER_APP_ID     : ${PUSHER_APP_ID ? "OK" : "MANQUANTE"}\n` +
          `  PUSHER_KEY        : ${PUSHER_KEY ? "OK" : "MANQUANTE"}\n` +
          `  PUSHER_SECRET     : ${PUSHER_SECRET ? "OK" : "MANQUANTE"}\n` +
          `  PUSHER_CLUSTER    : ${PUSHER_CLUSTER || "MANQUANTE"}`
      );
    }
    return null;
  }

  pusherSingleton = new Pusher({
    appId: PUSHER_APP_ID,
    key: PUSHER_KEY,
    secret: PUSHER_SECRET,
    cluster: PUSHER_CLUSTER,
    useTLS: true,
    timeout: 5000,
  });

  return pusherSingleton;
}

const eligibilityCache = new Map();
const ELIGIBILITY_TTL_MS = 30_000;

async function isEligibleUser(userId) {
  if (!userId || typeof userId !== "string") return false;

  const now = Date.now();
  const cached = eligibilityCache.get(userId);
  if (cached && now - cached.ts < ELIGIBILITY_TTL_MS) {
    return cached.eligible;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isActive: true, isDeleted: true },
    });

    const eligible = Boolean(
      user &&
      !user.isDeleted &&
      user.isActive &&
      canAccessDashboard(user.role)
    );

    eligibilityCache.set(userId, { eligible, ts: now });
    return eligible;
  } catch (err) {
    console.error(`[pusher] isEligibleUser DB error for userId=${userId}:`, err?.message ?? err);
    return false;
  }
}

/**
 * Trigger a notification lifecycle event on the recipient's private channel.
 *
 * Safe no-op behavior:
 *   - Pusher env vars missing → silently skip (log once).
 *   - userId is a customer / inactive / deleted → silently skip.
 *   - Pusher network errors → console.error, promise resolves (no throw).
 */
export async function triggerNotificationEvent(userId, eventName, data) {
  try {
    if (!userId || typeof userId !== "string") return;

    const eligible = await isEligibleUser(userId);
    if (!eligible) {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          `[pusher] event=${eventName} SKIPPED — userId=${userId} non éligible (CUSTOMER / inactif / supprimé).`
        );
      }
      return;
    }

    const pusher = getPusherClient();
    if (!pusher) return;

    const channel = userChannelName(userId);

    if (process.env.NODE_ENV === "development") {
      const type = data?.notification?.type ?? "n/a";
      console.log(
        `[pusher] ➜ trigger event=${eventName} channel=${channel} notifType=${type}`
      );
    }

    await pusher.trigger(channel, eventName, data ?? {});
  } catch (err) {
    console.error(
      `[pusher] ❌ trigger FAIL event=${eventName} userId=${userId}: ${err?.message ?? err}`
    );
  }
}

/**
 * Authenticate a private-channel subscribe request.
 *
 * Called exclusively from /api/pusher/auth/route.js. Validates:
 *   1. The caller is authenticated (NextAuth session).
 *   2. The caller has a dashboard role (customers are 403'd even with a session).
 *   3. The requested channel is exactly `private-user-${session.user.id}` —
 *      Alice cannot subscribe to Bob's channel.
 */
export function buildPrivateChannelAuth(pusherInstance) {
  return function authorizePrivateChannel({ socketId, channelName, session }) {
    if (!socketId || typeof socketId !== "string") {
      const err = new Error("FORBIDDEN: missing socket_id");
      err.status = 403;
      throw err;
    }
    if (!channelName || typeof channelName !== "string") {
      const err = new Error("FORBIDDEN: missing channel_name");
      err.status = 403;
      throw err;
    }
    if (!session?.user?.id) {
      const err = new Error("UNAUTHORIZED: no session");
      err.status = 401;
      throw err;
    }
    if (!canAccessDashboard(session.user.role)) {
      const err = new Error(`FORBIDDEN: role=${session.user.role} n'a pas accès au dashboard`);
      err.status = 403;
      throw err;
    }

    const expectedChannel = userChannelName(session.user.id);
    if (channelName !== expectedChannel) {
      const err = new Error(
        `FORBIDDEN: channel ${channelName} n'appartient pas à l'utilisateur ${session.user.id}`
      );
      err.status = 403;
      throw err;
    }

    const client = pusherInstance ?? getPusherClient();
    if (!client) {
      const err = new Error("PUSHER_UNCONFIGURED");
      err.status = 503;
      throw err;
    }

    return client.authenticate(socketId, channelName);
  };
}
