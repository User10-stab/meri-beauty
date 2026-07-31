"use client";

import { useState } from "react";
import { CreditCard, Wallet, Check, Loader2, Mail } from "lucide-react";
import { createReservation, confirmPayment } from "@/actions/reservation/create-reservation";
import { computePaymentDecision } from "@/lib/reservation-payment";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

// ─── Success screen ───────────────────────────────────────────────────────────

function SuccessScreen({ data, paidAmount, isNewUser, customerEmail }) {
  const draft = data.appointmentDrafts?.[0];
  const dateLabel = data.date
    ? new Date(data.date).toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "—";

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl border-2 border-green-200 bg-gradient-to-br from-green-50 to-white p-10 text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-500">
          <Check size={40} className="text-white" />
        </div>

        <h2 className="mb-3 text-3xl font-bold text-[#2F3A2E]">
          Réservation confirmée !
        </h2>
        <p className="mb-8 text-gray-600">
          Votre rendez-vous a été enregistré avec succès.
        </p>

        <div className="mx-auto mb-8 max-w-md space-y-3 rounded-xl bg-white p-6 text-left shadow-md">
          <Row
            label="Service"
            value={draft?.service?.name ?? data.service?.name ?? "—"}
          />
          <Row label="Date" value={`${dateLabel} à ${data.time}`} />
          <Row
            label="Experte"
            value={
              draft?.staff?.user?.fullName ??
              data.staff?.user?.fullName ??
              "—"
            }
          />
          {paidAmount > 0 && (
            <div className="border-t border-gray-100 pt-3">
              <Row
                label="Montant réglé"
                value={`€${Number(paidAmount).toFixed(2)}`}
                valueClass="font-bold text-green-600"
              />
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg bg-white px-4 py-3 text-left text-sm text-gray-600 shadow-sm">
            <Mail size={16} className="mt-0.5 flex-shrink-0 text-[#C8A46A]" />
            <p>
              Un email de confirmation a été envoyé à{" "}
              <span className="font-medium text-[#2F3A2E]">{customerEmail}</span>.
            </p>
          </div>

          {isNewUser && (
            <div className="flex items-start gap-2 rounded-lg border border-[#C8A46A]/30 bg-[#C8A46A]/5 px-4 py-3 text-left text-sm text-gray-700 shadow-sm">
              <Mail size={16} className="mt-0.5 flex-shrink-0 text-[#C8A46A]" />
              <p>
                Un compte a été créé automatiquement pour vous. Vos identifiants
                de connexion ont été envoyés à la même adresse email.{" "}
                <span className="font-medium text-[#2F3A2E]">
                  Pensez à changer votre mot de passe après votre première
                  connexion.
                </span>
              </p>
            </div>
          )}
        </div>

        <p className="mt-6 text-sm text-gray-400">Redirection en cours…</p>
      </div>
    </div>
  );
}

function Row({ label, value, valueClass = "font-semibold text-[#2F3A2E]" }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-gray-500">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  );
}

// ─── Payment option button ────────────────────────────────────────────────────

function PaymentOption({ icon, title, description, badge, selected, disabled, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`relative w-full rounded-2xl border-2 p-6 text-left transition-all ${
        selected
          ? "border-[#C8A46A] bg-[#C8A46A]/5"
          : "border-gray-200 hover:border-[#C8A46A]/50"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      {badge && (
        <span className="absolute right-4 top-4 rounded-full bg-[#2F3A2E] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          {badge}
        </span>
      )}
      <div className="flex items-center gap-4">
        <div
          className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full ${
            selected ? "bg-[#C8A46A] text-white" : "bg-gray-100 text-gray-600"
          }`}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[#2F3A2E]">{title}</p>
          <p className="mt-0.5 text-sm text-gray-500">{description}</p>
        </div>
        {selected && <Check size={22} className="flex-shrink-0 text-[#C8A46A]" />}
      </div>
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * PaymentStep is only rendered when requiresPaymentStep === true, which means:
 *  - exactly one appointment draft
 *  - confirmationMode === AUTOMATIC
 *
 * Two options are always presented:
 *  A. Payer en ligne  → full price charged now via Stripe
 *  B. Payer au salon  → no charge now (if depositRequired=false)
 *                       OR deposit charge now (if depositRequired=true)
 */
export default function PaymentStep({ data, customerSession }) {
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [completedMeta, setCompletedMeta] = useState(null);
  const router = useRouter();

  const drafts = data.appointmentDrafts ?? [];

  // All amounts and flags from the single source of truth
  const {
    totalAmount,
    depositRequired,
    depositAmount,
    depositPercentage,
  } = computePaymentDecision({ drafts });

  // The amount the customer will pay online right now, per chosen method:
  //   "online" → full price (Stripe, charged immediately)
  //   "cash"   → deposit if depositRequired, otherwise €0
  const amountDueNow =
    paymentMethod === "online"
      ? totalAmount
      : depositRequired
      ? depositAmount
      : 0;

  const draft = drafts[0];
  const staffServiceId = draft?.staffService?.id ?? data.staffService?.id;

  // ── Auto-login helper ─────────────────────────────────────────────────────

  /**
   * Attempts auto-login after a successful reservation.
   * Runs for guest flows where autologinToken and email are returned by the server.
   * Never throws — a login failure must not cancel the reservation.
   */
  const handleAutoSignIn = async (isNewUser, autologinToken, email) => {
    // Already authenticated — nothing to do
    if (customerSession) return;

    if (autologinToken && email) {
      try {
        const result = await signIn("credentials", {
          email,
          autologinToken,
          redirect: false,
        });

        if (result?.error) {
          console.warn("[PaymentStep] auto-signin error:", result.error);
          toast.error(
            "Votre réservation a été confirmée, mais la connexion automatique a échoué. Veuillez vous connecter.",
            { duration: 6000 }
          );
        } else {
          if (isNewUser) {
            toast.success(
              "Réservation créée avec succès ! Votre compte a été créé et vous avez été connecté(e) automatiquement. Un email de bienvenue contenant vos accès vous a été envoyé.",
              { duration: 8000 }
            );
          } else {
            toast.success(
              "Réservation créée avec succès et vous avez été connecté(e) automatiquement.",
              { duration: 6000 }
            );
          }
        }
      } catch (err) {
        console.warn("[PaymentStep] auto-signin failed:", err);
        toast.error(
          "Votre réservation a été confirmée, mais la connexion automatique a échoué. Veuillez vous connecter.",
          { duration: 6000 }
        );
      }
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handlePayment = async () => {
    if (!paymentMethod) {
      toast.error("Veuillez sélectionner un mode de paiement");
      return;
    }

    // "Payer au salon" with no deposit → create appointment directly, no payment record
    if (paymentMethod === "cash" && !depositRequired) {
      await handleSalonNoDeposit();
      return;
    }

    setProcessing(true);
    const loadingToastId = toast.loading("Traitement de votre réservation…");
    try {
      const customerInfo = customerSession
        ? {
            userId:   customerSession.id,
            fullName: customerSession.fullName ?? "",
            email:    customerSession.email    ?? "",
            phone:    customerSession.phone    ?? "",
          }
        : data.customerInfo;

      // Create reservation + payment record
      const reservationResult = await createReservation({
        staffServiceId,
        date:          data.date,
        time:          data.time,
        customerInfo,
        paymentMethod,
        notes:         data.notes,
      });

      if (!reservationResult.success) {
        toast.dismiss(loadingToastId);
        toast.error(
          reservationResult.message ||
            "La réservation a échoué. Veuillez réessayer dans quelques instants."
        );
        setProcessing(false);
        return;
      }

      // Simulate / process payment
      await new Promise((r) => setTimeout(r, 1500));

      const paymentResult = await confirmPayment(
        reservationResult.data.payment.id,
        `DEMO_${Date.now()}`
      );

      toast.dismiss(loadingToastId);

      if (!paymentResult.success) {
        toast.error(
          paymentResult.message ||
            "Le paiement a échoué. Veuillez réessayer ou choisir un autre mode de paiement."
        );
        setProcessing(false);
        return;
      }

      const { isNewUser, autologinToken, user } = reservationResult.data;

      // Auto-login + info toast for new accounts
      if (customerSession) {
        toast.success("Réservation confirmée avec succès !");
      } else {
        await handleAutoSignIn(isNewUser, autologinToken, user?.email);
      }

      setCompletedMeta({
        paidAmount: amountDueNow,
        isNewUser:  Boolean(isNewUser),
        email:      reservationResult.data.user.email,
      });
      setCompleted(true);

      setTimeout(() => router.push("/"), 4000);
    } catch (err) {
      console.error("[PaymentStep] unexpected error:", err);
      toast.dismiss(loadingToastId);
      toast.error("Une erreur est survenue. Veuillez réessayer dans quelques instants.");
      setProcessing(false);
    }
  };

  // "Payer au salon", no deposit required → create appointment without payment
  const handleSalonNoDeposit = async () => {
    setProcessing(true);
    const loadingToastId = toast.loading("Traitement de votre réservation…");
    try {
      const customerInfo = customerSession
        ? {
            userId:   customerSession.id,
            fullName: customerSession.fullName ?? "",
            email:    customerSession.email    ?? "",
            phone:    customerSession.phone    ?? "",
          }
        : data.customerInfo;

      const result = await createReservation({
        staffServiceId,
        date:          data.date,
        time:          data.time,
        customerInfo,
        paymentMethod: "cash",
        notes:         data.notes,
      });

      toast.dismiss(loadingToastId);

      if (!result.success) {
        toast.error(
          result.message || "La réservation a échoué. Veuillez réessayer."
        );
        setProcessing(false);
        return;
      }

      const { isNewUser, autologinToken, user } = result.data;

      // Auto-login + info toast for new accounts
      if (customerSession) {
        toast.success("Réservation confirmée avec succès !");
      } else {
        await handleAutoSignIn(isNewUser, autologinToken, user?.email);
      }

      setCompletedMeta({
        paidAmount: 0,
        isNewUser:  Boolean(isNewUser),
        email:      result.data.user.email,
      });
      setCompleted(true);
      setTimeout(() => router.push("/"), 4000);
    } catch (err) {
      console.error("[PaymentStep] handleSalonNoDeposit:", err);
      toast.dismiss(loadingToastId);
      toast.error("Une erreur est survenue. Veuillez réessayer.");
      setProcessing(false);
    }
  };

  // ── Success screen ────────────────────────────────────────────────────────

  if (completed && completedMeta) {
    return (
      <SuccessScreen
        data={data}
        paidAmount={completedMeta.paidAmount}
        isNewUser={completedMeta.isNewUser}
        customerEmail={completedMeta.email}
      />
    );
  }

  // ── Payment form ──────────────────────────────────────────────────────────

  // Contextual description for the "Payer au salon" option
  const salonDescription = depositRequired
    ? `Acompte de ${depositPercentage}% requis en ligne · Solde au salon`
    : "Aucun paiement en ligne requis · Règlement intégral au salon";

  // Confirm button label
  const confirmLabel = (() => {
    if (!paymentMethod) return "Confirmer et payer";
    if (paymentMethod === "online")
      return `Payer €${Number(totalAmount).toFixed(2)} en ligne`;
    if (depositRequired)
      return `Payer l'acompte €${Number(depositAmount).toFixed(2)}`;
    return "Confirmer — paiement au salon";
  })();

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold text-[#2F3A2E]">Paiement</h2>
        <p className="mt-2 text-gray-600">
          Sélectionnez votre mode de paiement
        </p>
      </div>

      <div className="space-y-6">
        {/* ── Amount summary ─────────────────────────────────── */}
        <div className="rounded-2xl border-2 border-[#C8A46A] bg-gradient-to-br from-[#C8A46A]/5 to-white p-6 text-center">
          <p className="text-sm font-medium text-gray-600">
            Prix total du service
          </p>
          <p className="mt-1 text-4xl font-bold text-[#C8A46A]">
            €{Number(totalAmount).toFixed(2)}
          </p>
          {depositRequired && paymentMethod === "cash" && (
            <p className="mt-2 text-sm text-gray-500">
              Acompte en ligne :{" "}
              <span className="font-semibold text-[#2F3A2E]">
                €{Number(depositAmount).toFixed(2)}
              </span>{" "}
              · Solde au salon :{" "}
              <span className="font-semibold text-[#2F3A2E]">
                €{Number(totalAmount - depositAmount).toFixed(2)}
              </span>
            </p>
          )}
          {paymentMethod === "online" && (
            <p className="mt-2 text-sm text-gray-500">
              Montant total débité maintenant
            </p>
          )}
        </div>

        {/* ── Payment options ─────────────────────────────────── */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[#2F3A2E]">
            Mode de paiement
          </h3>

          <PaymentOption
            icon={<CreditCard size={24} />}
            title="Payer en ligne par Stripe"
            description="Paiement sécurisé — montant total débité immédiatement"
            badge="Montant total"
            selected={paymentMethod === "online"}
            disabled={processing}
            onSelect={() => setPaymentMethod("online")}
          />

          <PaymentOption
            icon={<Wallet size={24} />}
            title="Payer au salon"
            description={salonDescription}
            selected={paymentMethod === "cash"}
            disabled={processing}
            onSelect={() => setPaymentMethod("cash")}
          />
        </div>

        {/* ── Contextual notice ───────────────────────────────── */}
        {paymentMethod === "online" && (
          <div className="rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
            <p className="font-medium">💳 Paiement sécurisé par Stripe</p>
            <p className="mt-1">
              Le montant total de{" "}
              <strong>€{Number(totalAmount).toFixed(2)}</strong> sera débité
              immédiatement de votre carte.
            </p>
          </div>
        )}

        {paymentMethod === "cash" && depositRequired && (
          <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
            <p className="font-medium">⚠️ Acompte obligatoire</p>
            <p className="mt-1">
              Un acompte de{" "}
              <strong>
                {depositPercentage}% (€{Number(depositAmount).toFixed(2)})
              </strong>{" "}
              doit être réglé en ligne maintenant. Le solde de{" "}
              <strong>
                €{Number(totalAmount - depositAmount).toFixed(2)}
              </strong>{" "}
              sera à régler au salon.
            </p>
          </div>
        )}

        {paymentMethod === "cash" && !depositRequired && (
          <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800">
            <p className="font-medium">✓ Aucun paiement en ligne requis</p>
            <p className="mt-1">
              Votre réservation sera confirmée sans paiement en ligne. Vous
              règlerez la totalité au salon.
            </p>
          </div>
        )}

        {/* ── Submit ──────────────────────────────────────────── */}
        <button
          onClick={handlePayment}
          disabled={!paymentMethod || processing}
          className={`w-full rounded-lg px-6 py-4 text-base font-semibold text-white transition-all ${
            !paymentMethod || processing
              ? "cursor-not-allowed bg-gray-300"
              : "bg-[#C8A46A] hover:bg-[#B8945A]"
          }`}
        >
          {processing ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={20} className="animate-spin" />
              Traitement en cours…
            </span>
          ) : (
            confirmLabel
          )}
        </button>

        <p className="text-center text-xs text-gray-400">
          🔒 Paiement sécurisé · Vos données sont protégées
        </p>
      </div>
    </div>
  );
}
