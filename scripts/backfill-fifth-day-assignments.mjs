/**
 * Gives each coming 5th day (a month's 5th Saturday…) to the staff members
 * who already have something booked on it.
 *
 * Since 2026-10-22 no working-hours rule covers a month's 5th occurrence of a
 * weekday — not even « every week »: Marie gives it, each time, to the staff
 * she agreed it with (WorkingDayOverride isWorking true, see
 * lib/working-day-overrides.js and lib/fifth-days.js). Before that, a staff
 * member working every Monday also worked the 5th Mondays, and clients may
 * already have booked them. Run once when the change is deployed, so those
 * days stay hers: without it they would read as nobody's — no new booking,
 * and her existing ones on a day the app says she does not work.
 *
 * Booked = any day her agenda is taken, the same sources as
 * lib/formations/custom-date-availability.js#loadStaffBusyIntervals:
 *   - an active rendez-vous;
 *   - a formation / atelier session she animates (her Animator by staffId or
 *     by her account e-mail), or a formation with no animator that she
 *     created — on EVERY day it runs: a « date libre »'s journées
 *     (customDateKeys), otherwise each day from its start to its end, so a
 *     session starting on the 28th still holds the 29th.
 * Wider than the app on one point: a date libre not paid yet counts too, so
 * a client in the middle of paying keeps her day. Restated here because a
 * plain node script cannot import the app's "@/…" modules. Days nobody has
 * booked are left to Marie (dashboard alert).
 *
 * Dry run by default. Idempotent — a day already given is skipped.
 *
 *   node scripts/backfill-fifth-day-assignments.mjs            # report only
 *   node scripts/backfill-fifth-day-assignments.mjs --apply    # write
 *   DATABASE_URL=<prod-url> node scripts/backfill-fifth-day-assignments.mjs
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config({ path: [".env.local", ".env"], quiet: true });

const apply = process.argv.includes("--apply");
const prisma = new PrismaClient();

const AHEAD_DAYS = 400;
const ACTIVE_APPOINTMENT_STATUSES = ["PENDING", "ACCEPTED", "CONFIRMED"];
const WEEK_DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const pad = (n) => String(n).padStart(2, "0");

/** The Brussels calendar day of an instant, "YYYY-MM-DD". */
function brusselsDateKey(instant) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(dateKey, days) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

const weekDayOf = (key) => WEEK_DAYS[new Date(`${key}T12:00:00Z`).getUTCDay()];
const MINUTE = 60 * 1000;

/** Every Brussels day an interval [start, end) touches. */
function dayKeysOf(start, end) {
  const keys = [];
  const last = brusselsDateKey(new Date(Math.max(start.getTime(), end.getTime() - 1)));
  for (let key = brusselsDateKey(start); key <= last; key = addDays(key, 1)) keys.push(key);
  return keys;
}

/** The days a formation / atelier session runs on. */
function sessionDayKeys(session, durationMinutes) {
  if (session.customDateKeys?.length > 0) return session.customDateKeys;
  const end = session.endDate ?? new Date(session.startDate.getTime() + Number(durationMinutes || 0) * MINUTE);
  return dayKeysOf(session.startDate, end);
}

