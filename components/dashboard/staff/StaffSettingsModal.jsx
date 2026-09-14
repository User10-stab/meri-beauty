"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  X,
  Loader2,
  Save,
  CreditCard,
  Settings2,
  Clock,
  CalendarDays,
  Copy,
  Check,
  RefreshCw,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  getStaffSettingsForAdmin,
  updateStaffPaymentSettingsForAdmin,
  updateStaffReservationSettingsForAdmin,
  createStaffTimeOffForAdmin,
  updateStaffTimeOffForAdmin,
  deleteStaffTimeOffForAdmin,
  getOrCreateCalendarTokenForAdmin,
  regenerateCalendarTokenForAdmin,
} from "@/actions/staff/admin-staff-settings";

// ─── Primitives (local, matching EditStaffModal styling) ─────────────────────

function FieldError({ message }) {
  if (!message) return null;
  return <p role="alert" className="mt-1 text-xs font-medium text-red-600">{message}</p>;
}

function Label({ icon: Icon, required, children }) {
  return (
    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-600">
      {Icon && <Icon size={13} className="text-gray-400" />}
      {children}
      {required && <span className="ml-0.5 text-red-400">*</span>}
    </label>
  );
}

function TextInput({ error, className = "", ...props }) {
  return (
    <input
      className={`h-9 w-full rounded-lg border px-3 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:ring-2 ${
        error
          ? "border-red-300 focus:border-red-400 focus:ring-red-100"
          : "border-gray-200 focus:border-indigo-400 focus:ring-indigo-100"
      } ${className}`}
      {...props}
    />
  );
}

