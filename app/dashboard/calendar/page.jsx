import { requireDashboard } from "@/lib/route-protection";
import { isAdminRole } from "@/lib/authorization";
import { getCalendarAppointments } from "@/actions/appointment/get-calendar-appointments";
import { getStaffForCalendar } from "@/actions/staff/get-staff-for-calendar";
import { getSalon } from "@/actions/salon/get-salon";
import { getCalendarEvents } from "@/actions/dashboard/get-calendar-events";
import { CalendarPageClient } from "@/components/dashboard/calendar/CalendarPageClient";
import { weekRange } from "@/components/dashboard/calendar/calendarUtils";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations();
  return {
    title: `${t("dashboard.calendar")} — Dashboard`,
    description: t("calendar.title"),
  };
}

// ─── Working hours helpers ────────────────────────────────────────────────────

const WEEKDAY_MAP = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 0,
};

const DEFAULT_OPENING = "09:00";
const DEFAULT_CLOSING = "19:00";

/**
 * Derive opening / closing times from the salon's working days.
 * Returns the earliest opening and latest closing across all open days.
 */
function deriveSalonHours(workingDays) {
  if (!workingDays || workingDays.length === 0) {
    return { openingTime: DEFAULT_OPENING, closingTime: DEFAULT_CLOSING };
  }

  const openDays = workingDays.filter((wd) => wd.isOpen);
  if (openDays.length === 0) {
    return { openingTime: DEFAULT_OPENING, closingTime: DEFAULT_CLOSING };
  }

  const openTimes = openDays.map((wd) => wd.openingTime).sort();
  const closeTimes = openDays.map((wd) => wd.closingTime).sort();

  return {
    openingTime: openTimes[0] ?? DEFAULT_OPENING,
    closingTime: closeTimes[closeTimes.length - 1] ?? DEFAULT_CLOSING,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CalendarPage() {
  // ── Auth guard ─────────────────────────────────────────────────────────
  const { user } = await requireDashboard();
  const isAdmin = isAdminRole(user.role);
  const t = await getTranslations();

  // ── Initial data: current week ─────────────────────────────────────────
  const range = weekRange(new Date());

  const [appointmentsResult, staffResult, salonResult, eventsResult] = await Promise.all([
    getCalendarAppointments(range),
    getStaffForCalendar(),
    getSalon(),
    // Ateliers/formations lane — the action itself returns an empty list for
    // STAFF (Animator is a separate, unlinked directory from Staff), so no
    // extra gating is needed here.
    getCalendarEvents(range),
  ]);

  const appointments = appointmentsResult.data ?? [];
  const staff = staffResult.data ?? [];
  const workingDays = salonResult.data?.workingDays ?? [];
  const { openingTime, closingTime } = deriveSalonHours(workingDays);
  const activityEvents = eventsResult.data?.activityEvents ?? [];

  return (
    <div className="space-y-6">
      {/* ── Page header ───────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">
          {t("dashboard.calendar")}
        </h1>
        <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
          {isAdmin
            ? t("calendar.adminDescription")
            : t("calendar.staffDescription")}
        </p>
      </div>

      {/* ── Error banners ─────────────────────────────────────────────── */}
      {!appointmentsResult.success && appointmentsResult.message && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400"
        >
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {appointmentsResult.message}
        </div>
      )}

      {/* ── Calendar client shell ─────────────────────────────────────── */}
      <CalendarPageClient
        initialAppointments={appointments}
        initialActivityEvents={activityEvents}
        staff={staff}
        openingTime={openingTime}
        closingTime={closingTime}
        workingDays={workingDays}
        isAdmin={isAdmin}
      />
    </div>
  );
}
