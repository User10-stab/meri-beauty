"use client";

import { Calendar, Clock, User, Mail, Phone, Tag, Euro, FileText, Check } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { createReservation } from "@/actions/reservation/create-reservation";
import { computePaymentDecision } from "@/lib/reservation-payment";
import { toast } from "sonner";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

// ─── Shared primitives ────────────────────────────────────────────────────────

function SectionHeader({ title }) {
  return (
    <div className="bg-gradient-to-r from-[#2F3A2E] to-[#3d4e3b] p-6">
      <h3 className="text-lg font-semibold text-white">{title}</h3>
    </div>
  );
}

function InfoRow({ icon, label, children }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1 flex-shrink-0 text-[#C8A46A]">{icon}</span>
      <div>
        <p className="text-sm font-medium text-gray-600">{label}</p>
        <div className="text-base font-semibold text-[#2F3A2E]">{children}</div>
      </div>
    </div>
  );
}

function StaffAvatar({ staff }) {
  const name = staff?.user?.fullName ?? "?";
  return (
    <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-full">
      {staff?.photo ? (
        <Image src={staff.photo} alt={name} fill className="object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#C8A46A] to-[#B8945A] text-lg font-bold text-white">
          {name.charAt(0)}
        </div>
      )}
    </div>
  );
}

function formatDate(date) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Europe/Brussels",
  });
}

// ─── Single-appointment service details card ──────────────────────────────────

function SingleServiceCard({ data }) {
  return (
    <div className="overflow-hidden rounded-2xl border-2 border-gray-200">
      <SectionHeader title="Détails du service" />
      <div className="space-y-4 p-6">
        <InfoRow icon={<Tag size={20} />} label="Catégorie">
          {data.appointmentDrafts[0]?.category?.name ?? data.category?.name ?? "—"}
        </InfoRow>
        <InfoRow icon={<Tag size={20} />} label="Service">
          {data.appointmentDrafts[0]?.service?.name ?? data.service?.name ?? "—"}
        </InfoRow>
        <InfoRow icon={<User size={20} />} label="Experte">
          <div className="mt-1 flex items-center gap-3">
            <span>
              {data.appointmentDrafts[0]?.staff?.user?.fullName ??
                data.staff?.user?.fullName ??
                "—"}
            </span>
          </div>
        </InfoRow>
        <InfoRow icon={<Calendar size={20} />} label="Date">
          {formatDate(data.date)}
        </InfoRow>
        <InfoRow icon={<Clock size={20} />} label="Heure">
          {data.time} (
          {data.appointmentDrafts[0]?.duration ??
            data.staffService?.duration ??
            "—"}{" "}
          minutes)
        </InfoRow>
      </div>
    </div>
  );
}

// ─── Multi-appointment summary card ──────────────────────────────────────────

