import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { pickupQrDataUrl } from "@/lib/qrcode";

export async function generateMetadata() {
  const t = await getTranslations("boutique.metadata");
  return {
    // Deliberately neutral — this page also renders the "payment pending" and
    // "session not found" states, where "confirmée" would be misleading.
    title: t("orderSuccessPage"),
  };
}

/**
 * Landing page after checkout. The Stripe webhook (or, for pay-on-site
 * orders, createOrderFromCart itself) is the source of truth — this page
 * only displays the outcome. Mirrors app/(public)/reservation/success.
 */
export default async function OrderSuccessPage({ searchParams }) {
  const t = await getTranslations();
  const { session_id: sessionId, onsite, number, code } = await searchParams;

  if (onsite === "1") {
    const qr = code ? await pickupQrDataUrl(code) : null;
    return (
      <Outcome
        title={t("boutique.orderConfirmed")}
        message={
          <>
            {t("boutique.thankYouOrder", { number })}
            {code && ` ${t("boutique.presentCodePickup")}`}
          </>
        }
        pickup={code ? { code, qr } : null}
      />
    );
  }

  let state = "invalid"; // invalid | paid | unpaid
  let details = null;
  let pickup = null;

  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === "paid") {
        state = "paid";
        details = {
          email: session.customer_email || null,
          amount: session.amount_total != null ? (session.amount_total / 100).toFixed(2) : null,
        };

        const orderId = session.metadata?.orderId;
        if (orderId) {
          const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: { pickupCode: true, fulfilmentMode: true },
          });
          if (order?.pickupCode && order.fulfilmentMode !== "SHIPPING_PREPAID") {
            pickup = { code: order.pickupCode, qr: await pickupQrDataUrl(order.pickupCode) };
          }
        }
      } else {
        state = "unpaid";
      }
    } catch (err) {
      console.error("[boutique/order/success] Session retrieval failed:", err);
      state = "invalid";
    }
  }

  if (state === "paid") {
    return (
      <Outcome
        title={t("boutique.paymentConfirmed")}
        message={
          <>
            {t("boutique.thankYouPayment", { amount: details.amount })}
            {details?.email && (
              <>
                {" "}
                {t("boutique.confirmationSent", { email: details.email })}
              </>
            )}
            .
            {pickup && ` ${t("boutique.presentCodePickupPayment")}`}
          </>
        }
        pickup={pickup}
      />
    );
  }

  if (state === "unpaid") {
    return (
      <Outcome
        title={t("boutique.paymentProcessing")}
        message={t("boutique.paymentProcessingDesc")}
      />
    );
  }

  return (
    <Outcome
      title={t("boutique.pageNotFound")}
      message={t("boutique.couldNotFindOrder")}
    />
  );
}

function Outcome({ title, message, pickup }) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-24">
      <div className="w-full max-w-xl text-center">
        <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-full bg-[#2F3A2E]">
          <svg className="h-8 w-8 text-[#C8A46A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="mb-4 text-3xl text-[#2F3A2E] sm:text-4xl">{title}</h1>
        <p className="mb-6 text-neutral-600">{message}</p>

        {pickup && (
          <div className="mx-auto mb-10 flex w-fit flex-col items-center gap-3 border border-neutral-200 bg-white px-8 py-6">
            {pickup.qr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pickup.qr} alt={t("boutique.pickupCode")} width={160} height={160} className="h-40 w-40" />
            )}
            <span className="text-xl font-semibold tracking-wide text-[#2F3A2E]">{pickup.code}</span>
          </div>
        )}

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-block border border-[#2F3A2E] px-8 py-3 text-sm font-medium uppercase tracking-wider text-[#2F3A2E] transition-colors hover:bg-[#2F3A2E] hover:text-white"
          >
            {t("boutique.backToHome")}
          </Link>
          <Link
            href="/boutique"
            className="inline-block bg-[#C8A46A] px-8 py-3 text-sm font-medium uppercase tracking-wider text-white transition-colors hover:bg-[#B8945A]"
          >
            {t("boutique.continueShopping")}
          </Link>
        </div>
      </div>
    </div>
  );
}
