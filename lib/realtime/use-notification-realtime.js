"use client";

/**
 * Client-side React hook that wires a dashboard user to their realtime
 * notification feed via Pusher.
 *
 * Channel: `private-user-{userId}`
 *
 * userId MUST be a non-empty string (typically passed from the server
 * via props, since the server already ran `auth()` and has the session).
 */

import { useEffect, useRef } from "react";
import Pusher from "pusher-js";
import { userChannelName } from "./pusher-server-shared";

const IS_DEV = process.env.NODE_ENV === "development";

let sharedPusherInstance = null;
let initDiagnosticsLogged = false;

function getSharedPusher() {
  if (typeof window === "undefined") return null;

  if (sharedPusherInstance) return sharedPusherInstance;

  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "eu";

  if (!key) {
    if (!initDiagnosticsLogged) {
      initDiagnosticsLogged = true;
      // eslint-disable-next-line no-console
      console.error(
        "%c[pusher] ERREUR CRITIQUE : NEXT_PUBLIC_PUSHER_KEY n'est pas défini côté client. " +
          "Solution : ajoutez NEXT_PUBLIC_PUSHER_KEY=\"clé\" dans .env, puis REDÉMARREZ " +
          "complètement `npm run dev` (les variables NEXT_PUBLIC_* ne sont pas lues à chaud).",
        "background:#7f1d1d;color:#fff;padding:4px 6px;border-radius:4px;"
      );
    }
    return null;
  }

  const instance = new Pusher(key, {
    cluster,
    forceTLS: true,
    enabledTransports: ["ws", "wss"],
    // pusher-js's internal usage-stats pinger reports via a JSONP transport
    // that pulls in a bundled SockJS/legacy-JSON polyfill relying on eval() —
    // blocked by our production CSP (script-src has no 'unsafe-eval', on
    // purpose). This is pure telemetry, not needed for notification
    // delivery, so disabling it removes the eval requirement entirely
    // instead of weakening the CSP.
    enableStats: false,
    channelAuthorization: {
      endpoint: "/api/pusher/auth",
    },
  });

  if (IS_DEV && !initDiagnosticsLogged) {
    initDiagnosticsLogged = true;
    instance.connection.bind("connected", () => {
      // eslint-disable-next-line no-console
      console.log(
        "%c[pusher] ✔ Connecté socket_id=" + instance.connection.socket_id,
        "background:#065f46;color:#fff;padding:2px 6px;border-radius:3px;"
      );
    });
    instance.connection.bind("error", (err) => {
      // eslint-disable-next-line no-console
      console.warn("[pusher] ⚠ Erreur de connexion :", err?.error ?? err?.message ?? err);
    });
    instance.connection.bind("disconnected", () => {
      // eslint-disable-next-line no-console
      console.warn("[pusher] ⚠ Déconnecté (reconnexion auto en cours…).");
    });
    // eslint-disable-next-line no-console
    console.log(
      "%c[pusher] Initialisation client key=" +
        key +
        " cluster=" +
        cluster +
        " — userId prêt ? → abonnement à venir.",
      "background:#1e3a8a;color:#fff;padding:2px 6px;border-radius:3px;"
    );
  }

  sharedPusherInstance = instance;
  return sharedPusherInstance;
}

export function useNotificationRealtime(userId, handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const channelRef = useRef(null);

  useEffect(() => {
    if (IS_DEV) {
      // eslint-disable-next-line no-console
      console.log(
        "%c[pusher] useNotificationRealtime → userId=" +
          (userId || "⚠️ UNDEFINED — hook idle, attend un userId valide") +
          "",
        "background:#0369a1;color:#fff;padding:2px 6px;border-radius:3px;"
      );
    }
    if (!userId || typeof userId !== "string") return undefined;

    const pusher = getSharedPusher();
    if (!pusher) return undefined;

    const channelName = userChannelName(userId);
    const channel = pusher.subscribe(channelName);
    channelRef.current = channel;

    if (IS_DEV) {
      channel.bind("pusher:subscription_succeeded", () => {
        // eslint-disable-next-line no-console
        console.log(
          "%c[pusher] ✔ Subscribe OK : " + channelName,
          "background:#065f46;color:#fff;padding:2px 6px;border-radius:3px;"
        );
      });
      channel.bind("pusher:subscription_error", (err) => {
        const type = err?.type ?? err?.name ?? "unknown";
        const status = err?.status ?? err?.statusCode ?? "?";
        // eslint-disable-next-line no-console
        console.warn(
          `[pusher] ⚠ Échec subscribe ${channelName} — status=${status} type=${type}. ` +
            `→ Regardez Network → POST /api/pusher/auth.`
        );
      });
    }

    const onCreated = (data) => {
      if (IS_DEV) {
        // eslint-disable-next-line no-console
        console.log(
          "%c[pusher] ✨ notification:created reçu → id=" + (data?.notification?.id ?? "?"),
          "background:#7c3aed;color:#fff;padding:2px 6px;border-radius:3px;"
        );
      }
      handlersRef.current?.onCreated?.(data ?? {});
    };
    const onRead = (data) => handlersRef.current?.onRead?.(data ?? {});
    const onAllRead = (data) => handlersRef.current?.onAllRead?.(data ?? {});
    const onDeleted = (data) => handlersRef.current?.onDeleted?.(data ?? {});

    channel.bind("notification:created", onCreated);
    channel.bind("notification:read", onRead);
    channel.bind("notification:all-read", onAllRead);
    channel.bind("notification:deleted", onDeleted);

    return () => {
      channel.unbind("notification:created", onCreated);
      channel.unbind("notification:read", onRead);
      channel.unbind("notification:all-read", onAllRead);
      channel.unbind("notification:deleted", onDeleted);
      channel.unbind("pusher:subscription_succeeded");
      channel.unbind("pusher:subscription_error");
      pusher.unsubscribe(channelName);
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [userId]);
}
