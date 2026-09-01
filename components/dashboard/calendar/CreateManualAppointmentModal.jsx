"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Loader2, User, Search, UserPlus, Calendar, Clock, Scissors, FileText } from "lucide-react";
import {
  createManualAppointment,
  getServicesForManualBooking,
  getStaffForManualBooking,
  searchCustomersForManualBooking,
  getAvailableSlots,
} from "@/actions/appointment/create-manual-appointment";

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

/**
 * Modal for staff/admin to add a phone booking or walk-in directly onto the
 * calendar — the reservation flow that never went through the public site.
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
  const [serviceId, setServiceId] = useState("");
  const [staffOptions, setStaffOptions] = useState([]);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState({});
  const [availableSlots, setAvailableSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [availabilityReason, setAvailabilityReason] = useState(null);

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
    setServiceId("");
    setStaffOptions([]);
    setSelectedStaff(null);
    setDate(defaultDate ? toDateInputValue(defaultDate) : "");
    setTime("");
    setNotes("");
    setErrors({});
    setCustomerMode("search");
    setQuery("");
    setResults([]);
    setSelectedCustomer(null);
    setNewCustomer({ fullName: "", email: "", phone: "" });
    setAvailableSlots([]);
    setAvailabilityReason(null);
    setLoadingSlots(false);
  }, [open, defaultDate]);

  useEffect(() => {
    if (!open) return;
    getServicesForManualBooking().then((res) => {
      if (res.success) setServices(res.data);
      else toast.error(res.message);
    });
  }, [open]);

  // Load the staff members providing the selected service (each with their
  // own price and duration for that service). For STAFF users the list is
  // already filtered to themselves, so auto-select without showing the field.
  useEffect(() => {
    if (!serviceId) {
      setStaffOptions([]);
      setSelectedStaff(null);
      return;
    }
    getStaffForManualBooking(serviceId).then((res) => {
      if (res.success) {
        setStaffOptions(res.data);
        if (!isAdmin && res.data.length > 0) {
          setSelectedStaff(res.data[0]);
        } else {
          setSelectedStaff(null);
        }
      } else {
        toast.error(res.message);
        setStaffOptions([]);
        setSelectedStaff(null);
      }
    });
  }, [serviceId, isAdmin]);

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

  // Fetch available slots when a staff member (staffService) and date are chosen
  useEffect(() => {
    if (!selectedStaff || !date) {
      setAvailableSlots([]);
      setAvailabilityReason(null);
      setTime("");
      return;
    }

    setLoadingSlots(true);
    getAvailableSlots(selectedStaff.staffServiceId, date).then((res) => {
      setLoadingSlots(false);
      if (res.success) {
        setAvailableSlots(res.data.reservationWindows || []);
        setAvailabilityReason(res.data.reason);
        // Clear time if the current selection is no longer available
        if (time && !res.data.reservationWindows?.some(slot => slot.startTime === time)) {
          setTime("");
        }
      } else {
        setAvailableSlots([]);
        setAvailabilityReason(null);
        setTime("");
      }
    });
  }, [selectedStaff, date]);

  const selectedService = useMemo(
    () => (selectedStaff ? { duration: selectedStaff.duration } : null),
    [selectedStaff]
  );

  if (!open) return null;

  function handleSubmit(e) {
    e.preventDefault();
    setErrors({});

    const customer = selectedCustomer
      ? { userId: selectedCustomer.id }
      : { fullName: newCustomer.fullName, email: newCustomer.email, phone: newCustomer.phone };

    if (!selectedCustomer && (!newCustomer.fullName || !newCustomer.email || !newCustomer.phone)) {
      toast.error("Renseignez le nom, l'e-mail et le téléphone du client, ou sélectionnez-en un existant.");
      return;
    }

    // For STAFF users the staff field is hidden and automatically linked to
    // the logged-in staff member; the server resolves it via the session.
    const effectiveStaff = selectedStaff ?? staffOptions[0] ?? null;
    if (!effectiveStaff) {
      toast.error("Veuillez sélectionner une prestation.");
      return;
    }

    startLoading(async () => {
      const result = await createManualAppointment({
        staffId: effectiveStaff.staffId,
        staffServiceId: effectiveStaff.staffServiceId,
        date,
        time,
        notes,
        customer,
      });

      if (result.success) {
        toast.success(result.message);
        onCreated?.();
        onClose();
      } else {
        setErrors(result.errors ?? {});
        // Use the server-provided error message, which will include the specific
        // "Ce créneau vient d'être réservé" message if the slot became unavailable
        toast.error(result.message || "Une erreur est survenue.");
        // If the error is about availability, refresh the slots
        if (result.message?.includes("créneau") || result.message?.includes("disponible")) {
          getAvailableSlots(effectiveStaff.staffServiceId, date).then((res) => {
            if (res.success) {
              setAvailableSlots(res.data.reservationWindows || []);
              setAvailabilityReason(res.data.reason);
              setTime("");
            }
          });
        }
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative flex w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl my-8">
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
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5 max-h-[75vh] overflow-y-auto">
          {/* Service — pick first, then the staff member who does it */}
          <ModalField label="Prestation" required>
            <div className="relative">
              <Scissors size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <select
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
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
                  value={selectedStaff?.staffServiceId ?? ""}
                  onChange={(e) =>
                    setSelectedStaff(staffOptions.find((s) => s.staffServiceId === e.target.value) ?? null)
                  }
                  disabled={!serviceId}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-50 disabled:text-gray-400"
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
                  onChange={(e) => setDate(e.target.value)}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <FieldError message={errors.date} />
            </ModalField>
            <ModalField label="Heure" required>
              <div className="relative">
                <Clock size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                {loadingSlots ? (
                  <div className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-400 flex items-center">
                    Chargement…
                  </div>
                ) : availableSlots.length > 0 ? (
                  <select
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                  >
                    <option value="">Sélectionner…</option>
                    {availableSlots.map((slot) => (
                      <option key={slot.startTime} value={slot.startTime}>
                        {slot.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-400 flex items-center">
                    {date && selectedStaff ? "Aucun créneau disponible" : "Sélectionnez d'abord une date"}
                  </div>
                )}
              </div>
              <FieldError message={errors.time} />
              {availabilityReason && availableSlots.length === 0 && date && selectedStaff && (
                <p className="mt-1 text-xs text-gray-500">
                  {availabilityReason === "Staff not available" && "Membre du personnel non disponible"}
                  {availabilityReason === "User deleted" && "Compte utilisateur supprimé"}
                  {availabilityReason === "No working hours configured" && "Aucun horaire de travail configuré"}
                  {availabilityReason === "No active contract" && "Aucun contrat actif"}
                  {availabilityReason === "Contract has not started yet" && "Le contrat n'a pas encore commencé"}
                  {availabilityReason === "Contract has expired" && "Le contrat a expiré"}
                  {availabilityReason === "Salon closed this day" && "Salon fermé ce jour"}
                  {availabilityReason === "Staff not working this day" && "Membre du personnel ne travaille pas ce jour"}
                  {availabilityReason === "Staff on time off" && "Membre du personnel en congé"}
                  {availabilityReason === "Salon closure" && "Salon fermé"}
                  {!availabilityReason && "Jour non disponible"}
                </p>
              )}
            </ModalField>
          </div>
          {selectedService && (
            <p className="-mt-2 text-xs text-gray-500">
              Se termine vers {(() => {
                if (!time) return "—";
                const [h, m] = time.split(":").map(Number);
                const end = new Date(0, 0, 0, h, m + selectedService.duration);
                return `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
              })()}
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
                  Un compte client est créé automatiquement s'il n'en existe pas déjà un avec cet e-mail.
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

          <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
            Le rendez-vous est ajouté directement en statut confirmé. Le paiement se règle sur place, comme pour tout rendez-vous en espèces — enregistrez-le au moment de terminer le rendez-vous.
          </p>

          {/* Footer */}
          <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading || !selectedStaff || !date || !time}
              className="flex items-center gap-2 rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3d4e3b] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              Ajouter le rendez-vous
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
