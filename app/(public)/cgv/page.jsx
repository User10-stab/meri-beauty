import LegalPageLayout, { H2, H3, P, Ul, Note } from "@/components/website/LegalPageLayout";
import Link from "next/link";

export const metadata = {
  title: "Conditions générales de vente | Meri Beauty",
  description: "Conditions générales de vente applicables aux commandes boutique, rendez-vous, ateliers et formations Meri Beauty.",
  alternates: { canonical: "/cgv" },
};

export default function CGVPage() {
  return (
    <LegalPageLayout eyebrow="Avant de commander" title="Conditions générales de vente" updated="10 août 2026">
      <Note>
        Ce document est un projet à faire valider avant publication. Il couvre les quatre
        parcours proposés par le Site : boutique en ligne, rendez-vous en institut, ateliers et
        formations. Les clauses reflètent les règles réellement appliquées par le Site
        (acompte, délais de rétractation, TVA) — merci de les confirmer avant mise en ligne.
      </Note>

      <H2>1. Champ d'application et identification du vendeur</H2>
      <P>
        Les présentes conditions générales de vente (« CGV ») régissent toute commande de
        produits, réservation de rendez-vous, d'atelier ou de formation passée sur
        meribeautystudio.com (le « Site »), exploité par :
      </P>
      <Ul>
        <li>[Nom et prénom complets de la responsable — à compléter], personne physique exploitant Meri Beauty</li>
        <li>Numéro d'entreprise / TVA : BE 0751.854.027</li>
        <li>Adresse : Rue Bonaventure 113, 1090 Jette, Belgique</li>
        <li>Téléphone : +32 484 64 36 65 — Email : contact@meribeautystudio.com</li>
      </Ul>
      <P>
        Toute commande ou réservation passée sur le Site implique l'acceptation sans réserve
        des présentes CGV, qui prévalent sur tout autre document sauf accord écrit contraire.
      </P>

      <H2>2. Ce que propose le Site</H2>
      <Ul>
        <li><strong>Boutique en ligne</strong> — vente de produits cosmétiques et accessoires.</li>
        <li><strong>Rendez-vous en institut</strong> — réservation de soins et prestations réalisées au salon.</li>
        <li><strong>Ateliers</strong> — sessions collectives à durée déterminée, en nombre de places limité.</li>
        <li><strong>Formations</strong> — sessions de formation professionnelle, en nombre de places limité.</li>
      </Ul>

      <H2>3. Prix</H2>
      <P>
        Tous les prix affichés sur le Site sont exprimés en euros, toutes taxes comprises
        (TVA belge à 21 % incluse), sauf mention contraire explicite. Meri Beauty se réserve le
        droit de modifier ses prix à tout moment ; le prix applicable est celui affiché au
        moment de la commande ou de la réservation.
      </P>

      <H2>4. Commande et réservation</H2>
      <H3>Boutique</H3>
      <P>
        Vous ajoutez les produits souhaités à votre panier, puis confirmez votre commande après
        vérification du récapitulatif (produits, quantités, prix, mode de retrait ou de
        livraison). La commande n'est définitive qu'après confirmation du paiement.
      </P>
      <H3>Rendez-vous</H3>
      <P>
        Vous choisissez une prestation, un(e) praticien(ne) et un créneau disponible. Selon la
        prestation, un acompte peut être demandé en ligne pour confirmer le rendez-vous ; le
        solde est alors réglé au salon. Certaines prestations peuvent être réglées intégralement
        au salon, sans paiement en ligne.
      </P>
      <H3>Ateliers et formations</H3>
      <P>
        Vous réservez votre place en réglant un acompte de 50 % du prix total en ligne. Le solde
        (50 % restants) est à régler avant la date de la session, selon les modalités indiquées
        au moment de la réservation.
      </P>

      <H2>5. Paiement</H2>
      <P>
        Les paiements en ligne sont traités de façon sécurisée par Stripe (carte bancaire,
        Bancontact). Meri Beauty n'a à aucun moment accès à vos coordonnées bancaires complètes.
        Certaines prestations peuvent être réglées directement au salon (espèces, carte).
      </P>

      <H2>6. Livraison et retrait (boutique)</H2>
      <P>
        Les commandes de la boutique peuvent être retirées directement au salon (Rue
        Bonaventure 113, 1090 Jette) ou livrées en point relais Mondial Relay, selon
        disponibilité de ce mode de livraison. Les frais de livraison, lorsqu'ils s'appliquent,
        correspondent au coût réel facturé par le transporteur, majoré de la TVA, sans marge
        commerciale. Un email de confirmation vous informe dès que votre commande est prête ou
        expédiée.
      </P>

      <H2>7. Droit de rétractation (boutique)</H2>
      <P>
        Conformément au Livre VI du Code de droit économique belge, vous disposez d'un délai de
        14 jours calendrier, à compter de la réception ou du retrait de votre commande, pour
        exercer votre droit de rétractation, sans avoir à justifier de motif ni à payer de
        pénalité.
      </P>
      <P>Pour exercer ce droit, utilisez le formulaire disponible sur la page{" "}
        <Link className="text-gold underline" href="/boutique/returns">Retourner un article</Link>. Le
        droit de rétractation ne s'applique pas :
      </P>
      <Ul>
        <li>aux produits cosmétiques descellés ou utilisés, pour des raisons d'hygiène et de protection de la santé ;</li>
        <li>aux prestations de service (rendez-vous, ateliers, formations) pleinement exécutées avant la fin du délai de rétractation, avec votre accord exprès.</li>
      </Ul>
      <P>
        Sauf non-conformité du produit, les frais de retour restent à votre charge. Le
        remboursement intervient après réception et contrôle de l'article retourné.
      </P>

      <H2>8. Annulation et report des rendez-vous</H2>
      <P>
        Toute demande d'annulation ou de report d'un rendez-vous se fait directement auprès du
        salon, par téléphone ou email. Si Meri Beauty est à l'origine de l'annulation, toute
        somme déjà versée (acompte ou solde) vous est intégralement remboursée.
      </P>

      <H2>9. Ateliers et formations — conditions particulières</H2>
      <Note>
        L'acompte et le solde des ateliers et formations ne sont, par principe, remboursables
        en aucun cas, que vous participiez ou non à la session. Cette règle, déjà appliquée sur
        les pages de réservation, est reprise ici pour information contractuelle complète.
      </Note>
      <P>
        Si Meri Beauty annule une session (nombre de participants insuffisant, indisponibilité
        de l'animateur·rice, etc.), vous êtes intégralement remboursé(e) ou pouvez reporter
        votre place sur une session ultérieure, à votre choix.
      </P>
      <P>
        À titre exceptionnel, et à sa seule discrétion, Meri Beauty peut accorder un
        remboursement en cas de force majeure dûment justifié (maladie grave, décès, etc.).
        Cette exception n'est jamais automatique : contactez-nous directement par téléphone ou
        email en exposant votre situation ; nous l'examinerons au cas par cas. Seul un membre
        autorisé de l'équipe Meri Beauty peut valider et traiter ce remboursement.
      </P>
      <P>
        Lorsqu'un remboursement est accordé, Meri Beauty émet, lorsque la réglementation l'exige,
        une note de crédit liée à la facture initiale. Un remboursement ou une annulation accordé(e)
        par exception libère la place concernée afin qu'elle puisse être proposée à une autre personne.
      </P>

      <H2>10. Garantie légale de conformité</H2>
      <P>
        Les produits vendus sur la boutique bénéficient de la garantie légale de conformité de
        2 ans prévue par le Code civil belge. En cas de défaut de conformité ou de vice caché,
        contactez-nous à contact@meribeautystudio.com pour organiser un échange, une réparation
        ou un remboursement, selon le cas.
      </P>

      <H2>11. Responsabilité</H2>
      <P>
        Meri Beauty met tout en œuvre pour assurer l'exactitude des informations et la bonne
        exécution des prestations. Sa responsabilité ne saurait être engagée en cas de force
        majeure, ou de dommage résultant d'une utilisation non conforme d'un produit après son
        achat.
      </P>

      <H2>12. Données personnelles</H2>
      <P>
        Le traitement de vos données personnelles dans le cadre de votre commande ou réservation
        est décrit dans notre{" "}
        <a className="text-gold underline" href="/politique-de-confidentialite">Politique de confidentialité</a>.
      </P>

      <H2>13. Réclamations et médiation</H2>
      <P>
        Pour toute réclamation, contactez-nous en priorité à contact@meribeautystudio.com. À
        défaut de résolution amiable, vous pouvez saisir gratuitement le{" "}
        <a className="text-gold underline" href="https://mediationconsommateur.be" target="_blank" rel="noopener noreferrer">
          Service de Médiation pour le Consommateur
        </a>{" "}
        ou la{" "}
        <a className="text-gold underline" href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">
          plateforme européenne de règlement en ligne des litiges
        </a>
        .
      </P>

      <H2>14. Droit applicable et juridiction</H2>
      <P>
        Les présentes CGV sont soumises au droit belge. Tout litige relève de la compétence
        exclusive des tribunaux de l'arrondissement judiciaire de Bruxelles, sous réserve des
        dispositions impératives protectrices du consommateur.
      </P>

      <H2>15. Modification des CGV</H2>
      <P>
        Meri Beauty se réserve le droit de modifier les présentes CGV à tout moment. Les CGV
        applicables sont celles en vigueur au moment de votre commande ou réservation.
      </P>
    </LegalPageLayout>
  );
}
