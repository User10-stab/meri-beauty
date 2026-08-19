"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { getPaymentStatusBySession } from "@/actions/payment/get-payment-status-by-session";

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS  = 30_000;

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Spinner shown while waiting for the webhook. */
function Polling() {
  const t = useTranslations("reservationSuccess");
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 px-4 text-center">
      {/* Animated ring */}
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-[#C8A46A]/20" />
        <div className="absolute inset-0 rounded-full border-4 border-t-[#C8A46A] animate-spin" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-[#2F3A2E]">
          {t("pollingTitle")}
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          {t("pollingDescription")}
        </p>
      </div>
    </div>
  );
}

/** Brief state while redirecting home after the success toast. */
function Redirecting() {
  const t = useTranslations("reservationSuccess");
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-[#C8A46A]/20" />
        <div className="absolute inset-0 rounded-full border-4 border-t-[#C8A46A] animate-spin" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-[#2F3A2E]">
          {t("redirectingTitle")}
        </h2>
      </div>
    </div>
  );
}

/** Shown when polling times out without a confirmed payment. */
function PollingTimeout({ sessionId }) {
  const t = useTranslations("reservationSuccess");
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center">
        <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-[#2F3A2E]">
          {t("timeoutTitle")}
        </h2>
        <p className="mt-2 text-sm text-gray-500 max-w-sm">
          {t("timeoutDescription")}
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-lg bg-[#2F3A2E] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3d4e3b] transition-colors"
      >
        {t("backHome")}
      </Link>
    </div>
  );
}

/** Shown when session_id is missing or payment is not found at all. */
function NotFound() {
  const t = useTranslations("reservationSuccess");
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
        <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-[#2F3A2E]">{t("notFoundTitle")}</h2>
        <p className="mt-2 text-sm text-gray-500 max-w-sm">
          {t("notFoundDescription")}
        </p>
      </div>
      <div className="flex gap-3 flex-wrap justify-center">
        <Link
          href="/reservation"
          className="inline-flex items-center gap-2 rounded-lg bg-[#2F3A2E] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3d4e3b] transition-colors"
        >
          {t("newReservation")}
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-5 py-2.5 text-sm font-semibold text-[#2F3A2E] hover:bg-gray-50 transition-colors"
        >
          {t("backHome")}
        </Link>
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Client component for the /reservation/success page.
 *
 * Receives the initial payment status from the server component.
 * If payment is still PENDING (webhook hasn't fired yet), polls the server
 * action every 2.5 s for up to 30 s, then falls back to a polite timeout
 * message rather than showing an error.
 *
 * Once the payment is confirmed, a success toast is fired and the customer is
 * redirected to the home page. The toast survives the navigation because the
 * sonner <Toaster> lives in the root layout, which stays mounted.
 *
 * Never writes to the database — all mutations happen in the webhook.
 *
 * @param {{
 *   sessionId: string,
 *   initialData: import("@/lib/payment-status").PaymentStatusResult | null,
 * }} props
 */
export default function ReservationSuccessClient({ sessionId, initialData }) {
  const router = useRouter();
  const t = useTranslations("reservationSuccess");
  const isPaidInitially =
    initialData?.payment?.status === "PAID" ||
    initialData?.payment?.status === "PARTIALLY_PAID";

  const [data,       setData]       = useState(initialData);
  const [polling,    setPolling]    = useState(!isPaidInitially && Boolean(initialData));
  const [timedOut,   setTimedOut]   = useState(false);

  const intervalRef      = useRef(null);
  const startTimeRef     = useRef(Date.now());
  const redirectFiredRef = useRef(false);

  useEffect(() => {
    // Nothing to poll — either already paid or not found at all
    if (!polling) return;

    intervalRef.current = setInterval(async () => {
      const elapsed = Date.now() - startTimeRef.current;

      if (elapsed >= POLL_TIMEOUT_MS) {
        clearInterval(intervalRef.current);
        setPolling(false);
        setTimedOut(true);
        return;
      }

      const result = await getPaymentStatusBySession(sessionId);

      if (!result.found || !result.data) return; // keep polling

      const status = result.data.payment?.status;
      if (status === "PAID" || status === "PARTIALLY_PAID") {
        clearInterval(intervalRef.current);
        setData(result.data);
        setPolling(false);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalRef.current);
  }, [polling, sessionId]);

  // Payment confirmed — toast success and send the customer home. The
  // redirectFiredRef guard keeps this from double-firing on re-renders.
  useEffect(() => {
    if (!data || redirectFiredRef.current) return;
    redirectFiredRef.current = true;
    const confirmed = data.appointment?.status === "CONFIRMED";
    toast.success(confirmed ? t("toastConfirmed") : t("toastReceived"));
    router.replace("/");
  }, [data, router, t]);

  // ── Render states ──────────────────────────────────────────────────────────

  // 1. No session ID or payment record not found at all
  if (!initialData && !polling) {
    return <NotFound />;
  }

  // 2. Waiting for webhook
  if (polling) {
    return <Polling />;
  }

  // 3. Webhook took too long
  if (timedOut) {
    return <PollingTimeout sessionId={sessionId} />;
  }

  // 4. Payment confirmed — redirecting home after the toast
  if (data) {
    return <Redirecting />;
  }

  return <NotFound />;
}