function SectionCard({ icon: Icon, title, description, children }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2.5 border-b border-gray-100 px-5 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-50">
          <Icon size={14} className="text-indigo-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {description && <p className="text-xs text-gray-500">{description}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${
        checked ? "bg-indigo-600" : "bg-gray-200"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

// ─── Section: payment ────────────────────────────────────────────────────────

const PAYMENT_METHOD_LABELS = {
  BOTH: "Paiement en ligne et en espèces",
  ONLINE_ONLY: "Paiement en ligne uniquement",
  CASH_ONLY: "Paiement en espèces uniquement",
};

const PAYMENT_METHOD_DESCRIPTIONS = {
  BOTH: "Les clients pourront payer en ligne ou au salon.",
  ONLINE_ONLY: "Les clients ne pourront payer qu'en ligne.",
  CASH_ONLY: "Les clients ne pourront payer qu'au salon.",
};

function PaymentSection({ staffId, value, onSaved }) {
  const [method, setMethod] = useState(value);
  const [isPending, startTransition] = useTransition();

  useEffect(() => { setMethod(value); }, [value]);

  function handleSave() {
    startTransition(async () => {
      const res = await updateStaffPaymentSettingsForAdmin(staffId, {
        allowedPaymentMethods: method,
      });
      if (res.success) {
        toast.success(res.message);
        onSaved(method);
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <SectionCard
      icon={CreditCard}
      title="Paramètres de paiement"
      description="Modes de paiement acceptés par ce professionnel."
    >
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {Object.entries(PAYMENT_METHOD_LABELS).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMethod(key)}
            className={`rounded-lg border px-3.5 py-2.5 text-left transition-all ${
              method === key
                ? "border-indigo-600 bg-indigo-50/50"
                : "border-gray-200 bg-white hover:bg-gray-50"
            }`}
          >
            <div className="text-xs font-semibold text-gray-900">{label}</div>
            <div className="mt-0.5 text-[11px] text-gray-500">
              {PAYMENT_METHOD_DESCRIPTIONS[key]}
            </div>
          </button>
        ))}
      </div>
      <div className="mt-4 flex justify-end border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Enregistrer
        </button>
      </div>
    </SectionCard>
  );
}

// ─── Section: reservation ────────────────────────────────────────────────────

function ReservationSection({ staffId, initial, allowedPaymentMethods, onSaved }) {
  const [mode, setMode] = useState(initial.confirmationMode);
  const [depositEnabled, setDepositEnabled] = useState(initial.depositEnabled);
  const [depositPercentage, setDepositPercentage] = useState(
    String(initial.depositPercentage ?? 10)
  );
  const [errors, setErrors] = useState({});
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setMode(initial.confirmationMode);
    setDepositEnabled(initial.depositEnabled);
    setDepositPercentage(String(initial.depositPercentage ?? 10));
  }, [initial]);

  const acceptsOnline =
    allowedPaymentMethods === "BOTH" || allowedPaymentMethods === "ONLINE_ONLY";

  useEffect(() => {
    if (!acceptsOnline && depositEnabled) setDepositEnabled(false);
  }, [acceptsOnline, depositEnabled]);

  function handleSave() {
    setErrors({});
    startTransition(async () => {
      const res = await updateStaffReservationSettingsForAdmin(staffId, {
        confirmationMode: mode,
        depositEnabled,
        depositPercentage: depositEnabled ? Number(depositPercentage) : null,
      });
      if (res.success) {
        toast.success(res.message);
        onSaved({
          confirmationMode: mode,
          depositEnabled,
          depositPercentage: depositEnabled ? Number(depositPercentage) : 0,
        });
      } else if (res.errors) {
        setErrors(res.errors);
        const first = Object.values(res.errors).find(Boolean);
        if (first) toast.error(first);
        else toast.error(res.message);
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <SectionCard
      icon={Settings2}
      title="Paramètres de réservation"
      description="Confirmation des rendez-vous et acomptes de ce professionnel."
    >
      <div className="space-y-4">
        <div>
          <Label required>Mode de confirmation</Label>
          <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {[
              { key: "AUTOMATIC", title: "Automatique", desc: "Confirmés immédiatement" },
              { key: "MANUAL", title: "Manuel", desc: "À confirmer un par un" },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setMode(opt.key)}
                className={`rounded-lg border px-3.5 py-2.5 text-left transition-all ${
                  mode === opt.key
                    ? "border-indigo-600 bg-indigo-50/50"
                    : "border-gray-200 bg-white hover:bg-gray-50"
                }`}
              >
                <div className="text-xs font-semibold text-gray-900">{opt.title}</div>
                <div className="mt-0.5 text-[11px] text-gray-500">{opt.desc}</div>
              </button>
            ))}
          </div>
          <FieldError message={errors.confirmationMode} />
        </div>

        <div
          className={`flex items-center justify-between rounded-lg border px-3.5 py-2.5 ${
            acceptsOnline ? "border-gray-100 bg-gray-50/50" : "border-amber-200 bg-amber-50"
          }`}
        >
          <div>
            <p className="text-xs font-medium text-gray-900">Acompte</p>
            <p className="text-[11px] text-gray-500">
              {acceptsOnline
                ? "Exiger un acompte à la réservation"
                : "Indisponible : activez le paiement en ligne ci-dessus"}
            </p>
          </div>
          <Toggle
            checked={depositEnabled}
            onChange={() => {
              if (!acceptsOnline) return;
              setDepositEnabled((p) => !p);
            }}
          />
        </div>

        {depositEnabled && (
          <div className="max-w-[180px]">
            <Label required>Pourcentage de l'acompte</Label>
            <div className="relative">
              <TextInput
                type="number"
                min={1}
                max={100}
                step="0.1"
                value={depositPercentage}
                onChange={(e) => setDepositPercentage(e.target.value)}
                error={errors.depositPercentage}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                %
              </span>
            </div>
            <FieldError message={errors.depositPercentage} />
          </div>
        )}

        <div className="flex justify-end border-t border-gray-100 pt-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Enregistrer
          </button>
        </div>
      </div>
    </SectionCard>
  );
}

// ─── Section: time-off (scrollable list) ─────────────────────────────────────

