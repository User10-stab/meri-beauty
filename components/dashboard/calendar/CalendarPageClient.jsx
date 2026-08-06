"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { CalendarToolbar } from "./CalendarToolbar";
import { StaffFilterChips } from "./StaffFilterChips";
import { WeekView } from "./WeekView";
import { DayView } from "./DayView";
import { MonthView } from "./MonthView";
import { AppointmentDrawer } from "./AppointmentDrawer";
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
} from "./calendarUtils";

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function CalendarSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-dark">
      {/* Header row */}
      <div className="grid grid-cols-8 border-b border-gray-100">
        <div className="h-12 border-r border-gray-100" />
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex h-12 flex-col items-center justify-center gap-1 border-r border-gray-100 last:border-r-0">
            <div className="h-2 w-6 rounded bg-gray-100" />
            <div className="h-5 w-5 rounded-full bg-gray-100" />
          </div>
        ))}
      </div>
      {/* Time rows */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="grid grid-cols-8 border-b border-gray-100">
          <div className="border-r border-gray-100 py-4 pr-2 text-right">
            <div className="ml-auto h-2 w-8 rounded bg-gray-100" />
          </div>
          {Array.from({ length: 7 }).map((_, j) => (
            <div key={j} className="h-16 border-r border-gray-100 last:border-r-0 p-1">
              {i === 1 && j === 2 && (
                <div className="h-10 rounded-lg bg-purple-100" />
              )}
              {i === 3 && j === 4 && (
                <div className="h-12 rounded-lg bg-blue-100" />
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
 *
 * @param {{
 *   initialAppointments: Array<object>,
 *   initialActivityEvents: Array<object>,
 *   staff: Array<object>,
 *   openingTime: string,
 *   closingTime: string,
 *   workingDays: Array<{ day: string, isOpen: boolean }>,
 *   isAdmin: boolean,
 * }} props
 */
export function CalendarPageClient({
  initialAppointments,
  initialActivityEvents = [],
  staff,
  openingTime = "09:00",
  closingTime = "19:00",
  workingDays = [],
  isAdmin,
}) {
  // ── State ────────────────────────────────────────────────────────────────
  const [view, setView] = useState("week"); // "day" | "week" | "month"
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedStaffId, setSelectedStaffId] = useState(null); // null = all
  const [appointments, setAppointments] = useState(initialAppointments);
  const [activityEvents, setActivityEvents] = useState(initialActivityEvents);
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // ── Date range for current view ──────────────────────────────────────────
  function getRange(v, d) {
    if (v === "day") return dayRange(d);
    if (v === "month") return monthRange(d);
    return weekRange(d); // week default
  }

  // ── Fetch appointments + activity events for the current period ─────────
  // Ateliers/formations (getCalendarEvents) are only fetched for admins —
  // the action itself returns an empty list for STAFF, since Animator
  // (workshop/formation trainers) is a separate, unlinked directory.
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
    // Keep drawer open to show success feedback
  }

  // ── Responsive: mobile agenda list ───────────────────────────────────────
  // (Agenda view renders on screens < md)

  return (
    <div className="flex flex-col gap-4">
      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <CalendarToolbar
        view={view}
        onViewChange={handleViewChange}
        periodLabel={getPeriodLabel()}
        onPrev={() => navigate(-1)}
        onNext={() => navigate(1)}
        onToday={goToday}
      />

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
                activityEvents={activityEvents}
                showActivityLane={isAdmin}
                openingTime={openingTime}
                closingTime={closingTime}
                workingDays={workingDays}
                onAppointmentClick={handleAppointmentClick}
                onDayClick={handleDayClick}
              />
            )}
            {view === "day" && (
              <DayView
                currentDate={currentDate}
                appointments={visibleAppointments}
                activityEvents={activityEvents}
                showActivityLane={isAdmin}
                openingTime={openingTime}
                closingTime={closingTime}
                workingDays={workingDays}
                onAppointmentClick={handleAppointmentClick}
              />
            )}
            {view === "month" && (
              <MonthView
                currentDate={currentDate}
                appointments={visibleAppointments}
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
    </div>
  );
}

// ─── Mobile Agenda View ───────────────────────────────────────────────────────

/**
 * Chronological list of appointments — rendered on mobile instead of a grid.
 */
function AgendaView({ appointments, view, currentDate, onAppointmentClick }) {
  if (appointments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white py-16 text-center shadow-sm dark:border-gray-700 dark:bg-gray-dark">
        <p className="text-sm text-gray-400">
          Aucune réservation confirmée pour cette période.
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
            className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-dark"
          >
            {/* Day header */}
            <div className="border-b border-gray-100 bg-gray-50/60 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-800/30">
              <p className="text-sm font-semibold capitalize text-gray-700 dark:text-gray-200">
                {date.toLocaleDateString("fr-FR", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              </p>
            </div>

            {/* Appointments */}
            <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {dayAppts.map((appt) => (
                <button
                  key={appt.id}
                  onClick={() => onAppointmentClick(appt)}
                  className="flex w-full items-start gap-4 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  {/* Time */}
                  <div className="w-12 flex-shrink-0 text-center">
                    <p className="text-sm font-bold tabular-nums text-gray-700 dark:text-gray-200">
                      {appt.startTime
                        ? new Date(appt.startTime).toLocaleTimeString("fr-FR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {appt.duration ? `${appt.duration}min` : ""}
                    </p>
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">
                      {appt.serviceName}
                    </p>
                    <p className="truncate text-xs text-gray-500">{appt.customerName}</p>
                    <p className="truncate text-xs text-gray-400">{appt.staffName}</p>
                  </div>

                  {/* Confirmed dot */}
                  <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-emerald-500" />
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
