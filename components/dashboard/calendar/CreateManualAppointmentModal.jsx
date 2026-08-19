"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Loader2, User, Search, UserPlus, Calendar, Clock, Scissors, FileText } from "lucide-react";
import {
  createManualAppointment,
  getStaffServicesForManualBooking,
  searchCustomersForManualBooking,
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
 *   staffList: Array<{ id: string, name: string }>,
 *   isAdmin: boolean,
 *   currentStaffId: string|null,
 *   defaultDate?: Date,
 * }} props
 */
export function CreateManualAppointmentModal({
  open,
  onClose,
  onCreated,
  staffList = [],
  isAdmin,
  currentStaffId = null,
  defaultDate = null,
}) {
  const [loading, startLoading] = useTransition();
  const [staffId, setStaffId] = useState("");
  const [services, setServices] = useState([]);
  const [staffServiceId, setStaffServiceId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState({});

  // ── Customer: search existing, or fill in a new one ─────────────────────
  const [customerMode, setCustomerMode] = useState("search"); // "search" | "new"
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [newCustomer, setNewCustomer] = useState({ fullName: "", email: "", phone: "" });

  useEffect(() => {
    if (!open) return;
    setStaffId(isAdmin ? "" : (currentStaffId ?? ""));
    setServices([]);
    setStaffServiceId("");
    setDate(defaultDate ? toDateInputValue(defaultDate) : "");
    setTime("");
    setNotes("");
    setErrors({});
    setCustomerMode("search");
    setQuery("");
    setResults([]);
    setSelectedCustomer(null);
    setNewCustomer({ fullName: "", email: "", phone: "" });
  }, [open, isAdmin, currentStaffId, defaultDate]);

  useEffect(() => {
    if (!staffId) {
      setServices([]);
      setStaffServiceId("");
      return;
    }
    getStaffServicesForManualBooking(staffId).then((res) => {
      if (res.success) setServices(res.data);
      else toast.error(res.message);
    });
  }, [staffId]);

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

  const selectedService = useMemo(
    () => services.find((s) => s.id === staffServiceId) ?? null,
    [services, staffServiceId]
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

    startLoading(async () => {
      const result = await createManualAppointment({
        staffId,
        staffServiceId,
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
        toast.error(result.message || "Une erreur est survenue.");
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
          {/* Staff — admin picks, staff is locked to themselves */}
          {isAdmin && (
            <ModalField label="Membre du personnel" required>
              <select
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="">Sélectionner…</option>
                {staffList.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <FieldError message={errors.staffId} />
            </ModalField>
          )}

          {/* Service */}
          <ModalField label="Prestation" required>
            <div className="relative">
              <Scissors size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <select
                value={staffServiceId}
                onChange={(e) => setStaffServiceId(e.target.value)}
                disabled={!staffId}
                className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">{staffId ? "Sélectionner…" : "Choisissez d'abord un membre du personnel"}</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.serviceName} — {formatDuration(s.duration)} — {formatPrice(s.price)}
                  </option>
                ))}
              </select>
            </div>
            <FieldError message={errors.staffServiceId} />
          </ModalField>

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
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <FieldError message={errors.time} />
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
              disabled={loading || !staffId || !staffServiceId || !date || !time}
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
