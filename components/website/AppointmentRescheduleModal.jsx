"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { X, ChevronLeft, ChevronRight, Clock, Loader2 } from "lucide-react";
import { getAvailableSlots, getMonthAvailability } from "@/actions/reservation/get-available-slots";
import { rescheduleAppointment } from "@/actions/reservation/reschedule-appointment";

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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isSameDay(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isDateInPast(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

export function AppointmentRescheduleModal({ appointment, onClose, onRescheduled }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [disabledDates, setDisabledDates] = useState(new Set());
  const [windows, setWindows] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    getMonthAvailability(appointment.staffServiceId, currentMonth).then((r) => {
      if (r.success) setDisabledDates(new Set(r.data.unavailableDates || []));
    });
  }, [appointment.staffServiceId, currentMonth]);

  useEffect(() => {
    if (!selectedDate) {
      setWindows([]);
      return;
    }
    setLoadingSlots(true);
    getAvailableSlots(appointment.staffServiceId, selectedDate).then((result) => {
      if (result.success) {
        setWindows(result.data.reservationWindows || []);
      } else {
        toast.error(result.message || "Erreur lors du chargement des créneaux.");
        setWindows([]);
      }
      setLoadingSlots(false);
    });
  }, [selectedDate, appointment.staffServiceId]);

  const days = getDaysInMonth(currentMonth);
  const isDisabled = (date) => {
    if (!date) return true;
    if (isDateInPast(date)) return true;
    return disabledDates.has(getDateKey(date));
  };

  async function handleConfirm() {
    if (!selectedDate || !selectedTime) return;
    setSubmitting(true);
    const result = await rescheduleAppointment(appointment.id, { date: selectedDate, time: selectedTime });
    setSubmitting(false);
    if (result.success) {
      toast.success(result.message ?? "Rendez-vous déplacé.");
      onRescheduled();
    } else {
      toast.error(result.message ?? "Impossible de déplacer ce rendez-vous.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Modifier le rendez-vous"
        className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-ink/8 px-5 py-4">
          <div>
            <p className="text-sm font-bold text-ink">Modifier le rendez-vous</p>
            <p className="mt-0.5 text-xs text-ink/45">{appointment.serviceName} · {appointment.staffName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1))}
              className="rounded-lg p-1.5 text-ink/50 hover:bg-ink/5"
              aria-label="Mois précédent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-ink">
              {MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => setCurrentMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1))}
              className="rounded-lg p-1.5 text-ink/50 hover:bg-ink/5"
              aria-label="Mois suivant"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {DAYS.map((d) => (
              <div key={d} className="pb-1 text-center text-[10px] font-semibold text-ink/35">{d}</div>
            ))}
            {days.map((day, i) => (
              <button
                key={i}
                type="button"
                disabled={isDisabled(day)}
                onClick={() => {
                  setSelectedDate(day);
                  setSelectedTime(null);
                }}
                className={`h-8 w-full rounded-md border text-xs font-medium transition-colors ${
                  !day
                    ? "invisible"
                    : isDisabled(day)
                    ? "cursor-not-allowed border-transparent text-ink/20"
                    : isSameDay(day, selectedDate)
                    ? "border-gold bg-gold text-white"
                    : "border-transparent bg-cream text-ink hover:border-gold/40"
                }`}
              >
                {day ? day.getDate() : ""}
              </button>
            ))}
          </div>

          <div className="mt-5">
            <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-ink/45">Créneaux disponibles</p>
            {!selectedDate ? (
              <p className="py-6 text-center text-xs text-ink/35">Choisissez d&apos;abord une date.</p>
            ) : loadingSlots ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-gold" />
              </div>
            ) : windows.length === 0 ? (
              <p className="py-6 text-center text-xs text-ink/35">Aucun créneau disponible ce jour.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {windows.map((w) => (
                  <button
                    key={w.startTime}
                    type="button"
                    onClick={() => setSelectedTime(w.startTime)}
                    className={`inline-flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-medium transition-colors ${
                      selectedTime === w.startTime
                        ? "bg-gold text-white"
                        : "border border-ink/10 bg-white text-ink hover:border-gold/40"
                    }`}
                  >
                    <Clock className="h-3 w-3" />
                    {w.startTime}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-ink/8 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-ink/10 px-4 py-2.5 text-sm font-semibold text-ink/60 transition-colors hover:bg-ink/5"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedDate || !selectedTime || submitting}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gold px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gold/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmer
          </button>
        </div>
      </div>
    </div>
  );
}
