"use client";

import { useState } from "react";
import { CreditCard, Wallet, Check, Loader2, Mail } from "lucide-react";
import { createReservation, confirmPayment } from "@/actions/reservation/create-reservation";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

// ─── Success screen ───────────────────────────────────────────────────────────

function SuccessScreen({ data, depositAmount, isNewUser, customerEmail }) {
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
        {/* Icon */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-500">
          <Check size={40} className="text-white" />
        </div>

        <h2 className="mb-3 text-3xl font-bold text-[#2F3A2E]">
          Réservation confirmée !
        </h2>
        <p className="mb-8 text-gray-600">
          Votre rendez-vous a été enregistré avec succès.
        </p>

        {/* Summary card */}
        <div className="mx-auto mb-8 max-w-md space-y-3 rounded-xl bg-white p-6 text-left shadow-md">
          <Row label="Service"   value={data.service?.name ?? "—"} />
          <Row label="Date"      value={`${dateLabel} à ${data.time}`} />
          <Row label="Experte"   value={data.staff?.user?.fullName ?? "—"} />
          <div className="border-t border-gray-100 pt-3">
            <Row
              label="Acompte réglé"
              value={`€${Number(depositAmount).toFixed(2)}`}
              valueClass="font-bold text-green-600"
            />
          </div>
        </div>

        {/* Email notices */}
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
                  Pensez à changer votre mot de passe après votre première connexion.
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function PaymentStep({ data, customerSession }) {
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [processing, setProcessing]       = useState(false);
  const [completed, setCompleted]         = useState(false);
  const [completedMeta, setCompletedMeta] = useState(null); // { depositAmount, isNewUser, email }
  const router = useRouter();

  const totalAmount   = Number(data.staffService?.price ?? 0);
  const depositAmount = Math.max(totalAmount * 0.1, 10);

  const handlePayment = async () => {
    if (!paymentMethod) {
      toast.error("Veuillez sélectionner un mode de paiement");
      return;
    }

    setProcessing(true);

    try {
      // ── 1. Build customerInfo — inject userId for authenticated sessions ──
      const customerInfo = customerSession
        ? {
            userId:    customerSession.id,
            fullName:  customerSession.fullName ?? "",
            email:     customerSession.email    ?? "",
            phone:     customerSession.phone    ?? "",
          }
        : data.customerInfo;

      // ── 2. Create reservation ─────────────────────────────────────────────
      const reservationResult = await createReservation({
        staffServiceId: data.staffService.id,
        date:           data.date,
        time:           data.time,
        customerInfo,
        paymentMethod,
        notes:          data.notes,
      });

      if (!reservationResult.success) {
        toast.error(
          reservationResult.message || "La réservation a échoué. Veuillez réessayer dans quelques instants."
        );
        setProcessing(false);
        return;
      }

      // ── 3. Simulate / process payment ─────────────────────────────────────
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const paymentResult = await confirmPayment(
        reservationResult.data.payment.id,
        `DEMO_${Date.now()}`
      );

      if (!paymentResult.success) {
        toast.error(
          paymentResult.message || "Le paiement a échoué. Veuillez réessayer ou choisir un autre mode de paiement."
        );
        setProcessing(false);
        return;
      }

      // ── 4. Auto-signin for brand-new accounts ─────────────────────────────
      const { isNewUser, newUserCredentials } = reservationResult.data;

      if (isNewUser && newUserCredentials) {
        try {
          await signIn("credentials", {
            email:    newUserCredentials.email,
            password: newUserCredentials.password,
            redirect: false,
          });
        } catch (signinErr) {
          // Non-critical — reservation is already confirmed; customer can log
          // in manually using the credentials sent by email.
          console.warn("[PaymentStep] auto-signin failed:", signinErr);
        }
      }

      // ── 5. Show success screen then redirect ──────────────────────────────
      toast.success("Réservation confirmée avec succès !");
      setCompletedMeta({
        depositAmount,
        isNewUser: Boolean(isNewUser),
        email: reservationResult.data.user.email,
      });
      setCompleted(true);

      setTimeout(() => {
        // Customers land on the public home; the session (if signed in) will
        // be reflected in the navbar without needing a dashboard redirect.
        router.push("/");
      }, 4000);
    } catch (error) {
      console.error("[PaymentStep] unexpected error:", error);
      toast.error("Une erreur est survenue. Veuillez réessayer dans quelques instants.");
      setProcessing(false);
    }
  };

  // ── Success screen ─────────────────────────────────────────────────────────
  if (completed && completedMeta) {
    return (
      <SuccessScreen
        data={data}
        depositAmount={completedMeta.depositAmount}
        isNewUser={completedMeta.isNewUser}
        customerEmail={completedMeta.email}
      />
    );
  }

  // ── Payment form ───────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold text-[#2F3A2E]">Paiement</h2>
        <p className="mt-2 text-gray-600">
          Sélectionnez votre mode de paiement pour l'acompte
        </p>
      </div>

      <div className="space-y-6">
        {/* Amount summary */}
        <div className="rounded-2xl border-2 border-[#C8A46A] bg-gradient-to-br from-[#C8A46A]/5 to-white p-6 text-center">
          <p className="text-sm font-medium text-gray-600">
            Montant de l'acompte à payer
          </p>
          <p className="mt-2 text-4xl font-bold text-[#C8A46A]">
            €{depositAmount.toFixed(2)}
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Sur un total de €{totalAmount.toFixed(2)}
          </p>
        </div>

        {/* Payment method selection */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[#2F3A2E]">
            Mode de paiement
          </h3>

          <PaymentOption
            id="online"
            icon={<CreditCard size={24} />}
            title="Payer en ligne avec Stripe"
            description="Paiement sécurisé par carte bancaire"
            selected={paymentMethod === "online"}
            disabled={processing}
            onSelect={() => setPaymentMethod("online")}
          />

          <PaymentOption
            id="cash"
            icon={<Wallet size={24} />}
            title="Payer au salon"
            description="Acompte requis en ligne · Paiement final sur place"
            selected={paymentMethod === "cash"}
            disabled={processing}
            onSelect={() => setPaymentMethod("cash")}
          />
        </div>

        {/* Notice */}
        <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium">⚠️ Acompte obligatoire</p>
          <p className="mt-1">
            Quel que soit le mode de paiement choisi, un acompte minimum de 10%
            doit être réglé en ligne pour confirmer votre réservation.
          </p>
        </div>

        {/* Submit */}
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
            `Confirmer et payer €${depositAmount.toFixed(2)}`
          )}
        </button>

        <p className="text-center text-xs text-gray-400">
          🔒 Paiement sécurisé · Vos données sont protégées
        </p>
      </div>
    </div>
  );
}

// ─── Payment option button ────────────────────────────────────────────────────

function PaymentOption({ icon, title, description, selected, disabled, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`w-full rounded-2xl border-2 p-6 text-left transition-all ${
        selected
          ? "border-[#C8A46A] bg-[#C8A46A]/5"
          : "border-gray-200 hover:border-[#C8A46A]/50"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
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
