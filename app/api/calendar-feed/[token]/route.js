import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/appointment-status";

// react-pdf isn't involved here, but Prisma + Buffer-free string building is
// still Node-only in practice for this project's setup.
export const runtime = "nodejs";

const WINDOW_PAST_DAYS = 7;
const WINDOW_FUTURE_DAYS = 180;

/** RFC 5545 §3.3.11 TEXT escaping — backslash, semicolon, comma, newline. */
function escapeIcsText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** UTC "floating" timestamp in the YYYYMMDDTHHMMSSZ form RFC 5545 expects. */
function toIcsUtc(date) {
  return new Date(date).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function buildIcs({ calendarName, appointments }) {
  const now = toIcsUtc(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Meri Beauty//Staff Calendar//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    // Advisory hints for clients that honor them (Google Calendar does);
    // most still poll on their own schedule regardless.
    "REFRESH-INTERVAL;VALUE=DURATION:PT30M",
    "X-PUBLISHED-TTL:PT30M",
  ];

  for (const a of appointments) {
    const summary = `${a.staffService.service?.name ?? "Rendez-vous"} — ${a.user.fullName}`;
    const descriptionParts = [`Statut : ${a.status}`];
    if (a.notes) descriptionParts.push(`Notes : ${a.notes}`);

    lines.push(
      "BEGIN:VEVENT",
      `UID:appointment-${a.id}@meribeauty.com`,
      `DTSTAMP:${now}`,
      `DTSTART:${toIcsUtc(a.startTime)}`,
      `DTEND:${toIcsUtc(a.endTime)}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(descriptionParts.join("\n"))}`,
      `STATUS:${a.status === "CONFIRMED" || a.status === "COMPLETED" ? "CONFIRMED" : "TENTATIVE"}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/**
 * Unauthenticated on purpose — this is a subscription-feed URL (Google/
 * Apple/Outlook "add calendar from URL"), which polls periodically with no
 * interactive login. The token itself (128 bits, DB-stored, revocable via
 * regenerateCalendarToken) is what gates access, same trust model as any
 * other unguessable-URL calendar/webhook feed.
 */
export async function GET(req, { params }) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "Lien invalide." }, { status: 404 });
  }

  try {
    const staff = await prisma.staff.findUnique({
      where: { calendarToken: token },
      select: { user: { select: { fullName: true } } },
    });
    if (!staff) {
      return NextResponse.json({ error: "Lien invalide." }, { status: 404 });
    }

    const now = new Date();
    const rangeStart = new Date(now.getTime() - WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000);
    const rangeEnd = new Date(now.getTime() + WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000);

    const appointments = await prisma.appointment.findMany({
      where: {
        isDeleted: false,
        status: { in: [...ACTIVE_APPOINTMENT_STATUSES, "COMPLETED"] },
        startTime: { gte: rangeStart, lte: rangeEnd },
        staffService: { staff: { calendarToken: token } },
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        status: true,
        notes: true,
        user: { select: { fullName: true } },
        staffService: { select: { service: { select: { name: true } } } },
      },
      orderBy: { startTime: "asc" },
    });

    const ics = buildIcs({ calendarName: `Meri Beauty — ${staff.user.fullName}`, appointments });

    return new NextResponse(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="rendez-vous.ics"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[calendar-feed]", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
