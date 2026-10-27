/**
 * Where the counter's « Carte QR » sends the client's phone if they back out
 * of the Stripe page. Nothing was charged and nothing was recorded — the
 * operator simply picks another method.
 */
export const metadata = {
  title: "Paiement annulé — Meri Beauty",
  robots: { index: false, follow: false },
};

export default function CounterPaymentCancelledPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-bold text-[#2f3a2e]">Paiement annulé</h1>
      <p className="mt-3 text-sm text-gray-600">
        Aucun montant n&apos;a été débité. Rendez le téléphone à l&apos;accueil pour choisir un autre moyen de paiement.
      </p>
    </main>
  );
}
