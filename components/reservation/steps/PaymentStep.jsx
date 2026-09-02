"use client";

import { useState } from "react";
import { Check, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { createReservation } from "@/actions/reservation/create-reservation";
import { createCheckoutSession } from "@/actions/payment/createCheckoutSession";
import { computePaymentDecision } from "@/lib/reservation-payment";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PromoCodeField } from "@/components/shared/PromoCodeField";
import CardBotanicalSprigs from "@/components/reservation/CardBotanicalSprigs";

function PaymentOption({ title, description, badge, selected, disabled, index, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`relative w-full overflow-hidden rounded-xl border-2 bg-[#fdf8f0]/80 pl-11 pr-5 pt-8 pb-10 text-left transition-all ${
        selected ? "border-[#b89664] bg-white shadow-[0_8px_28px_rgba(47,58,46,0.12)]" : "border-[#ede5d8]/70 shadow-[0_2px_16px_rgba(47,58,46,0.04)] hover:-translate-y-1 hover:border-[#b89664] hover:bg-[#f5ece0] hover:shadow-[0_10px_28px_rgba(47,58,46,0.08)]"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <CardBotanicalSprigs index={index} />
      {badge && (<span className={`absolute right-4 rounded-full bg-[#2F3A2E] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white ${selected ? "top-12" : "top-4"}`}>{badge}</span>)}
      {selected && <Check size={20} className="absolute right-4 top-4 text-[#2F3A2E]" />}
      <p className="mb-2 text-[15px] font-bold uppercase text-[#b89664]">{title}</p>
      <div className="mt-4 h-px w-10 bg-[#b89664]/20" />
      <p className="mt-2 text-[14px] leading-relaxed text-[#232a21]">{description}</p>
      <span className="mt-6 inline-flex rounded-full border border-[#b89664] bg-[#b89664] px-4 py-2 text-[12px] font-medium text-white transition-all hover:shadow-md">Choisir ce mode</span>
    </button>
  );
}

export default function PaymentStep({ data, customerSession }) {
  const t = useTranslations("reservationSteps");
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const router = useRouter();

  const drafts = data.appointmentDrafts ?? [];
  const draft = drafts[0];
  const rawTotal = drafts.reduce((sum, d) => sum + Number(d.price ?? 0), 0);
  const discountAmount = appliedPromo?.discountAmount ?? 0;

  const { totalAmount, depositRequired, depositAmount, depositPercentage, salonPaymentAvailable } = computePaymentDecision({ drafts, discountAmount });

  const allowedPaymentMethods = draft?.staffService?.staff?.allowedPaymentMethods;
  const acceptsOnlinePayments = allowedPaymentMethods === "BOTH" || allowedPaymentMethods === "ONLINE_ONLY";
  const acceptsCashPayments = salonPaymentAvailable && (allowedPaymentMethods === "BOTH" || allowedPaymentMethods === "CASH_ONLY");

  const amountDueNow = paymentMethod === "online" ? totalAmount : depositRequired ? depositAmount : 0;
  const staffServiceId = draft?.staffService?.id ?? data.staffService?.id;

  const handlePayment = async () => {
    if (!paymentMethod) { toast.error(t("payment.selectPaymentMethod")); return; }
    if (!acceptedTerms) { toast.error(t("payment.acceptTermsRequired")); return; }
    if (paymentMethod === "cash" && !depositRequired) { await handleSalonNoDeposit(); return; }
    setProcessing(true);
    const loadingToastId = toast.loading(t("payment.redirecting"));
    try {
      const customerInfo = customerSession ? { userId: customerSession.id, fullName: customerSession.fullName ?? "", email: customerSession.email ?? "", phone: customerSession.phone ?? "" } : data.customerInfo;
      const result = await createCheckoutSession({ staffServiceId, date: data.date, time: data.time, customerInfo, paymentMethod, notes: data.notes, promoCode: appliedPromo?.code ?? null, termsAccepted: acceptedTerms });
      toast.dismiss(loadingToastId);
      if (!result.success || !result.url) { toast.error((result.message || t("payment.sessionFailed")) + (result.error ? ` — ${result.error}` : "")); setProcessing(false); return; }
      if (!customerSession && result.autologinToken && result.customerEmail) {
        try { await signIn("credentials", { email: result.customerEmail, autologinToken: result.autologinToken, redirect: false }); } catch {}
      }
      window.location.href = result.url;
    } catch (err) {
      console.error("[PaymentStep] unexpected error:", err);
      toast.dismiss(loadingToastId);
      toast.error(t("payment.genericError"));
      setProcessing(false);
    }
  };

  const handleSalonNoDeposit = async () => {
    setProcessing(true);
    const loadingToastId = toast.loading(t("review.processing"));
    try {
      const customerInfo = customerSession ? { userId: customerSession.id, fullName: customerSession.fullName ?? "", email: customerSession.email ?? "", phone: customerSession.phone ?? "" } : data.customerInfo;
      const result = await createReservation({ staffServiceId, date: data.date, time: data.time, customerInfo, paymentMethod: "cash", notes: data.notes, promoCode: appliedPromo?.code ?? null, termsAccepted: acceptedTerms });
      toast.dismiss(loadingToastId);
      if (!result.success) { toast.error(result.message || t("payment.reservationFailed")); setProcessing(false); return; }
      const { isNewUser, autologinToken, user } = result.data;
      if (!customerSession && autologinToken && user?.email) { try { await signIn("credentials", { email: user.email, autologinToken, redirect: false }); } catch {} }
      toast.success(t("payment.reservationConfirmed"));
      setTimeout(() => router.push("/"), 2000);
    } catch (err) {
      console.error("[PaymentStep] handleSalonNoDeposit:", err);
      toast.dismiss(loadingToastId);
      toast.error(t("payment.genericError"));
      setProcessing(false);
    }
  };

  const salonDescription = depositRequired ? t("payment.salonDepositDesc", { percentage: depositPercentage }) : t("payment.salonNoDepositDesc");
  const confirmLabel = (() => {
    if (!paymentMethod) return t("payment.confirmPay");
    if (paymentMethod === "online") return t("payment.payOnline", { amount: Number(totalAmount).toFixed(2) });
    if (depositRequired) return t("payment.payDeposit", { amount: Number(depositAmount).toFixed(2) });
    return t("payment.confirmSalon");
  })();

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h2 className="font-display text-[1.7rem] font-semibold leading-tight tracking-tight text-[#2F3A2E]">{t("payment.title")}</h2>
        <p className="mt-2 text-sm text-[#6f6a64]">{t("payment.subtitle")}</p>
        <div className="mt-3 h-px w-10 bg-[#b89664]/20" />
      </div>

      <div className="space-y-5">
        {/* Amount summary — premium split */}
        <div className="relative overflow-hidden rounded-xl border-2 border-[#ede5d8]/70 bg-[#fdf8f0]/80 pl-11 pr-5 pt-8 pb-10 text-left shadow-[0_2px_16px_rgba(47,58,46,0.04)]">
          <CardBotanicalSprigs />
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#b89664]">{t("payment.totalServicePrice")}</p>
          <div className="mt-4 h-px w-10 bg-[#b89664]/20" />
          {discountAmount > 0 ? (
            <>
              <p className="mt-2 text-lg text-[#9a9590] line-through">€{rawTotal.toFixed(2)}</p>
              <p className="text-4xl font-bold tracking-tight text-[#2F3A2E]">€{Number(totalAmount).toFixed(2)}</p>
              <p className="mt-1 text-sm font-medium text-emerald-700">{t("payment.discount", { code: appliedPromo.code, amount: discountAmount.toFixed(2) })}</p>
            </>
          ) : (
            <p className="mt-2 text-4xl font-bold tracking-tight text-[#2F3A2E]">€{Number(totalAmount).toFixed(2)}</p>
          )}

          {/* Breakdown when deposit */}
          {paymentMethod === "cash" && depositRequired && (
            <div className="mx-auto mt-4 max-w-sm rounded-xl border border-[#ede5d8]/50 bg-[#fdf8f0] px-4 py-3 text-xs">
              <div className="flex justify-between"><span className="text-[#6f6a64]">{t("payment.depositOnline")}</span><span className="font-semibold text-[#2F3A2E]">€{Number(depositAmount).toFixed(2)}</span></div>
              <div className="mt-1 flex justify-between"><span className="text-[#6f6a64]">{t("payment.balanceInSalon")}</span><span className="font-semibold text-[#2F3A2E]">€{Number(totalAmount - depositAmount).toFixed(2)}</span></div>
            </div>
          )}
          {paymentMethod === "online" && (<p className="mt-3 text-xs text-[#6f6a64]">{t("payment.fullAmountDebited")}</p>)}

          {!paymentMethod && depositRequired && (
            <p className="mt-3 text-xs text-[#9a9590]"><span className="font-medium text-[#2F3A2E]">Acompte {depositPercentage}%</span> • Vous choisissez ci-dessous</p>
          )}
        </div>

        <PromoCodeField subtotal={rawTotal} onApplied={setAppliedPromo} />

        <div className="space-y-3">
          <h3 className="text-sm font-semibold tracking-wide text-[#2F3A2E]">{t("payment.paymentMethod")}</h3>
          <PaymentOption
            index={0}
            title={t("payment.payOnlineTitle")}
            description={acceptsOnlinePayments ? t("payment.payOnlineDesc") : t("payment.payOnlineUnavailable")}
            badge={t("payment.badgeTotal")}
            selected={paymentMethod === "online"}
            disabled={processing || !acceptsOnlinePayments}
            onSelect={() => { if (!acceptsOnlinePayments) return; setPaymentMethod("online"); }}
          />
          <PaymentOption
            index={1}
            title={t("payment.payAtSalonTitle")}
            description={acceptsCashPayments ? salonDescription : t("payment.payAtSalonUnavailable")}
            selected={paymentMethod === "cash"}
            disabled={processing || !acceptsCashPayments}
            onSelect={() => { if (!acceptsCashPayments) return; setPaymentMethod("cash"); }}
          />
        </div>

        {paymentMethod === "online" && (
          <div className="rounded-xl border border-[#dbeafe] bg-[#eff6ff] px-4 py-3 text-xs leading-relaxed text-[#1e40af]">
            <p className="font-semibold flex items-center gap-1.5"><ShieldCheck size={14} />{t("payment.secureStripeNotice")}</p>
            <p className="mt-1">{t("payment.onlineNoticeDesc", { amount: `€${Number(totalAmount).toFixed(2)}` })}</p>
          </div>
        )}
        {paymentMethod === "cash" && depositRequired && (
          <div className="rounded-xl border border-amber-100 bg-[#fffbeb] px-4 py-3 text-xs leading-relaxed text-amber-800">
            <p className="font-semibold">{t("payment.depositRequired")}</p>
            <p className="mt-1">{t("payment.depositNoticeDesc", { percentage: depositPercentage, amount: `€${Number(depositAmount).toFixed(2)}`, balance: `€${Number(totalAmount - depositAmount).toFixed(2)}` })}</p>
          </div>
        )}
        {paymentMethod === "cash" && !depositRequired && (
          <div className="rounded-xl border border-emerald-100 bg-[#f0fdf4] px-4 py-3 text-xs leading-relaxed text-emerald-800">
            <p className="font-semibold">{t("payment.noOnlinePayment")}</p>
            <p className="mt-1">{t("payment.noOnlinePaymentDesc")}</p>
          </div>
        )}

        <label className="flex items-start gap-2.5 rounded-xl border border-[#ede5d8]/50 bg-[#fdf8f0]/80 px-4 py-3 text-xs leading-relaxed text-[#6f6a64]">
          <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-[#ede5d8] text-[#2F3A2E] focus:ring-[#2F3A2E]/20" />
          <span>{t.rich("review.acceptTerms", { cgv: (chunks) => (<a href="/cgv" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#2F3A2E]">{chunks}</a>), privacy: (chunks) => (<a href="/politique-de-confidentialite" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#2F3A2E]">{chunks}</a>)})}</span>
        </label>

        <button onClick={handlePayment} disabled={!paymentMethod || processing || !acceptedTerms} className={`w-full rounded-full px-5 py-2.5 text-[13px] font-medium text-white transition-all ${!paymentMethod || processing || !acceptedTerms ? "cursor-not-allowed bg-[#ede5d8] text-white/70" : "bg-[#b89664] hover:bg-[#a38353] hover:shadow-md hover:-translate-y-px"}`}>
          {processing ? (<span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" />{t("payment.processing")}</span>) : (confirmLabel)}
        </button>
        <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-[#9a9590]"><ShieldCheck size={12} />{t("payment.secureFooter")}</p>
      </div>
    </div>
  );
}
