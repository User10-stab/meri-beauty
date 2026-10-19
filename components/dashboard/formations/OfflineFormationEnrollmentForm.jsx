"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { createOfflineFormationReservation } from "@/actions/formations/create-offline-reservation";
import { getOfflineEnrolmentOptions } from "@/actions/formations/get-offline-enrolment-options";
import { getCounterCustomDateMonth, getCounterCustomDateSlots } from "@/actions/counter/custom-dates";
import { CustomDatePicker } from "@/components/formations/CustomDatePicker";
import { calculateOfflineFormationPayment } from "@/lib/formations/offline-payment";

const CUSTOM_DATE_VALUE = "__custom_date__";
const inputClass = "mt-1.5 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 disabled:opacity-60";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-gray-600";

function money(value) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(value) || 0);
}

function formatSessionDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

/**
 * Offline enrolment popup: records a student whose deposit / full price was
 * already received by bank transfer outside the site.
 *
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string} [props.formationId] restricts the popup to one formation
 */
export function OfflineFormationEnrollmentForm({ open, onClose, formationId: presetFormationId = "" }) {
  const router = useRouter();
  const [formations, setFormations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formationId, setFormationId] = useState("");
  const [sessionChoice, setSessionChoice] = useState("");
  const [customDate, setCustomDate] = useState(null);
  const [paymentMode, setPaymentMode] = useState("DEPOSIT");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [completed, setCompleted] = useState(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    setCompleted(null);
    setSessionChoice("");
    setCustomDate(null);
    setPaymentConfirmed(false);
    getOfflineEnrolmentOptions({ formationId: presetFormationId || undefined })
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          setLoadError(result.message ?? "Impossible de charger les formations.");
          setFormations([]);
          return;
        }
        setFormations(result.data);
        setFormationId(result.data[0]?.id ?? "");
      })
      .catch(() => {
        if (!cancelled) setLoadError("Impossible de charger les formations.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, presetFormationId]);

  const formation = formations.find((item) => item.id === formationId) ?? null;
  const sessions = formation?.sessions ?? [];
  const isCustom = sessionChoice === CUSTOM_DATE_VALUE && Boolean(formation?.customDate);
  const session = isCustom ? null : sessions.find((item) => item.id === sessionChoice) ?? sessions[0] ?? null;
  const total = Number(formation?.price ?? 0);
  const depositPercentage = Math.min(100, Math.max(0, Number(formation?.depositPercentage ?? 50)));
  const { paidAmount: amountPaid, balanceDue: balance } = calculateOfflineFormationPayment(
    total,
    depositPercentage,
    paymentMode,
  );

  // A private formation with no scheduled session can only be a date libre.
  const effectiveCustom = isCustom || (!session && Boolean(formation?.customDate));

  const canSubmit = useMemo(
    () =>
      Boolean(
        formation &&
          (effectiveCustom ? customDate : session) &&
          firstName.trim() &&
          lastName.trim() &&
          paymentConfirmed,
      ),
    [formation, effectiveCustom, customDate, session, firstName, lastName, paymentConfirmed],
  );

  if (!open) return null;

  function changeFormation(value) {
    setFormationId(value);
    setSessionChoice("");
    setCustomDate(null);
    setPaymentConfirmed(false);
  }

  function changeSession(value) {
    setSessionChoice(value);
    setCustomDate(null);
    setPaymentConfirmed(false);
  }

  function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;

    startTransition(async () => {
      const result = await createOfflineFormationReservation({
        ...(effectiveCustom
          ? { customDate: { formationId: formation.id, ...customDate } }
          : { sessionId: session.id }),
        firstName,
        lastName,
        email,
        paymentMode,
        paymentConfirmed: true,
      });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      setCompleted(result.data);
      toast.success(result.message);
      router.refresh();
    });
  }

  function resetForm() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPaymentMode("DEPOSIT");
    setPaymentConfirmed(false);
    setSessionChoice("");
    setCustomDate(null);
    setCompleted(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative my-8 flex w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Ajouter une élève hors ligne</h2>
            <p className="text-xs text-gray-500">
              Le virement indiqué ici est enregistré comme déjà reçu, sans paiement par Stripe.
            </p>
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

        {completed ? (
          <div className="space-y-4 px-6 py-5">
            <div className="flex items-center gap-2 font-semibold text-emerald-800">
              <CheckCircle2 className="h-5 w-5" /> Inscription enregistrée
            </div>
            <p className="text-sm text-emerald-900">
              {completed.customerName} — {money(completed.paidAmount)} reçu par virement sur {money(completed.totalAmount)}.
              {completed.balanceDue > 0 ? ` Solde restant : ${money(completed.balanceDue)}.` : " La formation est entièrement payée."}
            </p>
            {completed.checkInCode && (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-gray-700">
                Code de pointage à communiquer à l&apos;élève : <strong className="font-mono">{completed.checkInCode}</strong>
              </p>
            )}
            {completed.invoiceNumber && <p className="text-xs text-emerald-800">Facture n°{completed.invoiceNumber} créée.</p>}
            <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
              <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Fermer
              </button>
              <button type="button" onClick={resetForm} className="rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                Ajouter une autre élève
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 px-6 py-12 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : loadError || formations.length === 0 ? (
          <div className="space-y-4 px-6 py-5">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {loadError || "Aucune séance de formation du salon n'a actuellement de place disponible pour une inscription hors ligne."}
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Fermer
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 px-6 py-5">
            <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
              <label className={labelClass}>
                Formation
                <select required value={formationId} onChange={(e) => changeFormation(e.target.value)} className={inputClass}>
                  {formations.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                </select>
              </label>
              <label className={labelClass}>
                Séance
                <select
                  required
                  value={effectiveCustom ? CUSTOM_DATE_VALUE : session?.id ?? ""}
                  onChange={(e) => changeSession(e.target.value)}
                  className={inputClass}
                >
                  {sessions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {formatSessionDate(item.startDate)} · {item.remainingSeats} place{item.remainingSeats > 1 ? "s" : ""} restante{item.remainingSeats > 1 ? "s" : ""}
                    </option>
                  ))}
                  {formation?.customDate && <option value={CUSTOM_DATE_VALUE}>Date libre — choisir avec l&apos;élève</option>}
                </select>
              </label>

              {effectiveCustom && (
                <CustomDatePicker
                  formationId={formation.id}
                  durationMinutes={formation.durationMinutes}
                  value={customDate}
                  onChange={setCustomDate}
                  loadMonth={getCounterCustomDateMonth}
                  loadSlots={getCounterCustomDateSlots}
                />
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>
                  Prénom <span className="text-red-400">*</span>
                  <input required maxLength={80} autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
                </label>
                <label className={labelClass}>
                  Nom <span className="text-red-400">*</span>
                  <input required maxLength={80} autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
                </label>
              </div>

              <label className={labelClass}>
                E-mail <span className="font-normal normal-case text-gray-400">(facultatif — confirmation envoyée si renseigné)</span>
                <input type="email" maxLength={254} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
              </label>

              <label className={labelClass}>
                Paiement reçu
                <select
                  value={paymentMode}
                  onChange={(e) => {
                    setPaymentMode(e.target.value);
                    setPaymentConfirmed(false);
                  }}
                  className={inputClass}
                >
                  <option value="DEPOSIT">Acompte ({depositPercentage} %)</option>
                  <option value="FULL">Paiement intégral</option>
                </select>
              </label>
              <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-800">
                <div className="flex justify-between gap-4"><span>Montant reçu par virement</span><strong>{money(amountPaid)}</strong></div>
                <div className="mt-1 flex justify-between gap-4 text-gray-500"><span>Prix total</span><span>{money(total)}</span></div>
                {balance > 0 && <div className="mt-1 flex justify-between gap-4 text-amber-700"><span>Solde restant</span><strong>{money(balance)}</strong></div>}
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <input
                  type="checkbox"
                  required
                  checked={paymentConfirmed}
                  onChange={(e) => setPaymentConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#2f3a2e]"
                />
                <span>Je confirme avoir déjà reçu le virement bancaire de {money(amountPaid)}. Le montant restant, s&apos;il y en a un, restera dû.</span>
              </label>
            </div>

            <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
              <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Annuler
              </button>
              <button
                type="submit"
                disabled={!canSubmit || isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-[#2f3a2e] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                {isPending ? "Enregistrement…" : "Enregistrer l'inscription"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
