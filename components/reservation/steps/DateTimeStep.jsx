"use client";

import { useCallback, useEffect, useState } from "react";
import { findNearestAvailability } from "@/actions/reservation/find-nearest-availability";
import { getAvailableSlots, getMonthAvailability } from "@/actions/reservation/get-available-slots";
import { hasReservationWindow } from "@/lib/slot-availability";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Clock,
  Euro,
  CalendarDays,
  Sparkles,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/lib/intl-locale";

// ─── Availability re-validation helpers ───────────────────────────────────────

/**
 * Re-validates a single (staffServiceId, date, time) reservation window right
 * before the user advances to the next step. Returns true when the window is
 * still free, false (and shows an error toast) when it is no longer available.
 *
 * @param {string} staffServiceId
 * @param {Date}   date
 * @param {string} time           — "HH:MM"
 * @param {(reason: string) => string} unavailableMessage  — resolves reason → message
 * @param {(key: string) => string}   t                    — translation fn
 * @returns {Promise<boolean>}
 */
async function validateSlotAvailability(staffServiceId, date, time, unavailableMessage, t) {
  if (!staffServiceId || !date || !time) return false;

  const result = await getAvailableSlots(staffServiceId, date);

  if (!result.success) {
    toast.error(result.message || t("dateTime.checkAvailabilityFailed"));
    return false;
  }

  if (!result.data.isWorkingDay) {
    const reason = result.data.reason;
    const msg = unavailableMessage(reason) || t("dateTime.dayUnavailable");
    toast.error(msg);
    return false;
  }

  const windowStillAvailable = hasReservationWindow(
    result.data.reservationWindows ?? [],
    time
  );

  if (!windowStillAvailable) {
    toast.error(t("dateTime.slotUnavailable"));
    return false;
  }

  return true;
}

/**
 * Re-validates every (staffServiceId, date, time) pair in a multi-draft
 * schedule.  Returns true only when all slots are still free.
 *
 * @param {Array<{ staffService: { id: string }, duration: number }>} drafts
 * @param {{ draftIndex: number, date: string, time: string }[]}       appointments
 * @param {(reason: string) => string} unavailableMessage
 * @param {(key: string) => string}   t
 * @returns {Promise<boolean>}
 */
async function validateMultiSlotAvailability(drafts, appointments, unavailableMessage, t) {
  for (const appt of appointments) {
    const draft = drafts[appt.draftIndex];
    const staffServiceId = draft?.staffService?.id;
    const date = appt.date ? new Date(appt.date) : null;
    const time = appt.time;

    if (!date || Number.isNaN(date.getTime())) {
      toast.error(t("dateTime.selectDateTime"));
      return false;
    }

    const ok = await validateSlotAvailability(staffServiceId, date, time, unavailableMessage, t);
    if (!ok) return false;
  }
  return true;
}

// ─── Calendar constants & helpers ─────────────────────────────────────────────

function getMonthNames(locale) {
  const fmt = new Intl.DateTimeFormat(toIntlLocale(locale), { month: "long" });
  return Array.from({ length: 12 }, (_, m) =>
    fmt.format(new Date(2000, m, 1)).replace(/^./, (c) => c.toUpperCase())
  );
}

function getDayNames(locale) {
  const fmt = new Intl.DateTimeFormat(toIntlLocale(locale), { weekday: "short" });
  const names = Array.from({ length: 7 }, (_, d) =>
    fmt.format(new Date(2000, 1, 6 + d)).replace(/\.$/, "")
  );
  // Reorder to Sunday-first to match getDay() indexing
  return [names[6], ...names.slice(0, 6)];
}

function getDaysInMonth(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const startingDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = [];
  for (let i = 0; i < startingDayOfWeek; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));
  return days;
}

