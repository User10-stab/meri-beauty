"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Wallet, Loader2 } from "lucide-react";
import { confirmAcceptedAppointment } from "@/actions/appointment/confirm-accepted-appointment";

export default function ConfirmAcceptedAppointmentClient({ appointment }) {
  const router = useRouter();
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [processing, setProcessing] = useState(false);
  const isCashOnly = appointment.staffService.allowedPaymentMethods === "CASH_ONLY";
  const acceptsOnline = !isCashOnly && ["BOTH", "ONLINE_ONLY"].includes(appointment.staffService.allowedPaymentMethods);
  const acceptsCash = ["BOTH", "CASH_ONLY"].includes(appointment.staffService.allowedPaymentMethods);
  const depositRequired = acceptsOnline && appointment.staffService.depositEnabled && appointment.depositPercentage > 0;
  const depositAmount = appointment.price * appointment.depositPercentage / 100;

  async function handleConfirm(method = paymentMethod) {
    if (!method) return;
    setProcessing(true);
    const result = await confirmAcceptedAppointment(appointment.id, method);
    if (!result.success) {
      window.alert(result.message);
      setProcessing(false);
      return;
    }
    if (result.url) {
      window.location.href = result.url;
      return;
    }
    router.push("/mes-reservations");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold text-[#2F3A2E]">Confirmez votre réservation</h1>
        <p className="mt-2 text-gray-600">{appointment.serviceName} avec {appointment.staffName}</p>
        <p className="mt-1 text-sm text-gray-500">{new Date(appointment.date).toLocaleDateString("fr-FR")} à {new Date(appointment.startTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</p>

        {!isCashOnly && (
          <div className="mt-6 space-y-3">
            {acceptsOnline && (
              <button type="button" onClick={() => setPaymentMethod("online")} className={`flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left ${paymentMethod === "online" ? "border-[#C8A46A] bg-[#C8A46A]/5" : "border-gray-200"}`}>
                <CreditCard className="text-[#C8A46A]" />
                <span><strong>Payer le total avec Stripe</strong><br /><small className="text-gray-500">€{appointment.price.toFixed(2)}</small></span>
              </button>
            )}
            {acceptsCash && (
              <button type="button" onClick={() => setPaymentMethod("cash")} className={`flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left ${paymentMethod === "cash" ? "border-[#C8A46A] bg-[#C8A46A]/5" : "border-gray-200"}`}>
                <Wallet className="text-[#C8A46A]" />
                <span><strong>{depositRequired ? `Payer au salon avec un acompte de €${depositAmount.toFixed(2)} maintenant` : "Payer au salon"}</strong><br /><small className="text-gray-500">{depositRequired ? `Le solde de €${(appointment.price - depositAmount).toFixed(2)} sera payé au salon.` : "Aucun paiement en ligne."}</small></span>
              </button>
            )}
          </div>
        )}

        {isCashOnly && <p className="mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">Cette réservation est confirmée sans paiement en ligne. Vous réglerez au salon.</p>}

        <button type="button" onClick={() => handleConfirm(isCashOnly ? "cash" : paymentMethod)} disabled={processing || (!isCashOnly && !paymentMethod)} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#C8A46A] px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {processing && <Loader2 className="h-4 w-4 animate-spin" />}
          Confirmer ma réservation
        </button>
      </div>
    </main>
  );
}
