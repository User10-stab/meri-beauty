/**
 * Where the counter's « Carte QR » sends the client's phone after paying.
 *
 * Deliberately says nothing about the booking. The counter's own dialog is
 * what confirms the sale — it polls Stripe and then runs the settle action,
 * which allocates the ticket and issues the invoice. This page is glanced at
 * for a second while the client hands the phone back, so it must not imply
 * anything the salon has not actually recorded yet.
 */
export const metadata = {
  title: "Paiement reçu — Meri Beauty",
  robots: { index: false, follow: false },
};

export default function CounterPaymentThanksPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#2f3a2e]/10 text-3xl" aria-hidden="true">
        ✓
      </div>
      <h1 className="mt-6 text-2xl font-bold text-[#2f3a2e]">Paiement reçu</h1>
      <p className="mt-3 text-sm text-gray-600">
        Merci ! Vous pouvez rendre le téléphone : la personne à l&apos;accueil termine l&apos;encaissement.
      </p>
    </main>
  );
}
