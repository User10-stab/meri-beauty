"use client";

import { useState } from "react";
import { CreditCard, Wallet, Check, Loader2 } from "lucide-react";
import { createReservation } from "@/actions/reservation/create-reservation";
import { createCheckoutSession } from "@/actions/payment/createCheckoutSession";
import { computePaymentDecision } from "@/lib/reservation-payment";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PromoCodeField } from "@/components/shared/PromoCodeField";

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
  const t = useTranslations("reservationSteps");
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const router = useRouter();

  const drafts = data.appointmentDrafts ?? [];
  // Declared here, before the allowedPaymentMethods read below — this was
  // previously declared further down, after its own first use, which is a
  // temporal dead zone: `const` bindings throw ReferenceError when read
  // before initialization, crashing every render of this step.
  const draft = drafts[0];
  const rawTotal = drafts.reduce((sum, d) => sum + Number(d.price ?? 0), 0);
  const discountAmount = appliedPromo?.discountAmount ?? 0;

  // All amounts and flags from the single source of truth
  const {
    totalAmount,
    depositRequired,
    depositAmount,
    depositPercentage,
  } = computePaymentDecision({ drafts, discountAmount });

  const allowedPaymentMethods = draft?.staffService?.staff?.allowedPaymentMethods;
  const acceptsOnlinePayments =
    allowedPaymentMethods === "BOTH" || allowedPaymentMethods === "ONLINE_ONLY";
  const acceptsCashPayments =
    allowedPaymentMethods === "BOTH" || allowedPaymentMethods === "CASH_ONLY";

  // The amount the customer will pay online right now, per chosen method —
  // used only to display in UI labels, never sent to the server.
  //   "online" → full price (Stripe, charged immediately)
  //   "cash"   → deposit if depositRequired, otherwise €0
  const amountDueNow =
    paymentMethod === "online"
      ? totalAmount
      : depositRequired
      ? depositAmount
      : 0;

  const staffServiceId = draft?.staffService?.id ?? data.staffService?.id;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handlePayment = async () => {
    if (!paymentMethod) {
      toast.error(t("payment.selectPaymentMethod"));
      return;
    }
    if (!acceptedTerms) {
      toast.error(t("payment.acceptTermsRequired"));
      return;
    }

    // "Payer au salon" with no deposit → create appointment directly, no Stripe
    if (paymentMethod === "cash" && !depositRequired) {
      await handleSalonNoDeposit();
      return;
    }

    // All other cases require Stripe Checkout:
    //   • "online"               → full amount
    //   • "cash" + depositRequired → deposit amount
    setProcessing(true);
    const loadingToastId = toast.loading(t("payment.redirecting"));
    try {
      const customerInfo = customerSession
        ? {
            userId:   customerSession.id,
            fullName: customerSession.fullName ?? "",
            email:    customerSession.email    ?? "",
            phone:    customerSession.phone    ?? "",
          }
        : data.customerInfo;

      // Creates Appointment + Payment (status: PENDING) in DB, then returns
      // the Stripe Checkout session URL. No payment is confirmed here.
      // The webhook is the sole authority for marking a payment as completed.
      const result = await createCheckoutSession({
        staffServiceId,
        date:          data.date,
        time:          data.time,
        customerInfo,
        paymentMethod,
        notes:         data.notes,
        promoCode:     appliedPromo?.code ?? null,
        // Re-checked and recorded server-side — the guard above is only a
        // courtesy message, the action is a public endpoint.
        termsAccepted: acceptedTerms,
      });

      toast.dismiss(loadingToastId);

      if (!result.success || !result.url) {
        toast.error(
          (result.message || t("payment.sessionFailed")) +
            (result.error ? ` — ${result.error}` : "")
        );
        setProcessing(false);
        return;
      }

      // If the customer was just created as a guest, sign them in silently
      // before navigating to Stripe. This means if they abandon the Stripe
      // checkout page, they will already be authenticated when they come back
      // and can resume payment from /mes-reservations.
      if (!customerSession && result.autologinToken && result.customerEmail) {
        try {
          await signIn("credentials", {
            email:         result.customerEmail,
            autologinToken: result.autologinToken,
            redirect:      false,
          });
        } catch {
          // Login failure must never block the Stripe redirect.
          // The customer can still pay — they just won't be auto-authenticated.
        }
      }

      // Hard-navigate to Stripe Checkout. The browser leaves this page.
      // On completion Stripe redirects to /reservation/success?session_id=...
      // On cancellation Stripe redirects to /reservation?canceled=true
      window.location.href = result.url;

      // Note: setProcessing(false) is intentionally omitted — the page is
      // navigating away. Keeping processing=true prevents double-clicks while
      // the redirect is in flight.
    } catch (err) {
      console.error("[PaymentStep] unexpected error:", err);
      toast.dismiss(loadingToastId);
      toast.error(t("payment.genericError"));
      setProcessing(false);
    }
  };

  // "Payer au salon", no deposit required → create appointment without Stripe
  const handleSalonNoDeposit = async () => {
    setProcessing(true);
    const loadingToastId = toast.loading(t("review.processing"));
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
        promoCode:     appliedPromo?.code ?? null,
        // Re-checked and recorded server-side — the guard above is only a
        // courtesy message, the action is a public endpoint.
        termsAccepted: acceptedTerms,
      });

      toast.dismiss(loadingToastId);

      if (!result.success) {
        toast.error(
          result.message || t("payment.reservationFailed")
        );
        setProcessing(false);
        return;
      }

      // Auto-login for guest accounts so they land on the site authenticated
      const { isNewUser, autologinToken, user } = result.data;
      if (!customerSession && autologinToken && user?.email) {
        try {
          await signIn("credentials", { email: user.email, autologinToken, redirect: false });
        } catch {
          // login failure must never block the reservation confirmation
        }
      }

      toast.success(t("payment.reservationConfirmed"));
      setTimeout(() => router.push("/"), 2000);
    } catch (err) {
      console.error("[PaymentStep] handleSalonNoDeposit:", err);
      toast.dismiss(loadingToastId);
      toast.error(t("payment.genericError"));
      setProcessing(false);
    }
  };

  // ── Payment form ──────────────────────────────────────────────────────────

  // Contextual description for the "Payer au salon" option
  const salonDescription = depositRequired
    ? t("payment.salonDepositDesc", { percentage: depositPercentage })
    : t("payment.salonNoDepositDesc");

  // Confirm button label
  const confirmLabel = (() => {
    if (!paymentMethod) return t("payment.confirmPay");
    if (paymentMethod === "online")
      return t("payment.payOnline", { amount: Number(totalAmount).toFixed(2) });
    if (depositRequired)
      return t("payment.payDeposit", { amount: Number(depositAmount).toFixed(2) });
    return t("payment.confirmSalon");
  })();

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold text-[#2F3A2E]">{t("payment.title")}</h2>
        <p className="mt-2 text-gray-600">
          {t("payment.subtitle")}
        </p>
      </div>

      <div className="space-y-6">
        {/* ── Amount summary ─────────────────────────────────── */}
        <div className="rounded-2xl border-2 border-[#C8A46A] bg-gradient-to-br from-[#C8A46A]/5 to-white p-6 text-center">
          <p className="text-sm font-medium text-gray-600">
            {t("payment.totalServicePrice")}
          </p>
          {discountAmount > 0 ? (
            <>
              <p className="mt-1 text-lg text-gray-400 line-through">€{rawTotal.toFixed(2)}</p>
              <p className="text-4xl font-bold text-[#C8A46A]">€{Number(totalAmount).toFixed(2)}</p>
              <p className="mt-1 text-sm font-medium text-emerald-600">
                {t("payment.discount", { code: appliedPromo.code, amount: discountAmount.toFixed(2) })}
              </p>
            </>
          ) : (
            <p className="mt-1 text-4xl font-bold text-[#C8A46A]">
              €{Number(totalAmount).toFixed(2)}
            </p>
          )}
          {depositRequired && paymentMethod === "cash" && (
            <p className="mt-2 text-sm text-gray-500">
              {t("payment.depositOnline")}{" "}
              <span className="font-semibold text-[#2F3A2E]">
                €{Number(depositAmount).toFixed(2)}
              </span>{" "}
              · {t("payment.balanceInSalon")}{" "}
              <span className="font-semibold text-[#2F3A2E]">
                €{Number(totalAmount - depositAmount).toFixed(2)}
              </span>
            </p>
          )}
          {paymentMethod === "online" && (
            <p className="mt-2 text-sm text-gray-500">
              {t("payment.fullAmountDebited")}
            </p>
          )}
        </div>

        <PromoCodeField subtotal={rawTotal} onApplied={setAppliedPromo} />

        {/* ── Payment options ─────────────────────────────────── */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[#2F3A2E]">
            {t("payment.paymentMethod")}
          </h3>

          <PaymentOption
            icon={<CreditCard size={24} />}
            title={t("payment.payOnlineTitle")}
            description={
              acceptsOnlinePayments
                ? t("payment.payOnlineDesc")
                : t("payment.payOnlineUnavailable")
            }
            badge={t("payment.badgeTotal")}
            selected={paymentMethod === "online"}
            disabled={processing || !acceptsOnlinePayments}
            onSelect={() => {
              if (!acceptsOnlinePayments) return;
              setPaymentMethod("online");
            }}
          />

          <PaymentOption
            icon={<Wallet size={24} />}
            title={t("payment.payAtSalonTitle")}
            description={
              acceptsCashPayments
                ? salonDescription
                : t("payment.payAtSalonUnavailable")
            }
            selected={paymentMethod === "cash"}
            disabled={processing || !acceptsCashPayments}
            onSelect={() => {
              if (!acceptsCashPayments) return;
              setPaymentMethod("cash");
            }}
          />
        </div>

        {/* ── Contextual notice ───────────────────────────────── */}
        {paymentMethod === "online" && (
          <div className="rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
            <p className="font-medium">{t("payment.secureStripeNotice")}</p>
            <p className="mt-1">
              {t("payment.onlineNoticeDesc", { amount: `€${Number(totalAmount).toFixed(2)}` })}
            </p>
          </div>
        )}

        {paymentMethod === "cash" && depositRequired && (
          <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
            <p className="font-medium">{t("payment.depositRequired")}</p>
            <p className="mt-1">
              {t("payment.depositNoticeDesc", {
                percentage: depositPercentage,
                amount: `€${Number(depositAmount).toFixed(2)}`,
                balance: `€${Number(totalAmount - depositAmount).toFixed(2)}`,
              })}
            </p>
          </div>
        )}

        {paymentMethod === "cash" && !depositRequired && (
          <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800">
            <p className="font-medium">{t("payment.noOnlinePayment")}</p>
            <p className="mt-1">
              {t("payment.noOnlinePaymentDesc")}
            </p>
          </div>
        )}

        {/* ── Terms acceptance ────────────────────────────────── */}
        <label className="flex items-start gap-2.5 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-0.5"
          />
<span>
             {t.rich("review.acceptTerms", {
                cgv: (chunks) => (
                  <a href="/cgv" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#C8A46A]">
                    {chunks}
                  </a>
                ),
                privacy: (chunks) => (
                  <a href="/politique-de-confidentialite" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#C8A46A]">
                    {chunks}
                  </a>
                ),
              })}
            </span>
          </label>

        {/* ── Submit ──────────────────────────────────────────── */}
        <button
          onClick={handlePayment}
          disabled={!paymentMethod || processing || !acceptedTerms}
          className={`w-full rounded-lg px-6 py-4 text-base font-semibold text-white transition-all ${
            !paymentMethod || processing || !acceptedTerms
              ? "cursor-not-allowed bg-gray-300"
              : "bg-[#C8A46A] hover:bg-[#B8945A]"
          }`}
        >
          {processing ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={20} className="animate-spin" />
              {t("payment.processing")}
            </span>
          ) : (
            confirmLabel
          )}
        </button>

        <p className="text-center text-xs text-gray-400">
          {t("payment.secureFooter")}
        </p>
      </div>
    </div>
  );
}