async function main() {
  console.log(apply ? "== APPLY ==" : "== DRY RUN (pass --apply to write) ==");

  const today = brusselsDateKey(new Date());
  const fifthDays = [];
  for (let key = today; key <= addDays(today, AHEAD_DAYS); key = addDays(key, 1)) {
    if (Number(key.slice(8)) >= 29) fifthDays.push(key);
  }

  const staffList = await prisma.staff.findMany({
    where: { isDeleted: false },
    select: {
      id: true,
      userId: true,
      user: { select: { fullName: true, email: true } },
      workingHours: { select: { day: true, startTime: true, endTime: true, isClosed: true } },
      workingDayOverrides: { where: { dateKey: { in: fifthDays } }, select: { dateKey: true } },
    },
  });

  // Read from a month back: a session that started before today can still run on a coming 5th day.
  const from = new Date(`${addDays(today, -31)}T00:00:00Z`);
  const to = new Date(`${addDays(today, AHEAD_DAYS + 1)}T00:00:00Z`);
  const fifthDaySet = new Set(fifthDays);

  const toGive = [];
  for (const staff of staffList) {
    const animatorIds = (
      await prisma.animator.findMany({
        where: {
          OR: [
            { staffId: staff.id },
            ...(staff.user?.email ? [{ email: { equals: staff.user.email, mode: "insensitive" } }] : []),
          ],
        },
        select: { id: true },
      })
    ).map((a) => a.id);
    const formationOwners = [
      ...(animatorIds.length > 0
        ? [{ animatorId: { in: animatorIds } }, { animatorId: null, formation: { animatorId: { in: animatorIds } } }]
        : []),
      ...(staff.userId ? [{ animatorId: null, formation: { animatorId: null, createdById: staff.userId } }] : []),
    ];

    const [appointments, formationSessions, workshopSessions] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          staffId: staff.id,
          isDeleted: false,
          status: { in: ACTIVE_APPOINTMENT_STATUSES },
          startTime: { lt: to },
          endTime: { gt: from },
        },
        select: { startTime: true, endTime: true },
      }),
      formationOwners.length === 0
        ? []
        : prisma.formationSession.findMany({
            where: { status: { not: "CANCELLED" }, startDate: { lt: to }, OR: formationOwners },
            select: { startDate: true, endDate: true, customDateKeys: true, formation: { select: { duration: true } } },
          }),
      animatorIds.length === 0
        ? []
        : prisma.workshopSession.findMany({
            where: {
              status: { not: "CANCELLED" },
              startDate: { lt: to },
              OR: [{ animatorId: { in: animatorIds } }, { animatorId: null, workshop: { animatorId: { in: animatorIds } } }],
            },
            select: { startDate: true, endDate: true, workshop: { select: { duration: true } } },
          }),
    ]);

    // 5th day → what she has on it.
    const bookedOn = new Map();
    const mark = (keys, what) => {
      for (const key of keys) {
        if (!fifthDaySet.has(key)) continue;
        const list = bookedOn.get(key) ?? [];
        list.push(what);
        bookedOn.set(key, list);
      }
    };
    for (const a of appointments) mark(dayKeysOf(a.startTime, a.endTime), "rendez-vous");
    for (const f of formationSessions) mark(sessionDayKeys(f, f.formation?.duration), "formation");
    for (const w of workshopSessions) mark(sessionDayKeys(w, w.workshop?.duration), "atelier");

    for (const [dateKey, booked] of [...bookedOn.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      // A weekday she never works: the change does not touch that day.
      const wh = staff.workingHours.find((w) => w.day === weekDayOf(dateKey));
      if (!wh || wh.isClosed) continue;
      if (staff.workingDayOverrides.some((o) => o.dateKey === dateKey)) continue;
      toGive.push({ staff, dateKey, wh, booked });
    }
  }

  console.log(`\n5th days already booked, to give to their staff member: ${toGive.length}`);
  for (const { staff, dateKey, booked } of toGive) {
    const counts = Object.entries(booked.reduce((acc, what) => ({ ...acc, [what]: (acc[what] ?? 0) + 1 }), {}));
    console.log(`  ${dateKey} (${weekDayOf(dateKey)})  ${staff.user?.fullName ?? staff.id}  — ${counts.map(([w, n]) => `${n} ${w}`).join(", ")}`);
  }

  if (apply && toGive.length > 0) {
    for (const { staff, dateKey, wh } of toGive) {
      await prisma.workingDayOverride.upsert({
        where: { staffId_dateKey: { staffId: staff.id, dateKey } },
        update: { isWorking: true, startTime: wh.startTime, endTime: wh.endTime },
        create: { staffId: staff.id, dateKey, isWorking: true, startTime: wh.startTime, endTime: wh.endTime },
      });
    }
    console.log(`\nWritten: ${toGive.length}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
