import { getPaymentStatus } from "@/lib/payment-status";
import ReservationSuccessClient from "@/components/reservation/ReservationSuccessClient";

export const metadata = {
  title: "Réservation confirmée – Meri Beauty",
  description: "Votre paiement a été reçu et votre réservation est enregistrée.",
};

/**
 * /reservation/success?session_id=cs_xxx
 *
 * Server Component — never modifies the database.
 *
 * Responsibilities:
 *   1. Extract the Stripe session_id from the search params.
 *   2. Do a single DB read via the Payment Status service.
 *   3. Pass the initial data to the client component.
 *
 * The client component handles polling if the webhook hasn't fired yet.
 * If the webhook already fired before the customer was redirected here,
 * the page renders fully on the server with no client-side polling needed.
 */
export default async function ReservationSuccessPage({ searchParams }) {
  const sessionId = searchParams?.session_id ?? null;

  // No session_id in the URL — render the not-found state immediately
  if (!sessionId) {
    return <ReservationSuccessClient sessionId={null} initialData={null} />;
  }

  // Attempt a first read. The webhook may or may not have fired yet.
  // We pass whatever we find (including null) to the client component.
  // Never throw here — a DB error should not crash the page.
  let initialData = null;
  try {
    initialData = await getPaymentStatus({ stripeSessionId: sessionId });
  } catch (err) {
    console.error("[ReservationSuccessPage] getPaymentStatus failed:", err);
  }

  return (
    <ReservationSuccessClient
      sessionId={sessionId}
      initialData={initialData}
    />
  );
}