function TimeOffSection({ staffId, items, onChanged }) {
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState(null);
  const todayIso = () => new Date().toISOString().split("T")[0];
  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState(todayIso);
  const [isFullDay, setIsFullDay] = useState(true);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});
  const [editingId, setEditingId] = useState(null);

  function resetForm() {
    setEditingId(null);
    setStartDate(todayIso());
    setEndDate(todayIso());
    setIsFullDay(true);
    setStartTime("09:00");
    setEndTime("17:00");
    setReason("");
    setErrors({});
  }

  function startEdit(item) {
    setEditingId(item.id);
    setStartDate(item.startDate.split("T")[0]);
    setEndDate(item.endDate.split("T")[0]);
    setIsFullDay(item.isFullDay !== false);
    if (item.isFullDay === false) {
      const s = new Date(item.startDate);
      const e = new Date(item.endDate);
      setStartTime(`${String(s.getHours()).padStart(2, "0")}:${String(s.getMinutes()).padStart(2, "0")}`);
      setEndTime(`${String(e.getHours()).padStart(2, "0")}:${String(e.getMinutes()).padStart(2, "0")}`);
    }
    setReason(item.reason ?? "");
    setErrors({});
  }

  function handleSave() {
    setErrors({});
    startTransition(async () => {
      const payload = {
        startDate,
        endDate,
        isFullDay,
        startTime: isFullDay ? undefined : startTime,
        endTime: isFullDay ? undefined : endTime,
        reason,
      };
      const res = editingId
        ? await updateStaffTimeOffForAdmin(editingId, staffId, payload)
        : await createStaffTimeOffForAdmin(staffId, payload);
      if (res.success) {
        toast.success(res.message);
        if (editingId) {
          onChanged(items.map((t) => (t.id === editingId ? { ...t, ...res.data } : t)));
        } else {
          onChanged([...(items || []), res.data]);
        }
        resetForm();
      } else if (res.errors) {
        setErrors(res.errors);
        const first = Object.values(res.errors).find(Boolean);
        if (first) toast.error(first);
        else toast.error(res.message);
      } else {
        toast.error(res.message);
      }
    });
  }

  function handleDelete(id) {
    if (!confirm("Supprimer définitivement cette période d’indisponibilité ?")) return;
    setDeletingId(id);
    startTransition(async () => {
      const res = await deleteStaffTimeOffForAdmin(id, staffId);
      if (res.success) {
        toast.success(res.message);
        onChanged(items.filter((t) => t.id !== id));
        if (editingId === id) resetForm();
      } else {
        toast.error(res.message);
      }
      setDeletingId(null);
    });
  }

  return (
    <SectionCard
      icon={Clock}
      title="Indisponibilités"
      description="Périodes pendant lesquelles ce professionnel n'est pas disponible."
    >
      <div className="space-y-3.5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label required>Date de début</Label>
            <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} error={errors.startDate} />
            <FieldError message={errors.startDate} />
          </div>
          <div>
            <Label required>Date de fin</Label>
            <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} error={errors.endDate} />
            <FieldError message={errors.endDate} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Toggle checked={isFullDay} onChange={() => setIsFullDay(!isFullDay)} />
          <span className="text-xs font-semibold text-gray-700">Journée complète</span>
        </div>

        {!isFullDay && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label required>Heure de début</Label>
              <TextInput type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} error={errors.startTime} />
              <FieldError message={errors.startTime} />
            </div>
            <div>
              <Label required>Heure de fin</Label>
              <TextInput type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} error={errors.endTime} />
              <FieldError message={errors.endTime} />
            </div>
          </div>
        )}

        <div>
          <Label>Motif</Label>
          <textarea
            rows={2}
            placeholder="Ex. Congé, formation, visite médicale…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          <FieldError message={errors.reason} />
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 pt-3.5">
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              disabled={isPending}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Annuler
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {editingId ? "Modifier l’indisponibilité" : "Ajouter l’indisponibilité"}
          </button>
        </div>

        <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3.5">
          <div className="mb-2.5 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-800">Périodes enregistrées</p>
            <span className="text-[11px] text-gray-500">{items.length}</span>
          </div>

          {items.length > 0 ? (
            <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-1.5 rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium text-gray-900">
                      {formatDate(item.startDate)}{" "}
                      {item.endDate && item.endDate !== item.startDate
                        ? `– ${formatDate(item.endDate)}`
                        : ""}
                    </p>
                    {item.isFullDay === false && (
                      <p className="text-[11px] text-gray-500">
                        {new Date(item.startDate).toLocaleTimeString("fr-FR", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "Europe/Brussels",
                        })}
                        {" – "}
                        {new Date(item.endDate).toLocaleTimeString("fr-FR", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "Europe/Brussels",
                        })}
                      </p>
                    )}
                    {item.reason ? (
                      <p className="text-[11px] text-gray-500">{item.reason}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-700">
                      Indisponible
                    </span>
                    <button
                      type="button"
                      onClick={() => startEdit(item)}
                      disabled={isPending}
                      aria-label="Modifier"
                      className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      disabled={isPending}
                      aria-label="Supprimer"
                      className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    >
                      {deletingId === item.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500">Aucune indisponibilité définie pour le moment.</p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

// ─── Section: calendar sync ──────────────────────────────────────────────────

function CalendarSyncSection({ staffId }) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getOrCreateCalendarTokenForAdmin(staffId).then((res) => {
      if (cancelled) return;
      if (res.success) setUrl(`${window.location.origin}/api/calendar-feed/${res.token}`);
      else toast.error(res.message);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [staffId]);

  function handleCopy() {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleRegenerate() {
    startTransition(async () => {
      const res = await regenerateCalendarTokenForAdmin(staffId);
      if (res.success) {
        setUrl(`${window.location.origin}/api/calendar-feed/${res.token}`);
        toast.success("Lien régénéré — l'ancien lien ne fonctionne plus.");
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <SectionCard
      icon={CalendarDays}
      title="Synchronisation de l’agenda"
      description="Lien d’abonnement iCal de ce professionnel (Google, Apple, Outlook)."
    >
      <div className="space-y-3.5">
        <div>
          <Label icon={CalendarDays}>Lien d'abonnement (URL iCal)</Label>
          <div className="flex gap-2">
            <TextInput readOnly value={loading ? "Génération en cours…" : (url ?? "")} className="font-mono text-xs" />
            <button
              type="button"
              onClick={handleCopy}
              disabled={loading}
              aria-label="Copier le lien"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          Ce calendrier se met à jour automatiquement (toutes les 15 à 60 minutes environ).
          Ne partagez ce lien avec personne : quiconque le possède peut voir les rendez-vous.
        </p>
        <button
          type="button"
          onClick={handleRegenerate}
          disabled={isPending || loading}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 transition-colors hover:text-gray-900 disabled:opacity-50"
        >
          {isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Régénérer le lien (si partagé par erreur)
        </button>
      </div>
    </SectionCard>
  );
}

// ─── Modal shell ─────────────────────────────────────────────────────────────

/**
 * Admin view of ONE staff member's booking-related settings.
 * Every section reads/writes scoped to `staff.id` via admin-staff-settings actions.
 */
export function StaffSettingsModal({ staff, onClose }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getStaffSettingsForAdmin(staff.id).then((res) => {
      if (cancelled) return;
      if (res.success) setSettings(res.data);
      else setLoadError(res.message);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [staff.id]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="staff-settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-indigo-100">
              {staff.photo ? (
                <img src={staff.photo} alt={staff.user.fullName} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm font-bold uppercase text-indigo-600">
                  {staff.user.fullName.slice(0, 2)}
                </div>
              )}
            </div>
            <div>
              <h2 id="staff-settings-title" className="text-base font-semibold text-gray-900">
                Paramètres — {staff.user.fullName}
              </h2>
              <p className="text-xs text-gray-400">{staff.user.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="space-y-4" aria-label="Chargement des paramètres">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse rounded-xl border border-gray-100 p-5">
                  <div className="h-4 w-1/3 rounded bg-gray-100" />
                  <div className="mt-3 h-9 rounded bg-gray-100" />
                </div>
              ))}
            </div>
          ) : loadError || !settings ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <p className="font-semibold text-gray-700">Impossible de charger les paramètres</p>
              <p className="text-sm text-gray-400">{loadError ?? "Veuillez réessayer."}</p>
            </div>
          ) : (
            <>
              <PaymentSection
                staffId={staff.id}
                value={settings.allowedPaymentMethods}
                onSaved={(method) =>
                  setSettings((prev) => ({ ...prev, allowedPaymentMethods: method }))
                }
              />
              <ReservationSection
                staffId={staff.id}
                initial={{
                  confirmationMode: settings.reservationConfirmationMode ?? "MANUAL",
                  depositEnabled: settings.depositEnabled,
                  depositPercentage: settings.depositPercentage,
                }}
                allowedPaymentMethods={settings.allowedPaymentMethods}
                onSaved={(updated) => setSettings((prev) => ({ ...prev, ...updated }))}
              />
              <TimeOffSection
                staffId={staff.id}
                items={settings.timeOffs ?? []}
                onChanged={(timeOffs) => setSettings((prev) => ({ ...prev, timeOffs }))}
              />
              <CalendarSyncSection staffId={staff.id} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
