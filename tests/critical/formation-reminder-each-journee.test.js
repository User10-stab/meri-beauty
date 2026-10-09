import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { journeeToRemind } from "@/lib/reminders/send-formation-reminders";
import { formationReservationReminderEmail } from "@/lib/email-templates";

// 2026-10-09: a formation's journées no longer have to follow each other, so
// one reminder the day before the first no longer covers a third journée ten
// days later. Each journée is reminded the day before it.

/** Brussels winter wall clock → instant. */
const at = (dateKey, time) => new Date(`${dateKey}T${time}:00+01:00`);

// Julie's week: Monday 23, Tuesday 24 and Friday 27 November, 10:00–17:00.
const session = {
  startDate: at("2026-11-23", "10:00"),
  endDate: at("2026-11-27", "17:00"),
  customDateKeys: ["2026-11-23", "2026-11-24", "2026-11-27"],
};
const due = (now, reminderSentAt = null, s = session) => journeeToRemind({ session: s, reminderSentAt, now });

describe("which journée a formation reminder is for", () => {
  test("the first journée is reminded in the 24 h before it, not earlier", () => {
    expect(due(at("2026-11-22", "09:00"))).toBeNull();
    expect(due(at("2026-11-22", "11:00"))).toMatchObject({ number: 1, count: 3, start: at("2026-11-23", "10:00") });
  });

  test("it is sent once: the next run the same evening sends nothing", () => {
    expect(due(at("2026-11-22", "18:00"), at("2026-11-22", "11:00"))).toBeNull();
  });

  test("the next day's journée is reminded although the first reminder was already sent", () => {
    expect(due(at("2026-11-23", "11:00"), at("2026-11-22", "11:00"))).toMatchObject({ number: 2, count: 3 });
    expect(due(at("2026-11-23", "18:00"), at("2026-11-23", "11:00"))).toBeNull();
  });

  test("nothing is sent for the days in between, then the separated journée gets its own reminder", () => {
    const lastSent = at("2026-11-23", "11:00");
    // Wednesday and most of Thursday: no journée within 24 h.
    expect(due(at("2026-11-25", "11:00"), lastSent)).toBeNull();
    expect(due(at("2026-11-26", "09:00"), lastSent)).toBeNull();
    expect(due(at("2026-11-26", "11:00"), lastSent)).toMatchObject({ number: 3, count: 3, start: at("2026-11-27", "10:00") });
  });

  test("after the last journée there is nothing left to remind", () => {
    expect(due(at("2026-11-27", "11:00"), at("2026-11-26", "11:00"))).toBeNull();
    expect(due(at("2026-11-28", "11:00"), null)).toBeNull();
  });

  test("a one-day session keeps its single reminder", () => {
    const oneDay = { startDate: at("2026-11-23", "10:00"), endDate: at("2026-11-23", "14:00") };
    expect(due(at("2026-11-22", "11:00"), null, oneDay)).toMatchObject({ number: 1, count: 1 });
    expect(due(at("2026-11-22", "18:00"), at("2026-11-22", "11:00"), oneDay)).toBeNull();
    const noEnd = { startDate: at("2026-11-23", "10:00"), endDate: null };
    expect(due(at("2026-11-22", "11:00"), null, noEnd)).toMatchObject({ number: 1, count: 1 });
  });

  test("a session that only runs past midnight is one sitting, reminded once", () => {
    const evening = { startDate: at("2026-11-23", "20:00"), endDate: at("2026-11-24", "01:00") };
    expect(due(at("2026-11-23", "09:00"), null, evening)).toMatchObject({ number: 1, count: 1 });
    expect(due(at("2026-11-23", "21:00"), at("2026-11-23", "09:00"), evening)).toBeNull();
  });
});

describe("the reminder e-mail", () => {
  test("names the journée coming up and keeps the full list", () => {
    const mail = formationReservationReminderEmail({
      customerName: "Camille",
      formationTitle: "Cil à cil",
      sessionDate: "lundi 23, mardi 24 et vendredi 27 novembre 2026 (10:00 – 17:00 chaque jour)",
      journee: { number: 3, count: 3, date: "vendredi 27 novembre 2026, 10:00 – 17:00" },
    });
    expect(mail.subject).toContain("journée 3 sur 3 demain");
    expect(mail.text).toContain("la journée 3 sur 3 de votre formation");
    expect(mail.text).toContain("vendredi 27 novembre 2026, 10:00 – 17:00");
    expect(mail.text).toContain("Toutes vos journées : lundi 23");
    expect(mail.html).toContain("Journée 3 sur 3");
  });

  test("is unchanged for a one-day formation", () => {
    const mail = formationReservationReminderEmail({ customerName: "Camille", formationTitle: "Cil à cil", sessionDate: "lundi 23 novembre" });
    expect(mail.subject).toBe('Rappel — "Cil à cil" c\'est demain ! – Meri Beauty');
    expect(mail.text).toContain("votre réservation pour la formation");
    expect(mail.html).toContain("Date & Horaire");
    expect(mail.html).not.toContain("Toutes vos journées");
  });
});

describe("the job", () => {
  const job = readFileSync(fileURLToPath(new URL("../../lib/reminders/send-formation-reminders.js", import.meta.url)), "utf8");

  test("claims on the marker it read, so two runners cannot both send a journée's reminder", () => {
    expect(job).toContain("where: { id: reservation.id, reminderSentAt: reservation.reminderSentAt },");
  });

  test("still looks at a session whose first day has passed", () => {
    expect(job).toContain("OR: [{ endDate: { gt: now } }, { endDate: null, startDate: { gt: now } }],");
    expect(job).not.toContain("reminderSentAt: null,\n      session:");
  });
});
