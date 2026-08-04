"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  addDays,
  startOfWeek,
  endOfWeek,
  startOfDay,
  endOfDay,
  isSameDay,
  format,
} from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Loader2, GraduationCap, PartyPopper, User } from "lucide-react";
import { getCalendarEvents } from "@/actions/dashboard/get-calendar-events";

const GRID_START_HOUR = 7;
const GRID_END_HOUR = 21;
const HOUR_HEIGHT = 56; // px

const STATUS_STYLE = {
  PENDING: "bg-amber-50 border-amber-300 text-amber-800",
  CONFIRMED: "bg-blue-50 border-blue-300 text-blue-800",
  COMPLETED: "bg-emerald-50 border-emerald-300 text-emerald-800",
  CANCELLED: "bg-gray-100 border-gray-300 text-gray-500 line-through",
  NO_SHOW: "bg-red-50 border-red-300 text-red-700",
};

function clampMinutesFromGridStart(date) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  const gridStartMin = GRID_START_HOUR * 60;
  const gridEndMin = GRID_END_HOUR * 60;
  return Math.min(Math.max(minutes, gridStartMin), gridEndMin) - gridStartMin;
}

function eventStyle(start, end) {
  const top = (clampMinutesFromGridStart(start) / 60) * HOUR_HEIGHT;
  const bottom = (clampMinutesFromGridStart(end) / 60) * HOUR_HEIGHT;
  const height = Math.max(bottom - top, 22);
  return { top: `${top}px`, height: `${height}px` };
}

function AppointmentBlock({ event }) {
  const style = eventStyle(new Date(event.start), new Date(event.end));
  const colorClass = STATUS_STYLE[event.status] ?? "bg-gray-50 border-gray-300 text-gray-700";
  return (
    <div
      className={`absolute left-1 right-1 overflow-hidden rounded-md border px-2 py-1 text-[11px] leading-tight shadow-sm ${colorClass}`}
      style={style}
      title={`${event.title} — ${event.subtitle} (${format(new Date(event.start), "HH:mm")}–${format(new Date(event.end), "HH:mm")})`}
    >
      <p className="truncate font-semibold">{event.title}</p>
      <p className="truncate">{event.subtitle}</p>
    </div>
  );
}

function ActivityPill({ event }) {
  const Icon = event.kind === "formation" ? GraduationCap : PartyPopper;
  return (
    <div
      className="flex items-start gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] leading-tight text-violet-800"
      title={`${event.title} — ${event.subtitle} (${format(new Date(event.start), "HH:mm")})`}
    >
      <Icon size={12} className="mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="truncate font-semibold">{format(new Date(event.start), "HH:mm")} · {event.title}</p>
        <p className="truncate text-violet-600">{event.subtitle}</p>
      </div>
    </div>
  );
}

