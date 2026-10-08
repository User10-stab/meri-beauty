"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X, Loader2, User, Search, UserPlus, Calendar, Clock, Scissors, FileText, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import {
  createManualAppointments,
  getServicesForManualBooking,
  getStaffForManualBooking,
  searchCustomersForManualBooking,
  getAvailableSlots,
} from "@/actions/appointment/create-manual-appointment";

// Mirrors MAX_MANUAL_ITEMS in the server action.
const MAX_PRESTATIONS = 10;

function FieldError({ message }) {
  if (!message) return null;
  return <p className="mt-1 text-xs font-medium text-red-600">{message}</p>;
}

function ModalField({ label, children, required = false }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
        {label}
        {required ? <span className="ml-1 text-red-400">*</span> : null}
      </label>
      {children}
    </div>
  );
}

function formatPrice(amount) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(amount);
}

function formatDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

// `date.toISOString().slice(0, 10)` reads the UTC calendar day, not the
// local one being viewed — for a Brussels-based browser that silently rolls
// the pre-filled date back by a day whenever it runs before ~2am UTC (i.e.
// most of the day, since Brussels is UTC+1/+2). Build the "YYYY-MM-DD" key
// from the Date object's own local components instead.
function toDateInputValue(date) {
  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}

function toMinutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(total) {
  const wrapped = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

let lineSeq = 0;
function newLine(date = "") {
  lineSeq += 1;
  return { key: `line-${lineSeq}`, serviceId: "", staff: null, date, time: "" };
}

// Two prestations of this form, with the same staff member on the same day,
// overlap when one starts before the other is over *including its rest time*
// (the staff's margin for that service). Same rule as manualLegsOverlap in
// the server action, which has the final word.
function linesOverlap(a, b) {
  if (!a.staff || !b.staff || !a.time || !b.time) return false;
  if (a.staff.staffId !== b.staff.staffId || a.date !== b.date) return false;
  const startA = toMinutes(a.time);
  const startB = toMinutes(b.time);
  const occupiedEndA = startA + a.staff.duration + (a.staff.margin ?? 0);
  const occupiedEndB = startB + b.staff.duration + (b.staff.margin ?? 0);
  return startA < occupiedEndB && startB < occupiedEndA;
}

// The client is booked with two different staff members at once: either the
// two start together or one starts while the other is still running. Allowed
// (a manucure and a pédicure done together) but worth a second look.
function sameTimeForClient(a, b) {
  if (!a.staff || !b.staff || !a.time || !b.time) return false;
  if (a.staff.staffId === b.staff.staffId || a.date !== b.date) return false;
  const startA = toMinutes(a.time);
  const startB = toMinutes(b.time);
  return startA < startB + b.staff.duration && startB < startA + a.staff.duration;
}

function lineTimeRange(line) {
  return `${line.time} → ${fromMinutes(toMinutes(line.time) + line.staff.duration)}`;
}

const AVAILABILITY_REASONS = {
  "Staff not available": "Membre du personnel non disponible",
  "User deleted": "Compte utilisateur supprimé",
  "No working hours configured": "Aucun horaire de travail configuré",
  "No active contract": "Aucun contrat actif",
  "Contract has not started yet": "Le contrat n'a pas encore commencé",
  "Contract has expired": "Le contrat a expiré",
  "Salon closed this day": "Salon fermé ce jour",
  "Staff not working this day": "Membre du personnel ne travaille pas ce jour",
  "Staff on time off": "Membre du personnel en congé",
  "Salon closure": "Salon fermé",
};

/**
 * One prestation of the booking: service → staff member → date → time.
 * Owns its own staff list and slot grid; the chosen values live in the
 * parent so the lines can be checked against each other.
 */
function PrestationLine({ index, line, otherLines, services, isAdmin, showHeader, onChange, onRemove, refreshToken, errors }) {
  const [staffOptions, setStaffOptions] = useState([]);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [availabilityReason, setAvailabilityReason] = useState(null);
  const [workingHours, setWorkingHours] = useState(null);
  const [timeDropdownOpen, setTimeDropdownOpen] = useState(false);
  const timeDropdownRef = useRef(null);

  const { serviceId, staff, date, time } = line;
  const staffServiceId = staff?.staffServiceId ?? null;

  // Load the staff members providing the selected service (each with their
  // own price and duration for that service). For STAFF users the list is
  // already filtered to themselves, so auto-select without showing the field.
  useEffect(() => {
    if (!serviceId) {
      setStaffOptions([]);
      return;
    }
    let cancelled = false;
    getStaffForManualBooking(serviceId).then((res) => {
      if (cancelled) return;
      if (res.success) {
        setStaffOptions(res.data);
        if (!isAdmin && res.data.length > 0) onChange({ staff: res.data[0] });
      } else {
        toast.error(res.message);
        setStaffOptions([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [serviceId, isAdmin]);

  // Fetch available slots when a staff member (staffService) and date are chosen
  useEffect(() => {
    if (!staffServiceId || !date) {
      setAvailableSlots([]);
      setAvailabilityReason(null);
      setWorkingHours(null);
      setTimeDropdownOpen(false);
      return;
    }

    let cancelled = false;
    setLoadingSlots(true);
    getAvailableSlots(staffServiceId, date).then((res) => {
      if (cancelled) return;
      setLoadingSlots(false);
      if (res.success) {
        // Reuse same slot-generation as normal reservation flow: fixed 30-min timeline
        // with availability determined by service duration, working hours, appointments, TimeOff, etc.
        // `allTimeSlots` is the canonical timeline (10:00,10:30...16:30 for 10-17), `reservationWindows` is fallback for backward compat
        const slots = res.data.allTimeSlots || res.data.reservationWindows || [];
        setAvailableSlots(slots);
        setAvailabilityReason(res.data.reason);
        setWorkingHours(res.data.workingHours || null);
        // Clear time if the current selection is no longer available (same logic as DateTimeStep)
        const isTimeStillAvailable = slots.some((slot) => slot.startTime === time && slot.available !== false);
        if (time && !isTimeStillAvailable) onChange({ time: "" });
      } else {
        setAvailableSlots([]);
        setAvailabilityReason(null);
        setWorkingHours(null);
        onChange({ time: "" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [staffServiceId, date, refreshToken]);

  // Close time dropdown on outside click / Escape
  useEffect(() => {
    if (!timeDropdownOpen) return;
    function handleClickOutside(e) {
      if (timeDropdownRef.current && !timeDropdownRef.current.contains(e.target)) {
        setTimeDropdownOpen(false);
      }
    }
    function handleKey(e) {
      if (e.key === "Escape") setTimeDropdownOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [timeDropdownOpen]);

  // A slot the server offers is still unusable here if another prestation of
  // this same form already occupies that staff member then (rest time included).
  const takenByOtherLine = (startTime) => otherLines.some((other) => linesOverlap({ ...line, time: startTime }, other));
  const isSlotFree = (slot) => slot.available !== false && !takenByOtherLine(slot.startTime);
  const overlapsOtherLine = Boolean(time) && takenByOtherLine(time);
  const endMinutes = time && staff ? toMinutes(time) + staff.duration : null;
  // Two staff members at the same time is allowed (a manucure and a pédicure
  // done together), but it is just as often a slip — say so, without blocking.
  const sameTimeElsewhere = otherLines.find((other) => sameTimeForClient(line, other)) ?? null;

  return (
    <div className={showHeader ? "space-y-4 rounded-xl border border-gray-200 bg-gray-50/40 p-4" : "space-y-4"}>
      {showHeader && (
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-[#2F3A2E]">Prestation {index + 1}</p>
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 size={13} /> Retirer
          </button>
        </div>
      )}

      {/* Service — pick first, then the staff member who does it */}
      <ModalField label="Prestation" required>
        <div className="relative">
          <Scissors size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <select
            value={serviceId}
            onChange={(e) => onChange({ serviceId: e.target.value, staff: null, time: "" })}
            className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">Sélectionner…</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.categoryName ? `${s.categoryName} — ` : ""}{s.name}
              </option>
            ))}
          </select>
        </div>
        <FieldError message={errors.serviceId ?? errors.staffServiceId} />
      </ModalField>

      {/* Staff — only shown to ADMIN/OWNER; STAFF bookings are auto-linked to themselves */}
      {isAdmin && (
        <ModalField label="Membre du personnel" required>
          <div className="relative">
            <User size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select
              value={staff?.staffServiceId ?? ""}
              onChange={(e) =>
                onChange({ staff: staffOptions.find((s) => s.staffServiceId === e.target.value) ?? null, time: "" })
              }
              disabled={!serviceId}
              className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-50 disabled:text-gray-400"
            >
              <option value="">
                {serviceId ? "Sélectionner…" : "Choisissez d'abord une prestation"}
              </option>
              {staffOptions.map((s) => (
                <option key={s.staffServiceId} value={s.staffServiceId}>
                  {s.staffName} — {formatDuration(s.duration)} — {formatPrice(s.price)}
                </option>
              ))}
            </select>
          </div>
          <FieldError message={errors.staffId} />
        </ModalField>
      )}

      {/* Date / Time */}
      <div className="grid grid-cols-2 gap-3">
        <ModalField label="Date" required>
          <div className="relative">
            <Calendar size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="date"
              value={date}
              onChange={(e) => onChange({ date: e.target.value })}
              className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <FieldError message={errors.date} />
        </ModalField>
        <ModalField label="Heure" required>
          {loadingSlots ? (
            <div className="flex h-9 w-full items-center rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-400">Chargement des créneaux…</div>
          ) : !staff || !date ? (
            <div className="flex h-9 w-full items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-400">Sélectionnez d&apos;abord une date</div>
          ) : availableSlots.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-[#ede5d8]/60 bg-white px-4 py-6 text-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#fdf8f0] border border-[#ede5d8]"><Clock size={16} className="text-[#c2b8aa]" /></div>
              <p className="text-sm font-medium text-[#2F3A2E]">Aucun créneau disponible</p>
              <p className="max-w-[260px] text-xs leading-relaxed text-[#9a9590]">
                {AVAILABILITY_REASONS[availabilityReason] ?? "Jour non disponible — choisissez une autre date"}
              </p>
            </div>
          ) : (
            <div className="relative" ref={timeDropdownRef}>
              <button
                type="button"
                onClick={() => setTimeDropdownOpen((v) => !v)}
                className="flex h-9 w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none transition-colors hover:border-[#b89664]/50 focus:border-[#b89664] focus:ring-2 focus:ring-[#b89664]/20"
                aria-haspopup="listbox"
                aria-expanded={timeDropdownOpen}
              >
                <span className="flex items-center gap-2">
                  <Clock size={14} className="text-gray-400" />
                  {time ? (
                    <span className="flex items-center gap-1.5">
                      <span className="font-semibold text-[#2F3A2E]">{time}</span>
                      <span className="text-gray-300">→</span>
                      <span className="text-[#6f6a64]">{fromMinutes(endMinutes)}</span>
                    </span>
                  ) : (
                    <span className="text-gray-400">Sélectionner une heure</span>
                  )}
                </span>
                {timeDropdownOpen ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
              </button>
              {timeDropdownOpen && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-[#ede5d8] bg-white shadow-lg">
                  <div className="p-3">
                    <p className="mb-2 text-xs font-semibold text-[#2F3A2E]">Sélectionner une heure</p>
                    {workingHours && (
                      <p className="mb-2 text-[11px] text-[#9a9590]">{workingHours.start} – {workingHours.end} • {formatDuration(staff.duration)} • {availableSlots.filter(isSlotFree).length} créneaux libres</p>
                    )}
                    <div className="grid max-h-[176px] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:max-h-[220px]">
                      {availableSlots.map((slot) => {
                        const isAvailable = isSlotFree(slot);
                        const isSelected = time === slot.startTime;
                        const unavailableLabel =
                          slot.available !== false ? "pris par une autre prestation de ce rendez-vous" : "indisponible";
                        return (
                          <button
                            key={slot.startTime}
                            type="button"
                            onClick={() => {
                              if (!isAvailable) return;
                              onChange({ time: slot.startTime });
                              setTimeDropdownOpen(false);
                            }}
                            disabled={!isAvailable}
                            aria-pressed={isSelected}
                            title={isAvailable ? `Réserver à ${slot.startTime}` : `${slot.startTime} — ${unavailableLabel}`}
                            className={`flex h-[38px] items-center justify-center rounded-xl border text-sm font-bold tabular-nums transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b89664]/30 ${
                              !isAvailable
                                ? "cursor-not-allowed border-[#ede5d8] bg-[#fafafa] text-[#c2b8aa] opacity-60"
                                : isSelected
                                  ? "border-[#b89664] bg-[#b89664] text-white shadow-sm"
                                  : "border-[#ede5d8]/70 bg-white text-[#2F3A2E] hover:border-[#b89664] hover:bg-[#fdf8f0]"
                            }`}
                          >
                            {slot.startTime}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-2 flex items-center gap-3 border-t border-[#fdf8f0] pt-2 text-[11px] text-[#9a9590]">
                      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#b89664] border border-[#b89664]" /> Sélectionné</span>
                      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-white border border-[#ede5d8]" /> Libre</span>
                      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#fafafa] border border-[#ede5d8]" /> Occupé</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          <FieldError message={errors.time} />
        </ModalField>
      </div>
      {staff && (
        <p className="-mt-2 text-xs text-gray-500">
          Se termine vers {endMinutes === null ? "—" : fromMinutes(endMinutes)}
          {endMinutes !== null && staff.margin > 0 && (
            <> · temps de repos {formatDuration(staff.margin)}, {staff.staffName} libre à {fromMinutes(endMinutes + staff.margin)}</>
          )}
        </p>
      )}
      {overlapsOtherLine && (
        <p className="-mt-2 text-xs font-medium text-red-600">
          Chevauche une autre prestation de {staff.staffName} (temps de repos compris). Choisissez un autre horaire.
        </p>
      )}
      {sameTimeElsewhere && (
        <p className="-mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Le client a déjà une prestation à ce moment-là : {lineTimeRange(sameTimeElsewhere)} avec {sameTimeElsewhere.staff.staffName}. À garder seulement si les deux se font en même temps.
        </p>
      )}
      <FieldError message={errors.line} />
    </div>
  );
}

/**
 * Modal for staff/admin to add a phone booking or walk-in directly onto the
 * calendar — the reservation flow that never went through the public site.
 * One client, one or several prestations: each prestation has its own staff
 * member, date and time, and becomes its own appointment.
 *
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   onCreated: () => void,
 *   defaultDate?: Date,
 * }} props
 */
export function CreateManualAppointmentModal({
  open,
  onClose,
  onCreated,
  defaultDate = null,
  isAdmin = false,
}) {
  const [loading, startLoading] = useTransition();
  const [services, setServices] = useState([]);
  const [lines, setLines] = useState(() => [newLine()]);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState({});
  // Which prestation a server error is about, and a counter that makes every
  // line reload its slots after a slot was refused.
  const [errorLineKey, setErrorLineKey] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);
  // Asked once, on submit, when prestations run at the same time for the client.
  const [confirmSameTime, setConfirmSameTime] = useState(false);

  // ── Customer: search existing, or fill in a new one ─────────────────────
  const [customerMode, setCustomerMode] = useState("search"); // "search" | "new"
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [newCustomer, setNewCustomer] = useState({ fullName: "", email: "", phone: "" });

  useEffect(() => {
    if (!open) return;
    setServices([]);
    setLines([newLine(defaultDate ? toDateInputValue(defaultDate) : "")]);
    setNotes("");
    setErrors({});
    setErrorLineKey(null);
    setConfirmSameTime(false);
    setCustomerMode("search");
    setQuery("");
    setResults([]);
    setSelectedCustomer(null);
    setNewCustomer({ fullName: "", email: "", phone: "" });
  }, [open, defaultDate]);

  useEffect(() => {
    if (!open) return;
    getServicesForManualBooking().then((res) => {
      if (res.success) setServices(res.data);
      else toast.error(res.message);
    });
  }, [open]);

  useEffect(() => {
    if (customerMode !== "search" || query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      searchCustomersForManualBooking(query).then((res) => {
        if (res.success) setResults(res.data);
        setSearching(false);
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [query, customerMode]);

  if (!open) return null;

  function updateLine(key, patch) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  // A new prestation starts on the same day as the previous one — the usual
  // case is one visit, several services.
  function addLine() {
    setLines((prev) => [...prev, newLine(prev[prev.length - 1]?.date ?? "")]);
  }

  function removeLine(key) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  const several = lines.length > 1;
  const allComplete = lines.every((l) => l.staff && l.date && l.time);
  const hasOverlap = lines.some((a, i) => lines.some((b, j) => i < j && linesOverlap(a, b)));
  const pricedLines = lines.filter((l) => l.staff);
  const totalPrice = pricedLines.reduce((sum, l) => sum + l.staff.price, 0);
  const totalDuration = pricedLines.reduce((sum, l) => sum + l.staff.duration, 0);

  const sameTimePairs = [];
  lines.forEach((a, i) => {
    lines.forEach((b, j) => {
      if (i < j && sameTimeForClient(a, b)) sameTimePairs.push({ a, b, indexA: i, indexB: j });
    });
  });

  function handleSubmit(e, { sameTimeConfirmed = false } = {}) {
    e?.preventDefault();
    setErrors({});
    setErrorLineKey(null);

    const customer = selectedCustomer
      ? { userId: selectedCustomer.id }
      : { fullName: newCustomer.fullName, email: newCustomer.email, phone: newCustomer.phone };

    if (!selectedCustomer && (!newCustomer.fullName || !newCustomer.email || !newCustomer.phone)) {
      toast.error("Renseignez le nom, l'e-mail et le téléphone du client, ou sélectionnez-en un existant.");
      return;
    }

    if (!allComplete) {
      toast.error("Veuillez compléter chaque prestation.");
      return;
    }

    if (sameTimePairs.length > 0 && !sameTimeConfirmed) {
      setConfirmSameTime(true);
      return;
    }
    setConfirmSameTime(false);

    const submitted = lines;
    startLoading(async () => {
      // For STAFF users the staff field is hidden and automatically linked to
      // the logged-in staff member; the server resolves it via the session.
      const result = await createManualAppointments({
        items: submitted.map((l) => ({
          staffId: l.staff.staffId,
          staffServiceId: l.staff.staffServiceId,
          date: l.date,
          time: l.time,
        })),
        notes,
        customer,
      });

      if (result.success) {
        toast.success(result.message);
        onCreated?.();
        onClose();
        return;
      }

      // Use the server-provided error message, which will include the specific
      // "Ce créneau vient d'être réservé" message if the slot became unavailable
      toast.error(result.message || "Une erreur est survenue.");

      if (result.partial) {
        // The first prestations are booked: keep only the ones still to do,
        // so a second click cannot book them twice.
        const done = result.data?.appointments?.length ?? 0;
        const doneKeys = new Set(submitted.slice(0, done).map((l) => l.key));
        setLines((prev) => prev.filter((l) => !doneKeys.has(l.key)));
        setErrorLineKey(submitted[done]?.key ?? null);
        setErrors({ line: "Cette prestation n'a pas pu être enregistrée." });
        setRefreshToken((n) => n + 1);
        onCreated?.();
        return;
      }

      setErrors(result.errors ?? {});
      setErrorLineKey(submitted[result.itemIndex ?? 0]?.key ?? null);
      // If the error is about availability, refresh the slots (same logic as normal flow)
      if (/créneau|disponible|chevauch/.test(result.message ?? "")) {
        setRefreshToken((n) => n + 1);
      }
    });
  }

  // Rendered on <body>: mounted in place, the overlay is positioned against
  // the page's own scrolling container instead of the window, so a tall form
  // ran off-screen with nothing to scroll.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative flex w-full max-w-lg max-h-[92vh] flex-col rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Ajouter un rendez-vous</h2>
            <p className="text-xs text-gray-500">Réservation par téléphone ou sur place, hors du site public.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          {/* Scrolls on its own, so the header and the buttons stay in view however many prestations are added */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {/* Prestations — one or several for the same client */}
          {lines.map((line, index) => (
            <PrestationLine
              key={line.key}
              index={index}
              line={line}
              otherLines={lines.filter((l) => l.key !== line.key)}
              services={services}
              isAdmin={isAdmin}
              showHeader={several}
              onChange={(patch) => updateLine(line.key, patch)}
              onRemove={() => removeLine(line.key)}
              refreshToken={refreshToken}
              errors={errorLineKey === line.key ? errors : {}}
            />
          ))}

          {lines.length < MAX_PRESTATIONS && (
            <button
              type="button"
              onClick={addLine}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 py-2 text-xs font-semibold text-gray-600 transition-colors hover:border-[#b89664] hover:bg-[#fdf8f0] hover:text-[#2F3A2E]"
            >
              <Plus size={14} /> Ajouter une prestation
            </button>
          )}

          {several && pricedLines.length > 0 && (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
              <span className="font-semibold text-gray-800">{lines.length} prestations</span> · {formatDuration(totalDuration)} · {formatPrice(totalPrice)}
              <span className="block text-gray-500">
                Chaque prestation crée son propre rendez-vous : le client reçoit un e-mail par prestation, et chaque membre du personnel un e-mail pour les siennes.
              </span>
            </p>
          )}

          {/* Customer */}
          <ModalField label="Client" required>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCustomerMode("search")}
                className={`flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-semibold transition-colors ${
                  customerMode === "search"
                    ? "border-indigo-450 bg-indigo-50 text-indigo-900"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                <Search size={13} /> Client existant
              </button>
              <button
                type="button"
                onClick={() => setCustomerMode("new")}
                className={`flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-semibold transition-colors ${
                  customerMode === "new"
                    ? "border-indigo-450 bg-indigo-50 text-indigo-900"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                <UserPlus size={13} /> Nouveau client
              </button>
            </div>

            {customerMode === "search" ? (
              selectedCustomer ? (
                <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <User size={14} className="text-gray-400" />
                    <div>
                      <p className="font-medium">{selectedCustomer.fullName}</p>
                      <p className="text-xs text-gray-500">{selectedCustomer.email}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedCustomer(null)}
                    className="text-xs font-semibold text-gray-500 hover:text-gray-700"
                  >
                    Changer
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Nom, e-mail ou téléphone…"
                    className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                  />
                  {(searching || results.length > 0) && (
                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
                      {searching ? (
                        <p className="px-3 py-2 text-xs text-gray-400">Recherche…</p>
                      ) : (
                        results.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setSelectedCustomer(c);
                              setQuery("");
                              setResults([]);
                            }}
                            className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-gray-50"
                          >
                            <span className="font-medium text-gray-800">{c.fullName}</span>
                            <span className="text-xs text-gray-500">{c.email}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  value={newCustomer.fullName}
                  onChange={(e) => setNewCustomer((p) => ({ ...p, fullName: e.target.value }))}
                  placeholder="Nom complet"
                  className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                />
                <input
                  type="email"
                  value={newCustomer.email}
                  onChange={(e) => setNewCustomer((p) => ({ ...p, email: e.target.value }))}
                  placeholder="E-mail"
                  className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                />
                <input
                  type="tel"
                  value={newCustomer.phone}
                  onChange={(e) => setNewCustomer((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="Téléphone"
                  className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                />
                <p className="text-xs text-gray-400">
                  Un compte client est créé automatiquement s&apos;il n&apos;en existe pas déjà un avec cet e-mail.
                </p>
              </div>
            )}
            <FieldError message={errors.customer} />
          </ModalField>

          {/* Notes */}
          <ModalField label="Notes (optionnel)">
            <div className="relative">
              <FileText size={14} className="pointer-events-none absolute left-3 top-3 text-gray-400" />
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-gray-200 pl-8 pr-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100 min-h-[60px] resize-none"
                placeholder="Ex. cliente préfère être appelée avant, allergie connue…"
              />
            </div>
          </ModalField>

          </div>

          {/* Footer */}
          <div className="flex flex-shrink-0 justify-end gap-2 border-t border-gray-100 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading || !allComplete || hasOverlap}
              className="flex items-center gap-2 rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3d4e3b] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {several ? `Ajouter les ${lines.length} rendez-vous` : "Ajouter le rendez-vous"}
            </button>
          </div>
        </form>

        {/* Reminder before saving prestations that run at the same time */}
        {confirmSameTime && (
          <div className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-black/40 p-4">
            <div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
              <h3 className="text-sm font-semibold text-gray-900">Prestations au même moment</h3>
              <p className="mt-1 text-xs text-gray-600">
                Vous êtes sur le point d&apos;ajouter {lines.length} rendez-vous pour le même client, dont certains se déroulent en même temps :
              </p>
              <ul className="mt-3 space-y-2">
                {sameTimePairs.map(({ a, b, indexA, indexB }) => (
                  <li key={`${a.key}-${b.key}`} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <span className="block"><span className="font-semibold">Prestation {indexA + 1}</span> · {lineTimeRange(a)} · {a.staff.staffName}</span>
                    <span className="block"><span className="font-semibold">Prestation {indexB + 1}</span> · {lineTimeRange(b)} · {b.staff.staffName}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-gray-600">Confirmez seulement si ces prestations se font réellement en même temps.</p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmSameTime(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
                >
                  Modifier
                </button>
                <button
                  type="button"
                  onClick={() => handleSubmit(null, { sameTimeConfirmed: true })}
                  className="rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3d4e3b]"
                >
                  Confirmer et ajouter
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