function getDateKey(date) {
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isSameDay(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isDateInPast(date) {
  if (!date) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

function formatTimeFromMinutes(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

const UNAVAILABLE_REASON_KEYS = {
  "Staff not available": "staffNotAvailable",
  "User deleted": "userDeleted",
  "No working hours configured": "noWorkingHours",
  "No active contract": "noActiveContract",
  "Contract has not started yet": "contractNotStarted",
  "Contract has expired": "contractExpired",
  "Salon closed this day": "salonClosedDay",
  "Staff not working this day": "staffNotWorkingDay",
  "Staff on time off": "staffOnTimeOff",
  "Salon closure": "salonClosure",
};

function CalendarWidget({ selectedDate, onDateSelect, disabledDates = new Set(), month, onMonthChange }) {
  const t = useTranslations("reservationSteps");
  const locale = useLocale();
  const months = getMonthNames(locale);
  const dayNames = getDayNames(locale);
  const [internalMonth, setInternalMonth] = useState(selectedDate ?? new Date());
  const currentMonth = month ?? internalMonth;
  const setCurrentMonth = onMonthChange ?? setInternalMonth;
  const monthDays = getDaysInMonth(currentMonth);

  const isDisabled = (date) => {
    if (!date) return true;
    if (isDateInPast(date)) return true;
    return disabledDates.has(getDateKey(date));
  };

  return (
    <div className="mx-auto w-full max-w-xs">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
          className="rounded-lg p-1.5 hover:bg-gray-100"
          aria-label={t("dateTime.prevMonthAria")}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-[#2F3A2E]">
          {months[currentMonth.getMonth()]} {currentMonth.getFullYear()}
        </span>
        <button
          type="button"
          onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
          className="rounded-lg p-1.5 hover:bg-gray-100"
          aria-label={t("dateTime.nextMonthAria")}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {dayNames.map((d) => (
          <div key={d} className="pb-1 text-center text-[10px] font-semibold text-gray-400">{d}</div>
        ))}
        {monthDays.map((day, i) => (
          <button
            key={i}
            type="button"
            onClick={() => day && !isDisabled(day) && onDateSelect(day)}
            disabled={isDisabled(day)}
            className={`h-8 w-full rounded-md border text-xs font-medium transition-all ${
              !day
                ? "invisible"
                : isDisabled(day)
                ? "cursor-not-allowed border-red-100 bg-red-50 text-red-400"
                : isSameDay(day, selectedDate)
                ? "border-[#C8A46A] bg-[#C8A46A] text-white"
                : "border-transparent bg-white text-[#2F3A2E] hover:border-[#C8A46A]/40 hover:bg-[#C8A46A]/10"
            }`}
          >
            {day ? day.getDate() : ""}
          </button>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-gray-400">
        <span className="inline-flex h-2.5 w-2.5 rounded-full border border-red-200 bg-red-50" />
        <span>{t("dateTime.unavailableDates")}</span>
      </div>
    </div>
  );
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatDateLabel(dateInput, locale) {
  const date = new Date(dateInput);
  return date.toLocaleDateString(toIntlLocale(locale), {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Europe/Brussels",
  });
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function StaffChip({ staff }) {
  const name = staff?.user?.fullName ?? "—";
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded-full">
        {staff?.photo ? (
          <Image src={staff.photo} alt={name} fill className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#C8A46A] to-[#B8945A] text-xs font-bold text-white">
            {name.charAt(0)}
          </div>
        )}
      </div>
      <span className="text-sm font-semibold text-[#2F3A2E]">{name}</span>
    </div>
  );
}

function DraftSummary({ drafts }) {
  const t = useTranslations("reservationSteps");
  const totalDuration = drafts.reduce((s, d) => s + (d.duration ?? 0), 0);
  const totalPrice = drafts.reduce((s, d) => s + Number(d.price ?? 0), 0);

  return (
    <div className="rounded-2xl border-2 border-gray-200 bg-gray-50 p-5">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
        {t("dateTime.draftsTitle", { count: drafts.length })}
      </h3>
      <div className="space-y-3">
        {drafts.map((draft, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-xs font-semibold text-[#C8A46A]">{t("dateTime.appointment", { index: i + 1 })}</p>
            <p className="mt-1 text-sm font-semibold text-[#2F3A2E]">{draft.service?.name ?? "—"}</p>
            <div className="mt-2">
              <StaffChip staff={draft.staff} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
              <span className="flex items-center gap-1"><Clock size={12} />{t("minutes", { count: draft.duration ?? "—" })}</span>
              <span className="flex items-center gap-1 font-semibold text-[#C8A46A]">
                <Euro size={12} />{Number(draft.price ?? 0).toFixed(2)}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-3 text-sm font-semibold text-[#2F3A2E]">
        <span>{t("dateTime.totalEstimated")}</span>
        <span className="text-[#C8A46A]">€{totalPrice.toFixed(2)} • {t("minutes", { count: totalDuration })}</span>
      </div>
    </div>
  );
}

function ModeSwitcher({ mode, onChange }) {
  const t = useTranslations("reservationSteps");
  const options = [
    {
      id: "same-day",
      label: t("dateTime.sameDay"),
      sublabel: t("dateTime.recommended"),
      description: t("dateTime.sameDayDesc"),
      icon: <Calendar size={20} />,
    },
    {
      id: "multi-day",
      label: t("dateTime.multiDay"),
      sublabel: null,
      description: t("dateTime.multiDayDesc"),
      icon: <CalendarDays size={20} />,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={`relative rounded-2xl border-2 p-4 text-left transition-all ${
            mode === opt.id
              ? "border-[#C8A46A] bg-[#C8A46A]/5"
              : "border-gray-200 hover:border-[#C8A46A]/40"
          }`}
        >
          {opt.sublabel && (
            <span className="absolute right-3 top-3 rounded-full bg-[#C8A46A] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              {opt.sublabel}
            </span>
          )}
          <div className={`mb-2 ${mode === opt.id ? "text-[#C8A46A]" : "text-gray-400"}`}>
            {opt.icon}
          </div>
          <p className="text-sm font-semibold text-[#2F3A2E]">{opt.label}</p>
          <p className="mt-0.5 text-xs text-gray-500">{opt.description}</p>
        </button>
      ))}
    </div>
  );
}

function LoadingState() {
  const t = useTranslations("reservationSteps");
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-500">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#C8A46A] border-t-transparent" />
      <p className="text-sm">{t("dateTime.searching")}</p>
    </div>
  );
}

function EmptyState({ message }) {
  const t = useTranslations("reservationSteps");
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-gray-400">
      <Clock size={32} className="text-gray-300" />
      <p className="text-sm">{message ?? t("dateTime.noSlots")}</p>
    </div>
  );
}

// ─── Proposal cards ───────────────────────────────────────────────────────────

function SingleProposalCard({ proposal, drafts, selected, onSelect, index }) {
  const t = useTranslations("reservationSteps");
  const locale = useLocale();
  const draft = drafts[0];
  const duration = draft?.duration ?? 60;
  
  // Calculate end time
  const [hours, minutes] = proposal.time.split(':').map(Number);
  const endMinutes = hours * 60 + minutes + duration;
  const endTime = formatTimeFromMinutes(endMinutes);
  const timeRange = `${proposal.time} → ${endTime}`;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl border-2 p-5 text-left transition-all ${
        selected
          ? "border-[#C8A46A] bg-[#C8A46A]/5 shadow-sm"
          : "border-gray-200 hover:border-[#C8A46A]/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          {proposal.recommended && (
            <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-[#C8A46A] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              <Sparkles size={10} /> {t("dateTime.recommended")}
            </span>
          )}
          {!proposal.recommended && (
            <span className="mb-2 inline-block text-xs font-medium text-gray-400">
              {t("dateTime.option", { index: index + 1 })}
            </span>
          )}
          <p className="text-base font-semibold text-[#2F3A2E]">{formatDateLabel(proposal.date, locale)}</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-[#C8A46A]">
            <Clock size={15} />
            {timeRange}
          </p>
        </div>
        {selected && <CheckCircle2 size={22} className="flex-shrink-0 text-[#C8A46A]" />}
      </div>
    </button>
  );
}

function SameDayProposalCard({ proposal, drafts, selected, onSelect, index }) {
  const t = useTranslations("reservationSteps");
  const locale = useLocale();
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl border-2 p-5 text-left transition-all ${
        selected
          ? "border-[#C8A46A] bg-[#C8A46A]/5 shadow-sm"
          : "border-gray-200 hover:border-[#C8A46A]/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          {proposal.recommended ? (
            <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-[#C8A46A] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              <Sparkles size={10} /> {t("dateTime.recommended")}
            </span>
          ) : (
            <span className="mb-2 inline-block text-xs font-medium text-gray-400">
              {t("dateTime.option", { index: index + 1 })}
            </span>
          )}

          <p className="text-base font-semibold text-[#2F3A2E]">{formatDateLabel(proposal.date, locale)}</p>
          <p className="mt-1 text-sm text-gray-600">
            {proposal.startTime} → {proposal.finishTime}
            {proposal.totalWaitingTime > 0 && (
              <span className="text-gray-400"> • {t("dateTime.waitingMinutes", { count: proposal.totalWaitingTime })}</span>
            )}
          </p>

          <div className="mt-4 space-y-2">
            {proposal.appointments.map((appt) => {
              const draft = drafts[appt.draftIndex];
              const duration = draft?.duration ?? 60;
              const [hours, minutes] = appt.time.split(':').map(Number);
              const endMinutes = hours * 60 + minutes + duration;
              const endTime = formatTimeFromMinutes(endMinutes);
              const timeRange = `${appt.time} → ${endTime}`;
              
              return (
                <div
                  key={appt.draftIndex}
                  className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-xs"
                >
                  <span className="font-medium text-[#2F3A2E]">
                    {draft?.service?.name ?? t("dateTime.appointment", { index: appt.draftIndex + 1 })}
                  </span>
                  <span className="text-[#C8A46A]">{timeRange}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex gap-4 text-xs text-gray-500">
            <span>{t("dateTime.careMinutes", { count: proposal.totalDuration })}</span>
            <span>{t("dateTime.appointmentsCount", { count: proposal.appointmentCount })}</span>
          </div>
        </div>
        {selected && <CheckCircle2 size={22} className="flex-shrink-0 text-[#C8A46A]" />}
      </div>
    </button>
  );
}

// ─── Multi-day manual selection ───────────────────────────────────────────────

function AppointmentDateCard({
  index,
  draft,
  selectedDate,
  selectedTime,
  onDateSelect,
  onTimeSelect,
}) {
  const t = useTranslations("reservationSteps");
  const locale = useLocale();
  const [open, setOpen] = useState(true);
  const [availableWindows, setAvailableWindows] = useState([]);
  const [disabledDates, setDisabledDates] = useState(new Set());
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(selectedDate ?? new Date());

  const staffServiceId = draft.staffService?.id;

  useEffect(() => {
    if (!staffServiceId) return;
    getMonthAvailability(staffServiceId, currentMonth).then((r) => {
      if (r.success) setDisabledDates(new Set(r.data.unavailableDates || []));
    });
  }, [staffServiceId, currentMonth]);

  useEffect(() => {
    if (!selectedDate || !staffServiceId) {
      setAvailableWindows([]);
      return;
    }

    setLoadingSlots(true);
    getAvailableSlots(staffServiceId, selectedDate).then((result) => {
      if (result.success) {
        setAvailableWindows(result.data.reservationWindows || []);

        if (!result.data.isWorkingDay && result.data.reason) {
          toast.error(UNAVAILABLE_REASON_KEYS[result.data.reason] ? t(`dateTime.unavailableReasons.${UNAVAILABLE_REASON_KEYS[result.data.reason]}`) : t("dateTime.dayNotAvailable"));
        }
      } else {
        toast.error(result.message || t("errorLoad"));
        setAvailableWindows([]);
      }
      setLoadingSlots(false);
    });
  }, [selectedDate, staffServiceId]);

  const isComplete = Boolean(selectedDate && selectedTime);

  return (
    <div className="overflow-hidden rounded-2xl border-2 border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between bg-gradient-to-r from-[#2F3A2E] to-[#3d4e3b] px-5 py-4"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-xs font-bold text-white">
            {index + 1}
          </span>
          <div className="text-left">
            <p className="text-sm font-semibold text-white">{draft.service?.name ?? "—"}</p>
            <p className="text-xs text-white/70">{draft.staff?.user?.fullName ?? "—"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isComplete ? (
            <span className="rounded-lg bg-[#C8A46A] px-3 py-1 text-xs font-semibold text-white">
              {selectedDate.toLocaleDateString(toIntlLocale(locale), { day: "2-digit", month: "short", timeZone: "Europe/Brussels" })} • {selectedTime}
            </span>
          ) : selectedDate ? (
            <span className="rounded-lg bg-white/10 px-3 py-1 text-xs text-white/80">
              {selectedDate.toLocaleDateString(toIntlLocale(locale), { day: "2-digit", month: "short", timeZone: "Europe/Brussels" })} — {t("dateTime.chooseTime")}
            </span>
          ) : (
            <span className="rounded-lg bg-white/10 px-3 py-1 text-xs text-white/60">
              {t("dateTime.dateTimeNotChosen")}
            </span>
          )}
          <ChevronRight
            size={16}
            className={`text-white/60 transition-transform ${open ? "rotate-90" : ""}`}
          />
        </div>
      </button>

      {open && (
        <div className="space-y-5 p-5">
          <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
            <StaffChip staff={draft.staff} />
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span className="flex items-center gap-1"><Clock size={14} />{t("minutes", { count: draft.duration ?? "—" })}</span>
              <span className="flex items-center gap-1 font-semibold text-[#C8A46A]">
                <Euro size={14} />{Number(draft.price ?? 0).toFixed(2)}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 p-4">
            <h4 className="mb-4 text-sm font-semibold text-[#2F3A2E]">{t("dateTime.chooseDate")}</h4>
            <CalendarWidget
              selectedDate={selectedDate}
              month={currentMonth}
              onMonthChange={setCurrentMonth}
              onDateSelect={(date) => {
                setCurrentMonth(new Date(date.getFullYear(), date.getMonth(), 1));
                onDateSelect(date);
              }}
              disabledDates={disabledDates}
            />
            {selectedDate && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#C8A46A]/10 p-2 text-xs">
                <Calendar size={14} className="text-[#C8A46A]" />
                <span className="font-medium text-[#2F3A2E]">{formatDateLabel(selectedDate, locale)}</span>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 p-4">
            <h4 className="mb-3 text-sm font-semibold text-[#2F3A2E]">{t("dateTime.availableSlots")}</h4>
            {!selectedDate ? (
              <div className="flex h-24 items-center justify-center text-xs text-gray-400">
                {t("dateTime.selectDateFirst")}
              </div>
            ) : loadingSlots ? (
              <div className="flex h-24 items-center justify-center">
                <div className="h-7 w-7 animate-spin rounded-full border-4 border-[#C8A46A] border-t-transparent" />
              </div>
            ) : availableWindows.length === 0 ? (
              <div className="flex h-24 items-center justify-center text-xs text-gray-400">
                {t("dateTime.noSlotsToday")}
              </div>
            ) : (
              <div className="grid max-h-48 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                {availableWindows.map((window) => (
                  <button
                    key={window.startTime}
                    type="button"
                    onClick={() => onTimeSelect(window.startTime)}
                    className={`rounded-lg px-2 py-2.5 text-xs font-medium transition-all ${
                      selectedTime === window.startTime
                        ? "bg-[#C8A46A] text-white"
                        : "border-2 border-gray-200 bg-white text-[#2F3A2E] hover:border-[#C8A46A]"
                    }`}
                  >
                    <Clock size={13} className="mx-auto mb-1" />
                    {window.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MultiDayManualView({ drafts, perDraftDates, perDraftTimes, onDraftDateSelect, onDraftTimeSelect }) {
  const t = useTranslations("reservationSteps");
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-gray-200 p-5">
        <h3 className="mb-1 text-base font-semibold text-[#2F3A2E]">
          {t("dateTime.planEach")}
        </h3>
        <p className="text-sm text-gray-500">
          {t("dateTime.planEachDesc")}
        </p>
      </div>

      {drafts.map((draft, index) => (
        <AppointmentDateCard
          key={index}
          index={index}
          draft={draft}
          selectedDate={perDraftDates[index] ?? null}
          selectedTime={perDraftTimes[index] ?? null}
          onDateSelect={(date) => onDraftDateSelect(index, date)}
          onTimeSelect={(time) => onDraftTimeSelect(index, time)}
        />
      ))}
    </div>
  );
}

// ─── Single-draft direct calendar + slot picker ───────────────────────────────

function SingleDraftView({ draft, selectedDate, selectedTime, onDateSelect, onTimeSelect, onConfirm, validating }) {
  const t = useTranslations("reservationSteps");
  const locale = useLocale();
  const [disabledDates, setDisabledDates] = useState(new Set());
  const [availableWindows, setAvailableWindows] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(selectedDate ?? new Date());

  const staffServiceId = draft?.staffService?.id;

  // Load unavailable dates whenever the viewed month changes
  useEffect(() => {
    if (!staffServiceId) return;
    getMonthAvailability(staffServiceId, currentMonth).then((r) => {
      if (r.success) setDisabledDates(new Set(r.data.unavailableDates || []));
    });
  }, [staffServiceId, currentMonth]);

  // Load available reservation windows whenever the selected date changes
  useEffect(() => {
    if (!selectedDate || !staffServiceId) {
      setAvailableWindows([]);
      return;
    }
    setLoadingSlots(true);
    getAvailableSlots(staffServiceId, selectedDate).then((result) => {
      if (result.success) {
        setAvailableWindows(result.data.reservationWindows || []);
        if (!result.data.isWorkingDay && result.data.reason) {
          toast.error(
            UNAVAILABLE_REASON_KEYS[result.data.reason] ? t(`dateTime.unavailableReasons.${UNAVAILABLE_REASON_KEYS[result.data.reason]}`) : t("dateTime.dayNotAvailable")
          );
        }
      } else {
        toast.error(result.message || t("errorLoad"));
        setAvailableWindows([]);
      }
      setLoadingSlots(false);
    });
  }, [selectedDate, staffServiceId]);

  return (
    <div className="space-y-5">
      {/* Calendar */}
      <div className="rounded-2xl border-2 border-gray-200 p-5">
        <h3 className="mb-4 text-sm font-semibold text-[#2F3A2E]">{t("dateTime.chooseDate")}</h3>
        <CalendarWidget
          selectedDate={selectedDate}
          month={currentMonth}
          onMonthChange={setCurrentMonth}
          onDateSelect={(date) => {
            setCurrentMonth(new Date(date.getFullYear(), date.getMonth(), 1));
            onDateSelect(date);
          }}
          disabledDates={disabledDates}
        />
        {selectedDate && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#C8A46A]/10 px-3 py-2 text-xs">
            <Calendar size={13} className="flex-shrink-0 text-[#C8A46A]" />
            <span className="font-medium text-[#2F3A2E]">{formatDateLabel(selectedDate, locale)}</span>
          </div>
        )}
      </div>

      {/* Time slots */}
      <div className="rounded-2xl border-2 border-gray-200 p-5">
        <h3 className="mb-4 text-sm font-semibold text-[#2F3A2E]">{t("dateTime.availableSlots")}</h3>
        {!selectedDate ? (
          <div className="flex h-28 items-center justify-center text-sm text-gray-400">
            {t("dateTime.selectDateFirst")}
          </div>
        ) : loadingSlots ? (
          <div className="flex h-28 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#C8A46A] border-t-transparent" />
          </div>
        ) : availableWindows.length === 0 ? (
          <div className="flex h-28 items-center justify-center text-sm text-gray-400">
            {t("dateTime.noSlotsToday")}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {availableWindows.map((window) => (
              <button
                key={window.startTime}
                type="button"
                onClick={() => onTimeSelect(window.startTime)}
                className={`rounded-lg px-2 py-2.5 text-xs font-medium transition-all ${
                  selectedTime === window.startTime
                    ? "bg-[#C8A46A] text-white"
                    : "border-2 border-gray-200 bg-white text-[#2F3A2E] hover:border-[#C8A46A]"
                }`}
              >
                <Clock size={13} className="mx-auto mb-1" />
                {window.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Confirm */}
      {selectedDate && selectedTime && (
        <button
          type="button"
          onClick={onConfirm}
          disabled={validating}
          className={`w-full rounded-xl px-6 py-4 text-sm font-semibold text-white transition-all ${
            validating
              ? "cursor-not-allowed bg-[#C8A46A]/60"
              : "bg-[#C8A46A] hover:bg-[#B8945A]"
          }`}
        >
          {validating ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" />
              {t("dateTime.verifying")}
            </span>
          ) : (
            t("dateTime.confirmSlot")
          )}
        </button>
      )}
    </div>
  );
}

// ─── Auto-proposal views ──────────────────────────────────────────────────────

function AutoProposalView({
  drafts,
  selectedIndex,
  onSelect,
  onConfirm,
  validating,
}) {
  const t = useTranslations("reservationSteps");
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState([]);
  const [resultType, setResultType] = useState(null);
  const [message, setMessage] = useState(null);

  const loadProposals = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    const payload = drafts.map((d) => ({
      staffService: { id: d.staffService.id, duration: d.duration },
    }));

    const result = await findNearestAvailability({
      drafts: payload,
      schedulingMode: "same-day",
    });

    if (!result.success) {
      toast.error(result.message || t("errorLoad"));
      setProposals([]);
    } else {
      setProposals(result.proposals ?? []);
      setResultType(result.type ?? null);
      setMessage(result.message ?? null);
    }

    setLoading(false);
  }, [drafts]);

  useEffect(() => {
    loadProposals();
  }, [loadProposals]);

  if (loading) return <LoadingState />;
  if (proposals.length === 0) return <EmptyState message={message} />;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-gray-200 p-5">
        <h3 className="mb-1 text-base font-semibold text-[#2F3A2E]">
          {t("dateTime.availableSlots")}
        </h3>
        <p className="mb-5 text-sm text-gray-500">
          {t("dateTime.proposalsFound")}
        </p>

        <div className="space-y-3">
          {resultType === "single" &&
            proposals.map((proposal, i) => (
              <SingleProposalCard
                key={`${proposal.date}-${proposal.time}`}
                proposal={proposal}
                drafts={drafts}
                index={i}
                selected={selectedIndex === i}
                onSelect={() => onSelect(i, proposal)}
              />
            ))}

          {resultType === "same-day" &&
            proposals.map((proposal, i) => (
              <SameDayProposalCard
                key={`${proposal.date}-${proposal.startTime}-${i}`}
                proposal={proposal}
                drafts={drafts}
                index={i}
                selected={selectedIndex === i}
                onSelect={() => onSelect(i, proposal)}
              />
            ))}
        </div>
      </div>

     <div className="flex justify-end w-full">
     {selectedIndex !== null && (
        <button
          type="button"
          onClick={onConfirm}
          disabled={validating}
          className={`w-[200px] rounded-xl px-6 py-4 text-sm font-semibold text-white transition-all ${
            validating
              ? "cursor-not-allowed bg-[#C8A46A]/60"
              : "bg-[#C8A46A] hover:bg-[#B8945A]"
          }`}
        >
          {validating ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" />
              {t("dateTime.verifying")}
            </span>
          ) : (
            t("dateTime.confirmSchedule")
          )}
        </button>
      )}
     </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function DateTimeStep({ data, updateData, nextStep }) {
  const t = useTranslations("reservationSteps");
  const locale = useLocale();
  const drafts = data.appointmentDrafts?.length
    ? data.appointmentDrafts
    : data.staffService
    ? [{
        category: data.category,
        service: data.service,
        staff: data.staff,
        staffService: data.staffService,
        duration: data.staffService?.duration,
        price: data.staffService?.price,
      }]
    : [];

  const isMultiDraft = drafts.length > 1;

  const [schedulingMode, setSchedulingMode] = useState(data.schedulingMode ?? "same-day");
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [selectedProposal, setSelectedProposal] = useState(data.selectedScheduleProposal ?? null);
  const [perDraftDates, setPerDraftDates] = useState(data.perDraftDates ?? {});
  const [perDraftTimes, setPerDraftTimes] = useState(data.perDraftTimes ?? {});

  // Single-draft direct selection state
  const [singleDate, setSingleDate] = useState(data.date ?? null);
  const [singleTime, setSingleTime] = useState(data.time ?? null);

  // Shared validation-in-progress flag — shown on all confirm buttons
  const [validating, setValidating] = useState(false);

  const handleModeChange = (mode) => {
    setSchedulingMode(mode);
    setSelectedIndex(null);
    setSelectedProposal(null);
    setPerDraftDates({});
    setPerDraftTimes({});
    updateData({
      schedulingMode: mode,
      selectedScheduleProposal: null,
      sameDayDate: null,
      date: null,
      time: null,
      perDraftDates: {},
      perDraftTimes: {},
    });
  };

  const handlePerDraftDateSelect = (index, date) => {
    const updatedDates = { ...perDraftDates, [index]: date };
    const updatedTimes = { ...perDraftTimes };
    delete updatedTimes[index];
    setPerDraftDates(updatedDates);
    setPerDraftTimes(updatedTimes);
    updateData({ perDraftDates: updatedDates, perDraftTimes: updatedTimes, selectedScheduleProposal: null });
  };

  const handlePerDraftTimeSelect = (index, time) => {
    const updatedTimes = { ...perDraftTimes, [index]: time };
    setPerDraftTimes(updatedTimes);
    updateData({ perDraftTimes: updatedTimes });
  };

  // ── Single-draft handlers ────────────────────────────────────────────────
  const handleSingleDateSelect = (date) => {
    setSingleDate(date);
    setSingleTime(null);
    updateData({ date, time: null });
  };

  const handleSingleTimeSelect = (time) => {
    setSingleTime(time);
    updateData({ time });
  };

  const unavailableMessage = (reason) => {
    const key = UNAVAILABLE_REASON_KEYS[reason];
    return key ? t(`dateTime.unavailableReasons.${key}`) : t("dateTime.dayNotAvailable");
  };

  const handleSingleConfirm = async () => {
    if (!singleDate || !singleTime) {
      toast.error(t("dateTime.selectDateTime"));
      return;
    }

    const draft = drafts[0];
    const staffServiceId = draft?.staffService?.id ?? data.staffService?.id;

    setValidating(true);
    const slotOk = await validateSlotAvailability(staffServiceId, singleDate, singleTime, unavailableMessage, t);
    setValidating(false);

    if (!slotOk) {
      // Clear the selected time so the user must pick another valid slot
      setSingleTime(null);
      updateData({ time: null });
      return;
    }

    updateData({
      date:        singleDate,
      time:        singleTime,
      staffService: draft?.staffService ?? data.staffService,
      staff:       draft?.staff        ?? data.staff,
      service:     draft?.service      ?? data.service,
      category:    draft?.category     ?? data.category,
      selectedScheduleProposal: null,
    });
    nextStep();
  };

  // ── Multi-draft handlers ─────────────────────────────────────────────────
  const handleSelect = (index, proposal) => {
    setSelectedIndex(index);
    setSelectedProposal(proposal);
  };

  const applySameDaySelection = (proposal) => {
    updateData({
      sameDayDate: new Date(proposal.date),
      selectedScheduleProposal: proposal,
      schedulingMode: "same-day",
    });
  };

  const allMultiDaySelectionsComplete =
    drafts.length > 0 &&
    drafts.every((_, i) => perDraftDates[i] && perDraftTimes[i]);

  const handleAutoConfirm = async () => {
    if (!selectedProposal) {
      toast.error(t("dateTime.selectSlot"));
      return;
    }

    // Build the appointments list from the proposal so we can re-validate
    // each individual slot before advancing.
    const appointments = selectedProposal.appointments
      ? selectedProposal.appointments.map((appointment) => ({
          ...appointment,
          date: appointment.date ?? selectedProposal.date,
        }))
      : [{ draftIndex: 0, date: selectedProposal.date, time: selectedProposal.time }];

    setValidating(true);
    const allOk = await validateMultiSlotAvailability(drafts, appointments, unavailableMessage, t);
    setValidating(false);

    if (!allOk) {
      // Clear the selection so the user must pick a new proposal
      setSelectedIndex(null);
      setSelectedProposal(null);
      updateData({ selectedScheduleProposal: null, sameDayDate: null });
      return;
    }

    applySameDaySelection(selectedProposal);
    nextStep();
  };

  const handleMultiDayConfirm = async () => {
    if (!allMultiDaySelectionsComplete) {
      toast.error(t("dateTime.selectEachDateTime"));
      return;
    }

    const appointments = drafts.map((_, i) => ({
      draftIndex: i,
      date: perDraftDates[i].toISOString(),
      time: perDraftTimes[i],
    }));

    setValidating(true);
    const allOk = await validateMultiSlotAvailability(drafts, appointments, unavailableMessage, t);
    setValidating(false);

    if (!allOk) {
      // Don't clear dates/times — only the conflicting slot is invalid.
      // The user can see which slot failed and pick a new time for it.
      return;
    }

    updateData({
      schedulingMode: "multi-day",
      perDraftDates,
      perDraftTimes,
      selectedScheduleProposal: { appointments },
    });
    nextStep();
  };

  const subtitle = isMultiDraft
    ? `${t("dateTime.appointmentsCount", { count: drafts.length })} • ${drafts.map((d) => d.staff?.user?.fullName).filter(Boolean).join(", ")}`
    : `${drafts[0]?.staff?.user?.fullName ?? data.staff?.user?.fullName ?? ""} • ${drafts[0]?.service?.name ?? data.service?.name ?? ""}`;

  return (
    <div>
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold text-[#2F3A2E]">
          {t("dateTime.title")}
        </h2>
        <p className="mt-2 text-gray-600">{subtitle}</p>
      </div>

      {/* ── Single-draft: direct calendar + slot picker ──────── */}
      {!isMultiDraft && (
        <div className="mx-auto max-w-2xl">
          <SingleDraftView
            draft={drafts[0]}
            selectedDate={singleDate}
            selectedTime={singleTime}
            onDateSelect={handleSingleDateSelect}
            onTimeSelect={handleSingleTimeSelect}
            onConfirm={handleSingleConfirm}
            validating={validating}
          />
        </div>
      )}

      {/* ── Multi-draft: mode switcher + proposal / manual ───── */}
      {isMultiDraft && (
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
            <div className="space-y-6">
              <div className="rounded-2xl border-2 border-gray-200 p-5">
                <p className="mb-4 text-sm font-semibold text-[#2F3A2E]">
                  {t("dateTime.howPlan")}
                </p>
                <ModeSwitcher mode={schedulingMode} onChange={handleModeChange} />
              </div>

              {schedulingMode === "multi-day" ? (
                <>
                  <MultiDayManualView
                    drafts={drafts}
                    perDraftDates={perDraftDates}
                    perDraftTimes={perDraftTimes}
                    onDraftDateSelect={handlePerDraftDateSelect}
                    onDraftTimeSelect={handlePerDraftTimeSelect}
                  />
                  {allMultiDaySelectionsComplete && (
                    <button
                      type="button"
                      onClick={handleMultiDayConfirm}
                      disabled={validating}
                      className={`w-full rounded-xl px-6 py-4 text-sm font-semibold text-white transition-all ${
                        validating
                          ? "cursor-not-allowed bg-[#C8A46A]/60"
                          : "bg-[#C8A46A] hover:bg-[#B8945A]"
                      }`}
                    >
{validating ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                {t("dateTime.verifying")}
              </span>
            ) : (
              t("dateTime.confirmSlot")
            )}
                    </button>
                  )}
                </>
              ) : (
                <AutoProposalView
                  drafts={drafts}
                  selectedIndex={selectedIndex}
                  onSelect={handleSelect}
                  onConfirm={handleAutoConfirm}
                  validating={validating}
                />
              )}
            </div>

            <div className="lg:sticky lg:top-8 lg:self-start">
              <DraftSummary drafts={drafts} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
