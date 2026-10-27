import PublicNotFound from "@/components/website/PublicNotFound";
import { getSalon } from "@/actions/salon/get-salon";

export const metadata = { title: "Page introuvable" };

// En-tête, pied de page et boutons « Prendre un rendez-vous » / « Retour à
// l'accueil » : voir components/website/PublicNotFound.jsx (audit MB-013).
// Le pied de page affiche l'adresse et les réseaux du salon, d'où la lecture.
export default async function NotFound() {
  const salonResult = await getSalon();
  return <PublicNotFound salon={salonResult?.data ?? null} />;
}