export function CalendarPageClient({ isAdmin }) {
  const [view, setView] = useState("day");
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(new Date()));
  const [data, setData] = useState({ staff: [], appointments: [], activityEvents: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const range = useMemo(() => {
    if (view === "day") {
      return { start: startOfDay(anchorDate), end: endOfDay(anchorDate) };
    }
    const start = startOfWeek(anchorDate, { weekStartsOn: 1 });
    const end = endOfWeek(anchorDate, { weekStartsOn: 1 });
    return { start, end: endOfDay(end) };
  }, [view, anchorDate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getCalendarEvents({ from: range.start.toISOString(), to: range.end.toISOString() });
    if (!result.success) {
      setError(result.message || "Erreur inconnue.");
    } else {
      setData(result.data);
    }
    setLoading(false);
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  const hours = useMemo(() => {
    const list = [];
    for (let h = GRID_START_HOUR; h <= GRID_END_HOUR; h++) list.push(h);
    return list;
  }, []);

  const days = useMemo(() => {
    if (view === "day") return [anchorDate];
    const start = startOfWeek(anchorDate, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [view, anchorDate]);

  function goPrev() {
    setAnchorDate((d) => addDays(d, view === "day" ? -1 : -7));
  }
  function goNext() {
    setAnchorDate((d) => addDays(d, view === "day" ? 1 : 7));
  }
  function goToday() {
    setAnchorDate(startOfDay(new Date()));
  }

  const activityEventsByDay = useMemo(() => {
    const map = new Map();
    for (const day of days) map.set(day.toDateString(), []);
    for (const ev of data.activityEvents) {
      const key = new Date(ev.start).toDateString();
      if (map.has(key)) map.get(key).push(ev);
    }
    return map;
  }, [data.activityEvents, days]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-[10px] border border-stroke bg-white px-5 py-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={goPrev}
            aria-label="Période précédente"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-dark-3 dark:text-dark-6"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={goToday}
            className="h-8 rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-dark-3 dark:text-dark-6"
          >
            Aujourd'hui
          </button>
          <button
            onClick={goNext}
            aria-label="Période suivante"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-dark-3 dark:text-dark-6"
          >
            <ChevronRight size={16} />
          </button>
          <span className="ml-2 text-sm font-semibold text-gray-800 dark:text-white">
            {view === "day"
              ? format(anchorDate, "EEEE d MMMM yyyy", { locale: fr })
              : `${format(range.start, "d MMM", { locale: fr })} – ${format(days[6], "d MMM yyyy", { locale: fr })}`}
          </span>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-1 dark:border-dark-3">
          {["day", "week"].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                view === v ? "bg-[#2f3a2e] text-white" : "text-gray-500 hover:bg-gray-50 dark:text-dark-6"
              }`}
            >
              {v === "day" ? "Jour" : "Semaine"}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 flex-shrink-0 text-lg leading-none">⚠</span>
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-[10px] border border-stroke bg-white py-24 text-sm text-gray-400 dark:border-dark-3 dark:bg-gray-dark">
          <Loader2 size={16} className="animate-spin" /> Chargement du calendrier…
        </div>
      ) : view === "day" ? (
        <DayGrid hours={hours} staff={data.staff} appointments={data.appointments} activityEvents={data.activityEvents} isAdmin={isAdmin} />
      ) : (
        <WeekAgenda days={days} appointments={data.appointments} activityEventsByDay={activityEventsByDay} />
      )}
    </div>
  );
}

function DayGrid({ hours, staff, appointments, activityEvents, isAdmin }) {
  const columns = staff.length > 0 ? staff : [{ id: null, name: "—" }];
  const showActivityLane = isAdmin;

  return (
    <div className="overflow-x-auto rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex min-w-max">
        <div className="w-16 flex-shrink-0 border-r border-stroke dark:border-dark-3">
          <div className="h-10 border-b border-stroke dark:border-dark-3" />
          {hours.map((h) => (
            <div key={h} className="flex items-start justify-end pr-2 text-[11px] text-gray-400" style={{ height: HOUR_HEIGHT }}>
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {columns.map((s) => (
          <div key={s.id ?? "none"} className="w-48 flex-shrink-0 border-r border-stroke last:border-r-0 dark:border-dark-3">
            <div className="flex h-10 items-center justify-center gap-1.5 border-b border-stroke px-2 text-xs font-semibold text-gray-700 dark:border-dark-3 dark:text-white">
              <User size={12} className="text-gray-400" />
              <span className="truncate">{s.name}</span>
            </div>
            <div className="relative" style={{ height: hours.length * HOUR_HEIGHT }}>
              {hours.map((h) => (
                <div key={h} className="border-b border-gray-50 dark:border-dark-3/50" style={{ height: HOUR_HEIGHT }} />
              ))}
              {appointments
                .filter((a) => a.staffId === s.id)
                .map((a) => (
                  <AppointmentBlock key={a.id} event={a} />
                ))}
            </div>
          </div>
        ))}

        {showActivityLane && (
          <div className="w-56 flex-shrink-0">
            <div className="flex h-10 items-center justify-center gap-1.5 border-b border-stroke px-2 text-xs font-semibold text-gray-700 dark:border-dark-3 dark:text-white">
              <PartyPopper size={12} className="text-violet-400" />
              <span>Ateliers &amp; Formations</span>
            </div>
            <div className="space-y-1.5 p-1.5">
              {activityEvents.length === 0 ? (
                <p className="px-1 py-3 text-center text-[11px] text-gray-300">Aucune session ce jour</p>
              ) : (
                activityEvents.map((ev) => <ActivityPill key={ev.id} event={ev} />)
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WeekAgenda({ days, appointments, activityEventsByDay }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
      {days.map((day) => {
        const dayAppointments = appointments
          .filter((a) => isSameDay(new Date(a.start), day))
          .sort((a, b) => new Date(a.start) - new Date(b.start));
        const dayActivities = activityEventsByDay.get(day.toDateString()) ?? [];
        const isToday = isSameDay(day, new Date());

        return (
          <div
            key={day.toDateString()}
            className={`flex flex-col rounded-[10px] border bg-white shadow-1 dark:bg-gray-dark dark:shadow-card ${
              isToday ? "border-[#2f3a2e]" : "border-stroke dark:border-dark-3"
            }`}
          >
            <div className={`border-b px-3 py-2 text-center text-xs font-semibold ${isToday ? "bg-[#2f3a2e]/5 text-[#2f3a2e]" : "border-stroke text-gray-700 dark:border-dark-3 dark:text-white"}`}>
              {format(day, "EEE d MMM", { locale: fr })}
            </div>
            <div className="flex-1 space-y-1.5 p-2">
              {dayAppointments.length === 0 && dayActivities.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-gray-300">Rien de prévu</p>
              ) : (
                <>
                  {dayAppointments.map((a) => (
                    <div
                      key={a.id}
                      className={`truncate rounded-md border px-2 py-1 text-[11px] ${STATUS_STYLE[a.status] ?? "bg-gray-50 border-gray-300 text-gray-700"}`}
                      title={`${a.title} — ${a.subtitle}`}
                    >
                      {format(new Date(a.start), "HH:mm")} · {a.title} · {a.subtitle}
                    </div>
                  ))}
                  {dayActivities.map((ev) => (
                    <ActivityPill key={ev.id} event={ev} />
                  ))}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
