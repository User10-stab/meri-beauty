import Link from "next/link";
import { stripe } from "@/lib/stripe";

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
  const { session_id: sessionId, onsite, number, code } = await searchParams;

  if (onsite === "1") {
    return (
      <Outcome
        title="Commande confirmée"
        message={
          <>
            Merci ! Votre commande n°{number} est confirmée.
            {code && (
              <>
                {" "}
                Présentez ce code en boutique pour la retirer et régler le paiement sur place :{" "}
                <span className="font-semibold text-[#2F3A2E]">{code}</span>.
              </>
            )}
          </>
        }
      />
    );
  }

  let state = "invalid"; // invalid | paid | unpaid
  let details = null;

  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === "paid") {
        state = "paid";
        details = {
          email: session.customer_email || null,
          amount: session.amount_total != null ? (session.amount_total / 100).toFixed(2) : null,
        };
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
          </>
        }
      />
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

function Outcome({ title, message }) {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-24">
      <div className="w-full max-w-xl text-center">
        <div className="mx-auto mb-8 flex h-16 w-16 items-center justify-center rounded-full bg-[#2F3A2E]">
          <svg className="h-8 w-8 text-[#C8A46A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="mb-4 text-3xl text-[#2F3A2E] sm:text-4xl">{title}</h1>
        <p className="mb-10 text-neutral-600">{message}</p>

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
