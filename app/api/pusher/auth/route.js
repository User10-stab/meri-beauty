import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildPrivateChannelAuth } from "@/lib/realtime/pusher-server";

/**
 * Pusher private-channel authentication endpoint.
 *
 * pusher-js sends a POST with either:
 *   - Content-Type: application/x-www-form-urlencoded
 *     Body: socket_id=123.456&channel_name=private-user-X
 *   - Content-Type: application/json
 *     Body: { "socket_id": "...", "channel_name": "..." }
 */
export async function POST(req) {
  const session = await auth();

  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  const rawText = await req.text().catch(() => "");

  let socketId = "";
  let channelName = "";

  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(rawText || "{}");
      socketId = parsed.socket_id ?? parsed.socketId ?? "";
      channelName = parsed.channel_name ?? parsed.channelName ?? "";
    } catch {
      // Fall through — URLSearchParams can still parse the text
    }
  }

  if (!socketId || !channelName) {
    const params = new URLSearchParams(rawText);
    socketId = params.get("socket_id") ?? params.get("socketId") ?? socketId ?? "";
    channelName = params.get("channel_name") ?? params.get("channelName") ?? channelName ?? "";
  }

  try {
    const authorize = buildPrivateChannelAuth();
    const authPayload = authorize({ socketId, channelName, session });
    return NextResponse.json(authPayload);
  } catch (err) {
    const status = err?.status ?? 500;
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[pusher/auth] ${status} sessionId=${session?.user?.id ?? "none"} socketId=${socketId || "?"} channel=${channelName || "?"} — ${err?.message ?? err}`
      );
    }
    if (status === 401) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (status === 403) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (status === 503) return NextResponse.json({ error: "Realtime service unavailable" }, { status: 503 });
    console.error("[pusher/auth] Unexpected error:", err?.message ?? err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
