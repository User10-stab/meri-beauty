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
    title: `${t("dashboard.calendar")} — Calendrier`,
    description: t("calendar.title"),
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
    getCalendarEvents(range),
  ]);

  const appointments = appointmentsResult.data ?? [];
  const staff = staffResult.data ?? [];
  const closures = salonResult.data?.closures ?? [];
  const activityEvents = eventsResult.data?.activityEvents ?? [];

  return (
    <div className="space-y-6">
      {/* ── Page header ───────────────────────────────────────────────── */}
      {/* <div>
        <h1 className="text-2xl font-bold text-dark dark:text-white">
          {t("dashboard.calendar")}
        </h1>
        <p className="mt-1 text-sm font-medium text-gray-500 dark:text-dark-6">
          {isAdmin
            ? t("calendar.adminDescription")
            : t("calendar.staffDescription")}
        </p>
      </div> */}

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
        closures={closures}
        isAdmin={isAdmin}
      />
    </div>
  );
}
