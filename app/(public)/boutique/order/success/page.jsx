import Link from "next/link";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { pickupQrDataUrl } from "@/lib/qrcode";
import { CartClearedNotifier } from "@/components/boutique/CartClearedNotifier";

export const metadata = {
  // Deliberately neutral — this page also renders the "payment pending" and
  // "session not found" states, where "confirmée" would be misleading.
  title: "Votre commande – Meri Beauty",
};

/**
 * Landing page after checkout. The Stripe webhook (or, for pay-on-site
 * orders, createOrderFromCart itself) is the source of truth — this page
 * only displays the outcome. Mirrors app/(public)/reservation/success.
 */
export default async function OrderSuccessPage({ searchParams }) {
  const { session_id: sessionId, onsite, free, number, code, pos_canceled: posCanceled } = await searchParams;

  if (posCanceled === "1") {
    return (
      <Outcome
        title="Paiement non terminé"
        message="Aucun paiement n'a été confirmé. Vous pouvez revenir auprès de notre équipe en caisse."
      />
    );
  }

  if (onsite === "1") {
    const qr = code ? await pickupQrDataUrl(code) : null;
    return (
      <Outcome
        title="Commande confirmée"
        message={
          <>
            Merci ! Votre commande n°{number} est confirmée.
            {code && " Présentez ce code (ou son QR) en boutique pour la retirer et régler le paiement sur place :"}
          </>
        }
        pickup={code ? { code, qr } : null}
      />
    );
  }

  // A 100%-off promo code covered the entire order — already confirmed
  // server-side (createOrderCheckoutSession), nothing was ever charged, so
  // there's no Stripe session to verify here.
  if (free === "1") {
    const qr = code ? await pickupQrDataUrl(code) : null;
    return (
      <Outcome
        title="Commande confirmée"
        message={
          <>
            Merci ! Votre commande n°{number} est confirmée — le code promo appliqué couvre l&apos;intégralité du montant, aucun paiement n&apos;était nécessaire.
            {code && " Présentez ce code (ou son QR) en boutique pour la retirer :"}
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
            select: { pickupCode: true, fulfilmentMode: true, source: true },
          });
          if (order?.source !== "POS" && order?.pickupCode && order.fulfilmentMode !== "SHIPPING_PREPAID") {
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
      <>
        <CartClearedNotifier />
        <Outcome
          title="Paiement confirmé"
          message={
            <>
              Merci ! Votre paiement de <span className="font-semibold text-[#C8A46A]">€{details.amount}</span> a bien été reçu
              {details?.email && (
                <>
                  {" "}
                  — une confirmation a été envoyée à <span className="font-medium text-[#2F3A2E]">{details.email}</span>
                </>
              )}
              .
              {pickup && " Présentez ce code (ou son QR) en boutique pour la retirer :"}
            </>
          }
          pickup={pickup}
        />
      </>
    );
  }

  if (state === "unpaid") {
    return (
      <Outcome
        title="Paiement en cours"
        message="Votre paiement est en cours de traitement. Vous recevrez un email de confirmation dès qu'il sera validé."
      />
    );
  }

  return (
    <Outcome
      title="Page introuvable"
      message="Nous n'avons pas pu retrouver votre commande. Si vous venez d'effectuer un paiement, vérifiez votre boîte mail."
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
              <img src={pickup.qr} alt="QR code de retrait" width={160} height={160} className="h-40 w-40" />
            )}
            <span className="text-xl font-semibold tracking-wide text-[#2F3A2E]">{pickup.code}</span>
          </div>
        )}

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-block border border-[#2F3A2E] px-8 py-3 text-sm font-medium uppercase tracking-wider text-[#2F3A2E] transition-colors hover:bg-[#2F3A2E] hover:text-white"
          >
            Retour à l'accueil
          </Link>
          <Link
            href="/boutique"
            className="inline-block bg-[#C8A46A] px-8 py-3 text-sm font-medium uppercase tracking-wider text-white transition-colors hover:bg-[#B8945A]"
          >
            Continuer mes achats
          </Link>
        </div>
      </div>
    </div>
  );
}
