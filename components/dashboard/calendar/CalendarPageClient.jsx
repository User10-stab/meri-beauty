"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { getStaffColor } from "./staffColors";
import { CalendarToolbar } from "./CalendarToolbar";
import { StaffFilterChips } from "./StaffFilterChips";
import { WeekView } from "./WeekView";
import { DayView } from "./DayView";
import { MonthView } from "./MonthView";
import { AppointmentDrawer } from "./AppointmentDrawer";
import { CreateManualAppointmentModal } from "./CreateManualAppointmentModal";
import { getCalendarAppointments } from "@/actions/appointment/get-calendar-appointments";
import { getCalendarEvents } from "@/actions/dashboard/get-calendar-events";
import {
  weekRange,
  dayRange,
  monthRange,
  formatWeekLabel,
  formatMonthLabel,
  formatDayFull,
  getWeekDays,
  getMonthGrid,
  deriveWeekTimeline,
  deriveDayTimeline,
} from "./calendarUtils";

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function CalendarSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.03)] dark:border-gray-700/80 dark:bg-gray-dark">
      {/* Header row */}
      <div className="grid grid-cols-8 border-b border-gray-100 dark:border-gray-700/50">
        <div className="h-12 border-r border-gray-100 dark:border-gray-700/50" />
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex h-12 flex-col items-center justify-center gap-1 border-r border-gray-100 last:border-r-0 dark:border-gray-700/50">
            <div className="h-2 w-6 rounded bg-gray-100 dark:bg-gray-700" />
            <div className="h-5 w-5 rounded-full bg-gray-100 dark:bg-gray-700" />
          </div>
        ))}
      </div>
      {/* Time rows */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="grid grid-cols-8 border-b border-gray-100 dark:border-gray-700/50">
          <div className="border-r border-gray-100 dark:border-gray-700/50 py-4 pr-2 text-right">
            <div className="ml-auto h-2 w-8 rounded bg-gray-100 dark:bg-gray-700" />
          </div>
          {Array.from({ length: 7 }).map((_, j) => (
            <div key={j} className="h-16 border-r border-gray-100 last:border-r-0 dark:border-gray-700/50 p-1">
              {i === 1 && j === 2 && (
                <div className="h-10 rounded-lg bg-violet-50 dark:bg-violet-900/20" />
              )}
              {i === 3 && j === 4 && (
                <div className="h-12 rounded-lg bg-blue-50 dark:bg-blue-900/20" />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Main calendar page client — orchestrates views, navigation, and filters.
 * Timeline (opening/closing times) is computed dynamically from staff
 * working hours, not from global salon hours.
 *
 * @param {{
 *   initialAppointments: Array<object>,
 *   initialActivityEvents: Array<object>,
 *   staff: Array<object>,
 *   closures: Array<{ startDate: string, endDate: string }>,
 *   isAdmin: boolean,
 * }} props
 */
export function CalendarPageClient({
  initialAppointments,
  initialActivityEvents = [],
  staff,
  closures = [],
  isAdmin,
}) {
  // ── Translations ─────────────────────────────────────────────────────────
  const t = useTranslations();
  
  // ── State ────────────────────────────────────────────────────────────────
  const [view, setView] = useState("week"); // "day" | "week" | "month"
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedStaffId, setSelectedStaffId] = useState(null); // null = all
  const [appointments, setAppointments] = useState(initialAppointments);
  const [activityEvents, setActivityEvents] = useState(initialActivityEvents);
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // ── Compute timeline from staff working hours ────────────────────────────
  // The salon has no global working hours — each staff member has their own.
  // We derive the visible timeline from the earliest/latest staff hours
  // for the currently displayed staff and days.
  const relevantStaff = useMemo(() => {
    if (selectedStaffId !== null) {
      return staff.filter((s) => s.id === selectedStaffId);
    }
    return staff;
  }, [staff, selectedStaffId]);

  const timeline = useMemo(() => {
    if (view === "day") {
      return deriveDayTimeline(currentDate, relevantStaff, activityEvents);
    }
    // week and month use the week's timeline
    return deriveWeekTimeline(currentDate, relevantStaff, activityEvents);
  }, [view, currentDate, relevantStaff, activityEvents]);

  const openingTime = timeline.openingTime;
  const closingTime = timeline.closingTime;

  // ── Date range for current view ──────────────────────────────────────────
  function getRange(v, d) {
    if (v === "day") return dayRange(d);
    if (v === "month") return monthRange(d);
    return weekRange(d); // week default
  }

  // ── Fetch appointments + activity events for the current period ─────────
  const fetchAppointments = useCallback(
    (v, d) => {
      startTransition(async () => {
        const range = getRange(v, d);
        const [apptResult, eventsResult] = await Promise.all([
          getCalendarAppointments(range),
          isAdmin ? getCalendarEvents(range) : Promise.resolve({ success: true, data: { activityEvents: [] } }),
        ]);
        if (apptResult.success) {
          setAppointments(apptResult.data ?? []);
        }
        if (eventsResult.success) {
          setActivityEvents(eventsResult.data?.activityEvents ?? []);
        }
      });
    },
    [isAdmin],
  );

  // Re-fetch whenever view or date changes
  useEffect(() => {
    fetchAppointments(view, currentDate);
  }, [view, currentDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtered appointments (staff chip) ───────────────────────────────────
  const visibleAppointments =
    selectedStaffId === null
      ? appointments
      : appointments.filter((a) => a.staffId === selectedStaffId);

  // ── Filtered activity events (formations, ateliers) ─────────────────────
  const visibleActivityEvents = useMemo(() => {
    if (selectedStaffId === null) {
      return activityEvents; // Show all for admin "all staff" view
    }
    // For specific staff: only show formations linked to this staff member
    // via animatorId. Exclude events and ateliers entirely.
    return activityEvents.filter(
      (ev) => ev.kind === "formation" && ev.animatorId === selectedStaffId,
    );
  }, [activityEvents, selectedStaffId]);

  // ── Filtered time-offs (only when a specific staff is selected) ────────
  const visibleTimeOffs = useMemo(() => {
    if (!isAdmin) {
      // Staff users always see their own time-offs (staff array has only them)
      const me = staff[0];
      return me?.timeOffs ?? [];
    }
    if (selectedStaffId === null) return []; // Hide time-offs in admin "all staff" view
    const member = staff.find((s) => s.id === selectedStaffId);
    return member?.timeOffs ?? [];
  }, [staff, selectedStaffId, isAdmin]);

  // ── Toolbar period label ─────────────────────────────────────────────────
  function getPeriodLabel() {
    if (view === "day") return formatDayFull(currentDate);
    if (view === "month") return formatMonthLabel(currentDate);
    return formatWeekLabel(currentDate);
  }

  // ── Navigation ───────────────────────────────────────────────────────────
  function navigate(dir) {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (view === "day") d.setDate(d.getDate() + dir);
      else if (view === "week") d.setDate(d.getDate() + dir * 7);
      else d.setMonth(d.getMonth() + dir);
      return d;
    });
  }

  function goToday() {
    setCurrentDate(new Date());
  }

  // ── View switching ───────────────────────────────────────────────────────
  function handleViewChange(v) {
    setView(v);
  }

  // ── Day click (from month or week header) ────────────────────────────────
  function handleDayClick(day) {
    setCurrentDate(day);
    setView("day");
  }

  // ── Appointment click ────────────────────────────────────────────────────
  function handleAppointmentClick(appt) {
    setSelectedAppointment(appt);
    setDrawerOpen(true);
  }

  function handleDrawerClose() {
    setDrawerOpen(false);
  }

  function handleAppointmentUpdated() {
    fetchAppointments(view, currentDate);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <CalendarToolbar
            view={view}
            onViewChange={handleViewChange}
            periodLabel={getPeriodLabel()}
            onPrev={() => navigate(-1)}
            onNext={() => navigate(1)}
            onToday={goToday}
          />
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex h-[38px] items-center gap-1.5 rounded-xl bg-[#303c2f] px-4 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.1),0_4px_12px_rgba(0,0,0,0.08)] transition-all hover:bg-[#253025] hover:shadow-[0_2px_4px_rgba(0,0,0,0.1),0_8px_16px_rgba(0,0,0,0.1)] dark:bg-[#303c2f] dark:text-white dark:hover:bg-[#253025]"
        >
          <Plus size={15} strokeWidth={2.5} />
          Nouveau rendez-vous
        </button>
      </div>

      {/* ── Staff filter (admin only) ──────────────────────────────────────── */}
      {isAdmin && staff.length > 0 && (
        <StaffFilterChips
          staff={staff}
          selectedStaffId={selectedStaffId}
          onSelect={setSelectedStaffId}
        />
      )}

      {/* ── Calendar view ─────────────────────────────────────────────────── */}
      {isPending ? (
        <CalendarSkeleton />
      ) : (
        <>
          {/* Desktop: full grid — hidden on small screens */}
          <div className="hidden md:block">
            {view === "week" && (
              <WeekView
                currentDate={currentDate}
                appointments={visibleAppointments}
                activityEvents={visibleActivityEvents}
                timeOffs={visibleTimeOffs}
                staff={relevantStaff}
                showActivityLane={isAdmin}
                openingTime={openingTime}
                closingTime={closingTime}
                closures={closures}
                onAppointmentClick={handleAppointmentClick}
                onDayClick={handleDayClick}
              />
            )}
            {view === "day" && (
              <DayView
                currentDate={currentDate}
                appointments={visibleAppointments}
                activityEvents={visibleActivityEvents}
                timeOffs={visibleTimeOffs}
                staff={relevantStaff}
                showActivityLane={isAdmin}
                openingTime={openingTime}
                closingTime={closingTime}
                closures={closures}
                onAppointmentClick={handleAppointmentClick}
              />
            )}
            {view === "month" && (
              <MonthView
                currentDate={currentDate}
                appointments={visibleAppointments}
                activityEvents={visibleActivityEvents}
                timeOffs={visibleTimeOffs}
                staff={relevantStaff}
                showActivityLane={isAdmin}
                closures={closures}
                onDayClick={handleDayClick}
                onAppointmentClick={handleAppointmentClick}
              />
            )}
          </div>

          {/* Mobile: agenda list — always shown on small screens */}
          <div className="block md:hidden">
            <AgendaView
              appointments={visibleAppointments}
              view={view}
              currentDate={currentDate}
              onAppointmentClick={handleAppointmentClick}
            />
          </div>
        </>
      )}

      {/* ── Appointment drawer ─────────────────────────────────────────────── */}
      <AppointmentDrawer
        appointment={selectedAppointment}
        isOpen={drawerOpen}
        onClose={handleDrawerClose}
        onAppointmentUpdated={handleAppointmentUpdated}
        isAdmin={isAdmin}
      />

      {/* ── Add manual appointment ───────────────────────────────────────── */}
      <CreateManualAppointmentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => fetchAppointments(view, currentDate)}
        defaultDate={view === "day" ? currentDate : null}
      />
    </div>
  );
}

// ─── Mobile Agenda View ───────────────────────────────────────────────────────

/**
 * Chronological list of appointments — rendered on mobile instead of a grid.
 */
function AgendaView({ appointments, view, currentDate, onAppointmentClick }) {
  const t = useTranslations();
  
  if (appointments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200/80 bg-white py-16 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.03)] dark:border-gray-700/80 dark:bg-gray-dark">
        <p className="text-[13px] text-gray-400 dark:text-gray-500">
          {t("calendarView.noReservations")}
        </p>
      </div>
    );
  }

  // Group by day
  const byDay = {};
  for (const appt of appointments) {
    if (!appt.date) continue;
    const key = appt.date.slice(0, 10); // "YYYY-MM-DD"
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(appt);
  }

  const sortedDays = Object.keys(byDay).sort();

  return (
    <div className="space-y-4">
      {sortedDays.map((day) => {
        const date = new Date(day);
        const dayAppts = byDay[day].sort((a, b) =>
          (a.startTime ?? "").localeCompare(b.startTime ?? ""),
        );

        return (
          <div
            key={day}
            className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.03)] dark:border-gray-700/80 dark:bg-gray-dark"
          >
            {/* Day header */}
            <div className="border-b border-gray-100 px-4 py-2.5 dark:border-gray-700/50">
              <p className="text-[13px] font-semibold capitalize text-gray-700 dark:text-gray-200">
                {date.toLocaleDateString("fr-FR", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  timeZone: "Europe/Brussels",
                })}
              </p>
            </div>

            {/* Appointments */}
            <div className="divide-y divide-gray-100 dark:divide-gray-700/30">
              {dayAppts.map((appt) => {
                const color = getStaffColor(appt.staffId);
                return (
                  <button
                    key={appt.id}
                    onClick={() => onAppointmentClick(appt)}
                    className="relative flex w-full items-start gap-4 px-4 py-3 text-left transition-colors hover:bg-gray-50/60 dark:hover:bg-gray-800/50"
                    style={{
                      borderLeftWidth: "3px",
                      borderLeftColor: color.border,
                    }}
                  >
                    {/* Time */}
                    <div className="w-12 flex-shrink-0 text-center">
                      <p className="text-[13px] font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                        {appt.startTime
                          ? new Date(appt.startTime).toLocaleTimeString("fr-FR", {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "Europe/Brussels",
                            })
                          : "—"}
                      </p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500">
                        {appt.duration ? `${appt.duration}min` : ""}
                      </p>
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-[13px] font-semibold text-gray-800 dark:text-gray-100">
                          {appt.serviceName}
                        </p>
                        <span className="flex-shrink-0 rounded bg-gray-100 px-1.5 py-px text-[8px] font-bold uppercase tracking-wider text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                          RDV
                        </span>
                      </div>
                      <p className="truncate text-[12px] text-gray-500 dark:text-gray-400">{appt.customerName}</p>
                      <p className="truncate text-[11px] text-gray-400 dark:text-gray-500">{appt.staffName}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
