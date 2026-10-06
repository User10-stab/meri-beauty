import { NouvelAvisPageClient } from "./NouvelAvisPageClient";

export const metadata = {
  title: "Laisser un avis – Meri Beauty",
  description: "Partagez votre expérience chez Meri Beauty et aidez-nous à nous améliorer.",
  robots: { index: false, follow: false },
};

export default function NouvelAvisPage({ searchParams }) {
  const token = searchParams?.token ?? null;
  return <NouvelAvisPageClient token={token} />;
}
