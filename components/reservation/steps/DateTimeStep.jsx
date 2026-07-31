"use client";

import { useCallback, useEffect, useState } from "react";
import { findNearestAvailability } from "@/actions/reservation/find-nearest-availability";
import { getAvailableSlots, getMonthAvailability } from "@/actions/reservation/get-available-slots";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Clock,
  Euro,
  CalendarDays,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import Image from "next/image";
import toast from "react-hot-toast";

// ─── Calendar constants & helpers ─────────────────────────────────────────────

const MONTHS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];
const DAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

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

const UNAVAILABLE_REASON_MESSAGES = {
  "Staff not available": "Le membre du personnel n'est pas disponible",
  "User deleted": "Le compte a été supprimé",
  "No working hours configured": "Aucun horaire de travail configuré",
  "No active contract": "Aucun contrat actif",
  "Contract has not started yet": "Le contrat n'a pas encore commencé",
  "Contract has expired": "Le contrat a expiré",
  "Salon closed this day": "Le salon est fermé ce jour",
  "Staff not working this day": "Le membre du personnel ne travaille pas ce jour",
  "Staff on time off": "Le membre du personnel est en congé",
  "Salon closure": "Le salon est fermé (exception)",
};

function CalendarWidget({ selectedDate, onDateSelect, disabledDates = new Set(), month, onMonthChange }) {
  const [internalMonth, setInternalMonth] = useState(selectedDate ?? new Date());
  const currentMonth = month ?? internalMonth;
  const setCurrentMonth = onMonthChange ?? setInternalMonth;
  const days = getDaysInMonth(currentMonth);

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
          aria-label="Mois précédent"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-[#2F3A2E]">
          {MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}
        </span>
        <button
          type="button"
          onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
          className="rounded-lg p-1.5 hover:bg-gray-100"
          aria-label="Mois suivant"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {DAYS.map((d) => (
          <div key={d} className="pb-1 text-center text-[10px] font-semibold text-gray-400">{d}</div>
        ))}
        {days.map((day, i) => (
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
        <span>Dates indisponibles</span>
      </div>
    </div>
  );
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatDateLabel(dateInput) {
  const date = new Date(dateInput);
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
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
  const totalDuration = drafts.reduce((s, d) => s + (d.duration ?? 0), 0);
  const totalPrice = drafts.reduce((s, d) => s + Number(d.price ?? 0), 0);

  return (
    <div className="rounded-2xl border-2 border-gray-200 bg-gray-50 p-5">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Vos rendez-vous ({drafts.length})
      </h3>
      <div className="space-y-3">
        {drafts.map((draft, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-xs font-semibold text-[#C8A46A]">Rendez-vous {i + 1}</p>
            <p className="mt-1 text-sm font-semibold text-[#2F3A2E]">{draft.service?.name ?? "—"}</p>
            <div className="mt-2">
              <StaffChip staff={draft.staff} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
              <span className="flex items-center gap-1"><Clock size={12} />{draft.duration ?? "—"} min</span>
              <span className="flex items-center gap-1 font-semibold text-[#C8A46A]">
                <Euro size={12} />{Number(draft.price ?? 0).toFixed(2)}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-3 text-sm font-semibold text-[#2F3A2E]">
        <span>Total estimé</span>
        <span className="text-[#C8A46A]">€{totalPrice.toFixed(2)} • {totalDuration} min</span>
      </div>
    </div>
  );
}

function ModeSwitcher({ mode, onChange }) {
  const options = [
    {
      id: "same-day",
      label: "Même jour",
      sublabel: "Recommandé",
      description: "Tous vos rendez-vous le même jour",
      icon: <Calendar size={20} />,
    },
    {
      id: "multi-day",
      label: "Plusieurs jours",
      sublabel: null,
      description: "Chaque rendez-vous à une date différente",
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
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-500">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#C8A46A] border-t-transparent" />
      <p className="text-sm">Recherche des créneaux les plus proches…</p>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-gray-400">
      <Clock size={32} className="text-gray-300" />
      <p className="text-sm">{message ?? "Aucun créneau disponible pour le moment."}</p>
    </div>
  );
}

// ─── Proposal cards ───────────────────────────────────────────────────────────

function SingleProposalCard({ proposal, selected, onSelect, index }) {
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
              <Sparkles size={10} /> Recommandé
            </span>
          )}
          {!proposal.recommended && (
            <span className="mb-2 inline-block text-xs font-medium text-gray-400">
              Option {index + 1}
            </span>
          )}
          <p className="text-base font-semibold text-[#2F3A2E]">{formatDateLabel(proposal.date)}</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-[#C8A46A]">
            <Clock size={15} />
            {proposal.time}
          </p>
        </div>
        {selected && <CheckCircle2 size={22} className="flex-shrink-0 text-[#C8A46A]" />}
      </div>
    </button>
  );
}

function SameDayProposalCard({ proposal, drafts, selected, onSelect, index }) {
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
              <Sparkles size={10} /> Recommandé
            </span>
          ) : (
            <span className="mb-2 inline-block text-xs font-medium text-gray-400">
              Option {index + 1}
            </span>
          )}

          <p className="text-base font-semibold text-[#2F3A2E]">{formatDateLabel(proposal.date)}</p>
          <p className="mt-1 text-sm text-gray-600">
            {proposal.startTime} → {proposal.finishTime}
            {proposal.totalWaitingTime > 0 && (
              <span className="text-gray-400"> • {proposal.totalWaitingTime} min d&apos;attente</span>
            )}
          </p>

          <div className="mt-4 space-y-2">
            {proposal.appointments.map((appt) => {
              const draft = drafts[appt.draftIndex];
              return (
                <div
                  key={appt.draftIndex}
                  className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-xs"
                >
                  <span className="font-medium text-[#2F3A2E]">
                    {draft?.service?.name ?? `Rendez-vous ${appt.draftIndex + 1}`}
                  </span>
                  <span className="text-[#C8A46A]">{appt.time}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex gap-4 text-xs text-gray-500">
            <span>{proposal.totalDuration} min de soins</span>
            <span>{proposal.appointmentCount} rendez-vous</span>
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
  const [open, setOpen] = useState(true);
  const [availableSlots, setAvailableSlots] = useState([]);
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
      setAvailableSlots([]);
      return;
    }

    setLoadingSlots(true);
    getAvailableSlots(staffServiceId, selectedDate).then((result) => {
      if (result.success) {
        const slots = (result.data.slots || []).filter((s) => s.available);
        setAvailableSlots(slots);

        if (!result.data.isWorkingDay && result.data.reason) {
          toast.error(UNAVAILABLE_REASON_MESSAGES[result.data.reason] || "Ce jour n'est pas disponible");
        }
      } else {
        toast.error(result.message || "Erreur lors du chargement");
        setAvailableSlots([]);
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
              {selectedDate.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} • {selectedTime}
            </span>
          ) : selectedDate ? (
            <span className="rounded-lg bg-white/10 px-3 py-1 text-xs text-white/80">
              {selectedDate.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} — choisir l&apos;heure
            </span>
          ) : (
            <span className="rounded-lg bg-white/10 px-3 py-1 text-xs text-white/60">
              Date et heure non choisies
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
              <span className="flex items-center gap-1"><Clock size={14} />{draft.duration ?? "—"} min</span>
              <span className="flex items-center gap-1 font-semibold text-[#C8A46A]">
                <Euro size={14} />{Number(draft.price ?? 0).toFixed(2)}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 p-4">
            <h4 className="mb-4 text-sm font-semibold text-[#2F3A2E]">Choisissez une date</h4>
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
                <span className="font-medium text-[#2F3A2E]">{formatDateLabel(selectedDate)}</span>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 p-4">
            <h4 className="mb-3 text-sm font-semibold text-[#2F3A2E]">Créneaux disponibles</h4>
            {!selectedDate ? (
              <div className="flex h-24 items-center justify-center text-xs text-gray-400">
                Sélectionnez d&apos;abord une date
              </div>
            ) : loadingSlots ? (
              <div className="flex h-24 items-center justify-center">
                <div className="h-7 w-7 animate-spin rounded-full border-4 border-[#C8A46A] border-t-transparent" />
              </div>
            ) : availableSlots.length === 0 ? (
              <div className="flex h-24 items-center justify-center text-xs text-gray-400">
                Aucun créneau disponible ce jour
              </div>
            ) : (
              <div className="grid max-h-48 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                {availableSlots.map((slot) => (
                  <button
                    key={slot.time}
                    type="button"
                    onClick={() => onTimeSelect(slot.time)}
                    className={`rounded-lg px-2 py-2.5 text-xs font-medium transition-all ${
                      selectedTime === slot.time
                        ? "bg-[#C8A46A] text-white"
                        : "border-2 border-gray-200 bg-white text-[#2F3A2E] hover:border-[#C8A46A]"
                    }`}
                  >
                    <Clock size={13} className="mx-auto mb-1" />
                    {slot.time}
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
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border-2 border-gray-200 p-5">
        <h3 className="mb-1 text-base font-semibold text-[#2F3A2E]">
          Planifiez chaque rendez-vous
        </h3>
        <p className="text-sm text-gray-500">
          Choisissez une date et une heure pour chaque rendez-vous ci-dessous.
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

function SingleDraftView({ draft, selectedDate, selectedTime, onDateSelect, onTimeSelect, onConfirm }) {
  const [disabledDates, setDisabledDates] = useState(new Set());
  const [availableSlots, setAvailableSlots] = useState([]);
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

  // Load available slots whenever the selected date changes
  useEffect(() => {
    if (!selectedDate || !staffServiceId) {
      setAvailableSlots([]);
      return;
    }
    setLoadingSlots(true);
    getAvailableSlots(staffServiceId, selectedDate).then((result) => {
      if (result.success) {
        setAvailableSlots((result.data.slots || []).filter((s) => s.available));
        if (!result.data.isWorkingDay && result.data.reason) {
          toast.error(
            UNAVAILABLE_REASON_MESSAGES[result.data.reason] || "Ce jour n'est pas disponible"
          );
        }
      } else {
        toast.error(result.message || "Erreur lors du chargement");
        setAvailableSlots([]);
      }
      setLoadingSlots(false);
    });
  }, [selectedDate, staffServiceId]);

  return (
    <div className="space-y-5">
      {/* Calendar */}
      <div className="rounded-2xl border-2 border-gray-200 p-5">
        <h3 className="mb-4 text-sm font-semibold text-[#2F3A2E]">Choisissez une date</h3>
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
            <span className="font-medium text-[#2F3A2E]">{formatDateLabel(selectedDate)}</span>
          </div>
        )}
      </div>

      {/* Time slots */}
      <div className="rounded-2xl border-2 border-gray-200 p-5">
        <h3 className="mb-4 text-sm font-semibold text-[#2F3A2E]">Créneaux disponibles</h3>
        {!selectedDate ? (
          <div className="flex h-28 items-center justify-center text-sm text-gray-400">
            Sélectionnez d&apos;abord une date
          </div>
        ) : loadingSlots ? (
          <div className="flex h-28 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#C8A46A] border-t-transparent" />
          </div>
        ) : availableSlots.length === 0 ? (
          <div className="flex h-28 items-center justify-center text-sm text-gray-400">
            Aucun créneau disponible ce jour
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {availableSlots.map((slot) => (
              <button
                key={slot.time}
                type="button"
                onClick={() => onTimeSelect(slot.time)}
                className={`rounded-lg px-2 py-2.5 text-xs font-medium transition-all ${
                  selectedTime === slot.time
                    ? "bg-[#C8A46A] text-white"
                    : "border-2 border-gray-200 bg-white text-[#2F3A2E] hover:border-[#C8A46A]"
                }`}
              >
                <Clock size={13} className="mx-auto mb-1" />
                {slot.time}
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
          className="w-full rounded-xl bg-[#C8A46A] px-6 py-4 text-sm font-semibold text-white transition-all hover:bg-[#B8945A]"
        >
          Confirmer ce créneau
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
}) {
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
      toast.error(result.message || "Erreur lors de la recherche");
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
          Créneaux disponibles
        </h3>
        <p className="mb-5 text-sm text-gray-500">
          Nous avons trouvé les prochains créneaux disponibles. Choisissez celui qui vous convient.
        </p>

        <div className="space-y-3">
          {resultType === "single" &&
            proposals.map((proposal, i) => (
              <SingleProposalCard
                key={`${proposal.date}-${proposal.time}`}
                proposal={proposal}
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
          className="w-[200px] rounded-xl bg-[#C8A46A] px-6 py-4 text-sm font-semibold text-white transition-all hover:bg-[#B8945A]"
        >
          Confirmer cet horaire
        </button>
      )}
     </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function DateTimeStep({ data, updateData, nextStep }) {
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

  const handleSingleConfirm = () => {
    if (!singleDate || !singleTime) {
      toast.error("Veuillez sélectionner une date et une heure");
      return;
    }
    const draft = drafts[0];
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

  const handleAutoConfirm = () => {
    if (!selectedProposal) {
      toast.error("Veuillez sélectionner un créneau");
      return;
    }
    applySameDaySelection(selectedProposal);
    nextStep();
  };

  const handleMultiDayConfirm = () => {
    if (!allMultiDaySelectionsComplete) {
      toast.error("Veuillez choisir une date et une heure pour chaque rendez-vous");
      return;
    }
    const appointments = drafts.map((_, i) => ({
      draftIndex: i,
      date: perDraftDates[i].toISOString(),
      time: perDraftTimes[i],
    }));
    updateData({
      schedulingMode: "multi-day",
      perDraftDates,
      perDraftTimes,
      selectedScheduleProposal: { appointments },
    });
    nextStep();
  };

  const subtitle = isMultiDraft
    ? `${drafts.length} rendez-vous • ${drafts.map((d) => d.staff?.user?.fullName).filter(Boolean).join(", ")}`
    : `${drafts[0]?.staff?.user?.fullName ?? data.staff?.user?.fullName ?? ""} • ${drafts[0]?.service?.name ?? data.service?.name ?? ""}`;

  return (
    <div>
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold text-[#2F3A2E]">
          Choisissez votre créneau
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
                  Comment souhaitez-vous planifier vos rendez-vous ?
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
                      className="w-full rounded-xl bg-[#C8A46A] px-6 py-4 text-sm font-semibold text-white transition-all hover:bg-[#B8945A]"
                    >
                      Confirmer les horaires
                    </button>
                  )}
                </>
              ) : (
                <AutoProposalView
                  drafts={drafts}
                  selectedIndex={selectedIndex}
                  onSelect={handleSelect}
                  onConfirm={handleAutoConfirm}
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
