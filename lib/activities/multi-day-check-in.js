import { addDaysToDateKey, brusselsDateKey } from "@/lib/formations/custom-date-availability";

/**
 * A formation over several days is attended on each of them with the same
 * ticket. The reservation keeps a single admitted-seats counter, so a ticket
 * fully checked in on day one would read as « déjà pointé » on day two.
 *
 * Rule (2026-10-05): a ticket whose seats were all admitted on an EARLIER
 * Brussels day may be admitted again on any later day of the session — once
 * per day. `checkedInAt` then holds the latest day's arrival; every arrival
 * stays in the audit log.
 *
 * @param {{ session: { startDate: Date|string, endDate: Date|string|null },
 *   seatsCount: number, checkedInSeats: number, checkedInAt: Date|string|null, now?: Date }} params
 * @returns {{ multiDay: boolean, dayCount: number, dayNumber: number|null,
 *   checkedInToday: boolean, newDay: boolean }}
 */
export function formationDayAdmission({ session, seatsCount, checkedInSeats, checkedInAt, now = new Date() }) {
  const firstDay = brusselsDateKey(session.startDate);
  const lastDay = brusselsDateKey(session.endDate ?? session.startDate);
  const days = [];
  for (let day = firstDay; day <= lastDay; day = addDaysToDateKey(day, 1)) days.push(day);

  const today = brusselsDateKey(now);
  const index = days.indexOf(today);
  const dayNumber = index === -1 ? null : index + 1;
  const lastInDay = checkedInAt ? brusselsDateKey(checkedInAt) : null;
  const multiDay = days.length > 1;
  const checkedInToday = lastInDay === today;

  return {
    multiDay,
    dayCount: days.length,
    dayNumber,
    checkedInToday,
    newDay: multiDay && dayNumber !== null && checkedInSeats >= seatsCount && lastInDay !== null && lastInDay < today,
  };
}