function MultiServiceCard({ drafts }) {
  return (
    <div className="overflow-hidden rounded-2xl border-2 border-gray-200">
      <SectionHeader title={`${drafts.length} rendez-vous`} />
      <div className="divide-y divide-gray-100">
        {drafts.map((draft, i) => (
          <div key={i} className="p-5">
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-[#C8A46A]">
              Rendez-vous {i + 1}
            </p>
            <div className="space-y-3">
              <InfoRow icon={<Tag size={16} />} label="Service">
                {draft.service?.name ?? "—"}
              </InfoRow>
              <InfoRow icon={<User size={16} />} label="Experte">
                <div className="mt-1 flex items-center gap-2">
                 
                  <span>{draft.staff?.user?.fullName ?? "—"}</span>
                </div>
              </InfoRow>
              <div className="flex items-center gap-6 pt-1 text-sm text-gray-500">
                <span className="flex items-center gap-1">
                  <Clock size={14} />
                  {draft.duration ?? "—"} min
                </span>
                <span className="flex items-center gap-1 font-semibold text-[#C8A46A]">
                  <Euro size={14} />
                  {Number(draft.price ?? 0).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Customer info card ───────────────────────────────────────────────────────

function CustomerCard({ data, customerSession }) {
  const info = customerSession
    ? {
        fullName: customerSession.fullName,
        email: customerSession.email,
        phone: customerSession.phone,
      }
    : data.customerInfo;

  return (
    <div className="overflow-hidden rounded-2xl border-2 border-gray-200">
      <SectionHeader title="Vos informations" />
      <div className="space-y-4 p-6">
        <InfoRow icon={<User size={20} />} label="Nom">
          {info?.fullName ?? "—"}
        </InfoRow>
        <InfoRow icon={<Mail size={20} />} label="Email">
          {info?.email ?? "—"}
        </InfoRow>
        <InfoRow icon={<Phone size={20} />} label="Téléphone">
          {info?.phone ?? "—"}
        </InfoRow>
        {data.notes && (
          <InfoRow icon={<FileText size={20} />} label="Notes">
            <span className="font-normal">{data.notes}</span>
          </InfoRow>
        )}
      </div>
    </div>
  );
}

// ─── Payment preview cards ────────────────────────────────────────────────────

function AutomaticPaymentPreview({ paymentDecision }) {
  const { totalAmount, depositRequired, depositAmount, depositPercentage } = paymentDecision;
  const remainingAmount = totalAmount - depositAmount;

  return (
    <div className="overflow-hidden rounded-2xl border-2 border-[#C8A46A] bg-gradient-to-br from-[#C8A46A]/5 to-white">
      <div className="bg-[#C8A46A] p-6">
        <h3 className="text-lg font-semibold text-white">Résumé du paiement</h3>
      </div>
      <div className="p-6">
        <div className="space-y-3">
          {/* Total price */}
          <div className="flex items-center justify-between text-base">
            <span className="text-gray-600">Prix du service</span>
            <span className="font-semibold text-[#2F3A2E]">
              €{Number(totalAmount).toFixed(2)}
            </span>
          </div>

          <div className="border-t border-gray-200" />

          {depositRequired ? (
            <>
              {/* Deposit required — show the split */}
              <div className="flex items-center justify-between text-base">
                <span className="font-medium text-gray-600">
                  Acompte à payer en ligne ({depositPercentage}%)
                </span>
                <span className="font-bold text-[#C8A46A]">
                  €{Number(depositAmount).toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between text-base">
                <span className="font-medium text-gray-600">
                  Reste à payer au salon
                </span>
                <span className="font-semibold text-[#2F3A2E]">
                  €{Number(remainingAmount).toFixed(2)}
                </span>
              </div>
              <div className="mt-2 rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
                <p className="font-medium">ℹ️ Acompte requis</p>
                <p className="mt-1">
                  Si vous choisissez de payer au salon, un acompte de{" "}
                  {depositPercentage}% est requis en ligne pour confirmer votre
                  réservation.
                </p>
              </div>
            </>
          ) : (
            /* No deposit — customer pays fully at the salon or online */
            <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800">
              <p className="flex items-center gap-1.5 font-medium">
                <Check size={15} /> Aucun acompte requis
              </p>
              <p className="mt-1">
                Si vous choisissez de payer au salon, aucun paiement en ligne
                n&apos;est requis aujourd&apos;hui.
              </p>
            </div>
          )}

          <div className="border-t-2 border-gray-300" />

          <div className="flex items-center justify-between text-xl">
            <span className="font-bold text-[#2F3A2E]">Total</span>
            <span className="font-bold text-[#2F3A2E]">
              €{Number(totalAmount).toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// No promo-code field here: a MANUAL-mode request has no Payment row (and no
// online charge) until staff confirms it, and confirmation
// (actions/appointment/manage-appointment.js#confirmAppointment) rebuilds the
// price from scratch off the raw StaffService price for its own separate
// payment link — there's nowhere downstream a discount applied at this step
// would actually survive to. Promo codes for appointments only apply to the
// AUTOMATIC/pay-now path (PaymentStep.jsx), where Payment is created
// immediately with the discount already baked in.
function ManualModeNotice() {
  return (
    <div className="overflow-hidden rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-white">
      <div className="bg-amber-500 p-6">
        <h3 className="text-lg font-semibold text-white">
          Demande de réservation
        </h3>
      </div>
      <div className="p-6">
        <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium">⏳ Réservation en attente de confirmation</p>
          <p className="mt-2">
            Votre demande sera examinée par notre équipe. Si elle est acceptée,
            vous recevrez un email avec un lien de paiement pour finaliser votre
            réservation. En cas de refus, vous serez également informé(e) par
            email.
          </p>
        </div>
      </div>
    </div>
  );
}

function MultiAppointmentNotice({ totalAmount }) {
  return (
    <div className="overflow-hidden rounded-2xl border-2 border-gray-200">
      <SectionHeader title="Informations de paiement" />
      <div className="p-6">
        <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
          <p className="font-medium">💳 Paiement au salon</p>
          <p className="mt-1">
            Pour une réservation avec plusieurs rendez-vous, le règlement
            s&apos;effectue directement au salon.
          </p>
        </div>
        <div className="mt-4 flex items-center justify-between text-base font-semibold text-[#2F3A2E]">
          <span>Total estimé</span>
          <span className="text-[#C8A46A]">€{Number(totalAmount).toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReviewStep({ data, nextStep, customerSession }) {
  const [processing, setProcessing] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const router = useRouter();

  const drafts = data.appointmentDrafts ?? [];
  const isMultiDraft = drafts.length > 1;

  // Single source of truth for all payment decisions
  const paymentDecision = computePaymentDecision({ drafts });
  const { requiresPaymentStep, isManualMode, totalAmount } = paymentDecision;

  // ── Build customerInfo ──────────────────────────────────────────────────
  const buildCustomerInfo = () =>
    customerSession
      ? {
          userId:   customerSession.id,
          fullName: customerSession.fullName ?? "",
          email:    customerSession.email    ?? "",
          phone:    customerSession.phone    ?? "",
        }
      : data.customerInfo;

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleContinue = async () => {
    if (requiresPaymentStep) {
      // AUTOMATIC mode with payment step — advance to PaymentStep
      nextStep();
      return;
    }
    // All other cases: create appointment(s) directly here
    await handleDirectBooking();
  };

  const handleDirectBooking = async () => {
    if (!acceptedTerms) {
      toast.error("Veuillez accepter les CGV et la politique de confidentialité.");
      return;
    }
    setProcessing(true);
    const loadingToastId = toast.loading("Traitement de votre réservation…");
    try {
      const customerInfo = buildCustomerInfo();

      if (isMultiDraft) {
        // Multi-appointment: no payment, create all and redirect
        const { createMultipleReservations } = await import(
          "@/actions/reservation/create-reservation"
        );
        const apptInputs = buildMultiDraftInputs(data);
        const result = await createMultipleReservations({
          appointments: apptInputs,
          customerInfo,
          paymentMethod: null,
          notes: data.notes,
          isManualMode: false,
          // Re-checked and recorded server-side — the guard above is only a
          // courtesy message, the action is a public endpoint.
          termsAccepted: acceptedTerms,
        });
        toast.dismiss(loadingToastId);
        if (!result.success) {
          toast.error(result.message || "La réservation a échoué.");
          setProcessing(false);
          return;
        }

        // Auto-login for guest accounts (multi-reservation path)
        if (customerSession) {
          toast.success("Réservations enregistrées avec succès !");
        } else {
          await handleAutoSignIn(
            result.data?.isNewUser,
            result.data?.autologinToken,
            result.data?.user?.email,
            false
          );
        }
      } else {
        // Single appointment, MANUAL or no-deposit path
        const draft = drafts[0];
        const staffServiceId =
          draft?.staffService?.id ?? data.staffService?.id;
        const { createReservation } = await import(
          "@/actions/reservation/create-reservation"
        );
        const result = await createReservation({
          staffServiceId,
          date:         data.date,
          time:         data.time,
          customerInfo,
          paymentMethod: null,
          notes:         data.notes,
          isManualMode:  isManualMode,
          termsAccepted: acceptedTerms,
        });
        toast.dismiss(loadingToastId);
        if (!result.success) {
          toast.error(result.message || "La réservation a échoué.");
          setProcessing(false);
          return;
        }

        // Auto-login for guest accounts (single-reservation path)
        if (customerSession) {
          toast.success(
            isManualMode
              ? "Demande de réservation envoyée avec succès !"
              : "Réservation confirmée avec succès !"
          );
        } else {
          await handleAutoSignIn(
            result.data?.isNewUser,
            result.data?.autologinToken,
            result.data?.user?.email,
            isManualMode
          );
        }
      }

      setTimeout(() => router.push("/"), 2000);
    } catch (err) {
      console.error("[ReviewStep] handleDirectBooking:", err);
      toast.dismiss(loadingToastId);
      toast.error("Une erreur est survenue. Veuillez réessayer.");
      setProcessing(false);
    }
  };

  /**
   * Attempts auto-login after a successful reservation.
   * Runs for guest flows where autologinToken and email are returned by the server.
   * Never throws — a login failure must not cancel the reservation.
   */
  const handleAutoSignIn = async (isNewUser, autologinToken, email, isManual = false) => {
    // Logged-in users already have a session — nothing to do
    if (customerSession) return;

    if (autologinToken && email) {
      try {
        const signInResult = await signIn("credentials", {
          email,
          autologinToken,
          redirect: false,
        });

        if (signInResult?.error) {
          console.warn("[ReviewStep] auto-signin error:", signInResult.error);
          toast.error(
            "Votre réservation a été créée, mais la connexion automatique a échoué. Veuillez vous connecter.",
            { duration: 6000 }
          );
        } else {
          if (isNewUser) {
            toast.success(
              isManual
                ? "Demande de réservation envoyée ! Votre compte a été créé et vous avez été connecté(e) automatiquement. Un email de bienvenue contenant vos accès vous a été envoyé."
                : "Réservation créée avec succès ! Votre compte a été créé et vous avez été connecté(e) automatiquement. Un email de bienvenue contenant vos accès vous a été envoyé.",
              { duration: 8000 }
            );
          } else {
            toast.success(
              isManual
                ? "Demande de réservation envoyée avec succès et vous avez été connecté(e) automatiquement."
                : "Réservation créée avec succès et vous avez été connecté(e) automatiquement.",
              { duration: 6000 }
            );
          }
        }
      } catch (err) {
        console.warn("[ReviewStep] auto-signin failed:", err);
        toast.error(
          "Votre réservation a été créée, mais la connexion automatique a échoué. Veuillez vous connecter.",
          { duration: 6000 }
        );
      }
    }
  };

  // ── CTA label ────────────────────────────────────────────────────────────
  const ctaLabel = (() => {
    if (processing)
      return (
        <span className="flex items-center justify-center gap-2">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
          Traitement en cours…
        </span>
      );
    if (requiresPaymentStep) return "Procéder au paiement";
    if (isManualMode) return "Envoyer la demande de réservation";
    return "Confirmer la réservation";
  })();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold text-[#2F3A2E]">
          Récapitulatif de votre réservation
        </h2>
        <p className="mt-2 text-gray-600">
          Vérifiez les détails avant de confirmer
        </p>
      </div>

      <div className="space-y-6">
        {/* ── Appointment details ─────────────────────────────── */}
        {isMultiDraft ? (
          <MultiServiceCard drafts={drafts} />
        ) : (
          <SingleServiceCard data={data} />
        )}

        {/* ── Customer information ────────────────────────────── */}
        <CustomerCard data={data} customerSession={customerSession} />

        {/* ── Payment section ─────────────────────────────────── */}
        {isMultiDraft && (
          <MultiAppointmentNotice totalAmount={totalAmount} />
        )}
        {!isMultiDraft && isManualMode && <ManualModeNotice />}
        {!isMultiDraft && !isManualMode && (
          <AutomaticPaymentPreview paymentDecision={paymentDecision} />
        )}

        {/* ── Terms acceptance ─────────────────────────────────── */}
        {/* Only shown here when this screen is the actual commitment point —
            the AUTOMATIC/payment path shows its own checkbox on PaymentStep. */}
        {!requiresPaymentStep && (
          <label className="flex items-start gap-2.5 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              J&apos;ai lu et j&apos;accepte les{" "}
              <a href="/cgv" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#C8A46A]">
                Conditions générales de vente
              </a>{" "}
              et la{" "}
              <a href="/politique-de-confidentialite" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#C8A46A]">
                Politique de confidentialité
              </a>
              .
            </span>
          </label>
        )}

        {/* ── CTA ─────────────────────────────────────────────── */}
        <button
          onClick={handleContinue}
          disabled={processing || (!requiresPaymentStep && !acceptedTerms)}
          className={`w-full rounded-lg px-6 py-4 text-base font-semibold text-white transition-all ${
            processing || (!requiresPaymentStep && !acceptedTerms)
              ? "cursor-not-allowed bg-gray-300"
              : "bg-[#C8A46A] hover:bg-[#B8945A]"
          }`}
        >
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Helper — build multi-draft appointment inputs ────────────────────────────

/**
 * Map reservationData into the array expected by createMultipleReservations.
 * Supports same-day (selectedScheduleProposal) and multi-day (perDraftDates/Times).
 */
function buildMultiDraftInputs(data) {
  const drafts = data.appointmentDrafts ?? [];
  const proposal = data.selectedScheduleProposal;

  return drafts.map((draft, i) => {
    if (proposal?.appointments) {
      // Same-day auto-scheduled
      const appt = proposal.appointments.find((a) => a.draftIndex === i);
      return {
        staffServiceId: draft.staffService.id,
        date:           new Date(proposal.date),
        time:           appt?.time ?? data.time,
      };
    }
    // Multi-day manual selection
    return {
      staffServiceId: draft.staffService.id,
      date:           data.perDraftDates?.[i] ?? data.date,
      time:           data.perDraftTimes?.[i] ?? data.time,
    };
  });
}
