import Link from "next/link";
import { stripe } from "@/lib/stripe";

export const metadata = {
  // Deliberately neutral: this page also renders the "payment pending" and
  // "session not found" states, where "confirmée" would be misleading.
  title: "Votre réservation – Meri Beauty",
};

/**
 * Landing page after Stripe Checkout.
 *
 * The webhook (app/api/webhooks/stripe) is the source of truth and creates the
 * appointment — this page only *displays* the outcome. If the webhook hasn't
 * run yet (it can arrive a second or two after the redirect), we still show
 * success as long as Stripe confirms the session is paid.
 */
export default async function ReservationSuccessPage({ searchParams }) {
  const { session_id: sessionId } = await searchParams;

  let state = "invalid"; // invalid | paid | unpaid
  let details = null;

  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const meta = session.metadata ?? {};

      if (session.payment_status === "paid") {
        state = "paid";
        details = {
          serviceName: meta.serviceName || "Votre service",
          date: meta.date
            ? new Date(meta.date).toLocaleDateString("fr-FR", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })
            : null,
          time: meta.time || null,
          email: session.customer_email || meta.customerEmail || null,
          amount:
            session.amount_total != null
              ? (session.amount_total / 100).toFixed(2)
              : null,
          isDeposit: meta.paymentMethod === "ON_SITE",
        };
      } else {
        state = "unpaid";
      }
    } catch (err) {
      console.error("[reservation/success] Session retrieval failed:", err);
      state = "invalid";
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-24">
      <div className="w-full max-w-xl text-center">
        {state === "paid" && (
          <>
            <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-full bg-[#2F3A2E]">
              <svg
                className="h-8 w-8 text-[#C8A46A]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h1 className="mb-4 text-3xl text-[#2F3A2E] sm:text-4xl">
              Réservation confirmée
            </h1>

            <p className="mb-8 text-neutral-600">
              Merci ! Votre paiement a bien été reçu
              {details?.email && (
                <>
                  {" "}
                  — une confirmation a été envoyée à{" "}
                  <span className="font-medium text-[#2F3A2E]">{details.email}</span>
                </>
              )}
              .
            </p>

            <div className="mb-10 border border-neutral-200 bg-white px-8 py-6 text-left">
              <dl className="space-y-3">
                <div className="flex justify-between gap-4">
                  <dt className="text-sm uppercase tracking-wide text-neutral-500">
                    Service
                  </dt>
                  <dd className="font-medium text-[#2F3A2E]">{details.serviceName}</dd>
                </div>
                {details.date && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-sm uppercase tracking-wide text-neutral-500">
                      Date
                    </dt>
                    <dd className="font-medium text-[#2F3A2E]">
                      {details.date}
                      {details.time && ` à ${details.time}`}
                    </dd>
                  </div>
                )}
                {details.amount && (
                  <div className="flex justify-between gap-4 border-t border-neutral-100 pt-3">
                    <dt className="text-sm uppercase tracking-wide text-neutral-500">
                      {details.isDeposit ? "Acompte réglé" : "Montant réglé"}
                    </dt>
                    <dd className="font-semibold text-[#C8A46A]">€{details.amount}</dd>
                  </div>
                )}
              </dl>
              {details.isDeposit && (
                <p className="mt-4 text-sm text-neutral-500">
                  Le solde sera à régler sur place le jour de votre rendez-vous.
                </p>
              )}
            </div>
          </>
        )}

        {state === "unpaid" && (
          <>
            <h1 className="mb-4 text-3xl text-[#2F3A2E] sm:text-4xl">
              Paiement en cours
            </h1>
            <p className="mb-10 text-neutral-600">
              Votre paiement est en cours de traitement. Vous recevrez un email de
              confirmation dès qu'il sera validé. Si rien n'arrive d'ici quelques
              minutes, contactez-nous.
            </p>
          </>
        )}

        {state === "invalid" && (
          <>
            <h1 className="mb-4 text-3xl text-[#2F3A2E] sm:text-4xl">
              Page introuvable
            </h1>
            <p className="mb-10 text-neutral-600">
              Nous n'avons pas pu retrouver votre session de paiement. Si vous venez
              d'effectuer un paiement, vérifiez votre boîte mail — la confirmation
              s'y trouve peut-être déjà.
            </p>
          </>
        )}

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-block border border-[#2F3A2E] px-8 py-3 text-sm font-medium uppercase tracking-wider text-[#2F3A2E] transition-colors hover:bg-[#2F3A2E] hover:text-white"
          >
            Retour à l'accueil
          </Link>
          {state !== "paid" && (
            <Link
              href="/reservation"
              className="inline-block bg-[#C8A46A] px-8 py-3 text-sm font-medium uppercase tracking-wider text-white transition-colors hover:bg-[#B8945A]"
            >
              Réserver un créneau
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
