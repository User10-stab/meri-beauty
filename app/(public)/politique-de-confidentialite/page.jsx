import LegalPageLayout, { H2, H3, P, Ul, Note } from "@/components/website/LegalPageLayout";

export const metadata = {
  title: "Politique de confidentialité | Meri Beauty",
  description: "Comment Meri Beauty collecte, utilise et protège vos données personnelles, conformément au RGPD.",
  alternates: { canonical: "/politique-de-confidentialite" },
};

export default function PolitiqueConfidentialitePage() {
  return (
    <LegalPageLayout eyebrow="Vos données" title="Politique de confidentialité" updated="7 août 2026">
      <Note>
        Ce document est un projet à faire valider avant publication. Les sous-traitants listés
        (Stripe, Resend, Neon, Mondial Relay) reflètent les outils réellement utilisés par le
        site à ce jour — à réviser si un prestataire change.
      </Note>

      <H2>1. Responsable du traitement</H2>
      <P>
        Le responsable du traitement des données collectées via meribeautystudio.com (le
        « Site ») est [Nom et prénom complets de la responsable — à compléter], exploitant Meri
        Beauty à titre personnel (BCE BE 0751.854.027), Rue Bonaventure 113, 1090 Jette,
        Belgique. Pour toute question relative à vos données, contactez :{" "}
        <a className="text-gold underline" href="mailto:contact@meribeautystudio.com">
          contact@meribeautystudio.com
        </a>
        .
      </P>

      <H2>2. Quelles données nous collectons</H2>
      <Ul>
        <li><strong>Compte client :</strong> nom, prénom, email, téléphone, mot de passe (chiffré).</li>
        <li><strong>Réservations :</strong> service demandé, praticien choisi, date et heure, notes éventuelles.</li>
        <li><strong>Commandes boutique :</strong> produits commandés, adresse ou point de retrait, numéro de TVA (si vous commandez en tant que professionnel).</li>
        <li><strong>Ateliers et formations :</strong> nombre de places, informations de facturation, numéro de TVA le cas échéant.</li>
        <li><strong>Paiement :</strong> les coordonnées bancaires ou de carte ne transitent jamais par nos serveurs — elles sont saisies directement sur la page sécurisée de Stripe, notre prestataire de paiement.</li>
        <li><strong>Newsletter :</strong> votre email, uniquement si vous cochez la case d'inscription.</li>
        <li><strong>Formulaire de contact :</strong> nom, email, message.</li>
      </Ul>

      <H2>3. Pourquoi nous utilisons ces données</H2>
      <Ul>
        <li>Créer et gérer votre compte, vos réservations et vos commandes (exécution du contrat).</li>
        <li>Traiter vos paiements et émettre vos factures / notes de crédit (exécution du contrat et obligations comptables).</li>
        <li>Vous envoyer les emails liés à votre commande ou réservation (confirmation, rappel, facture).</li>
        <li>Vous envoyer notre newsletter, uniquement si vous y avez consenti (consentement, retirable à tout moment).</li>
        <li>Assurer la sécurité du Site et prévenir la fraude aux paiements (intérêt légitime).</li>
        <li>Répondre à nos obligations légales et fiscales (conservation des factures, TVA).</li>
      </Ul>

      <H2>4. Avec qui nous partageons vos données</H2>
      <P>
        Nous ne vendons ni ne louons vos données à des tiers. Elles sont transmises uniquement
        aux prestataires nécessaires au fonctionnement du Site, chacun agissant comme
        sous-traitant pour le compte de Meri Beauty :
      </P>
      <Ul>
        <li><strong>Stripe</strong> (Stripe Payments Europe, Ltd.) — traitement des paiements en ligne.</li>
        <li><strong>Resend</strong> — envoi des emails transactionnels (confirmations, factures, rappels).</li>
        <li><strong>Neon</strong> — hébergement de la base de données.</li>
        <li><strong>Mondial Relay</strong> — livraison des commandes en point relais (dès activation de ce mode de livraison).</li>
      </Ul>
      <P>
        Certains de ces prestataires peuvent traiter des données en dehors de l'Espace
        économique européen ; dans ce cas, ce transfert est encadré par des clauses
        contractuelles types approuvées par la Commission européenne.
      </P>

      <H2>5. Durée de conservation</H2>
      <Ul>
        <li>Données de compte : conservées tant que votre compte est actif, puis supprimées ou anonymisées sur demande.</li>
        <li>Factures et notes de crédit : conservées 7 ans, conformément à l'obligation légale belge de conservation des documents comptables.</li>
        <li>Email de prospection (newsletter) : conservé jusqu'à votre désinscription.</li>
        <li>Cookies techniques : voir durée indiquée à la section 7.</li>
      </Ul>

      <H2>6. Vos droits</H2>
      <P>Conformément au Règlement général sur la protection des données (RGPD), vous disposez des droits suivants sur vos données :</P>
      <Ul>
        <li>Droit d'accès et de rectification ;</li>
        <li>Droit à l'effacement (« droit à l'oubli ») ;</li>
        <li>Droit à la limitation du traitement ;</li>
        <li>Droit à la portabilité de vos données ;</li>
        <li>Droit d'opposition, notamment à la prospection commerciale ;</li>
        <li>Droit de retirer votre consentement à tout moment, lorsque le traitement en repose (ex. newsletter).</li>
      </Ul>
      <P>
        Pour exercer l'un de ces droits, contactez-nous à{" "}
        <a className="text-gold underline" href="mailto:contact@meribeautystudio.com">contact@meribeautystudio.com</a>.
        Vous disposez également du droit d'introduire une réclamation auprès de l'
        <a className="text-gold underline" href="https://www.autoriteprotectiondonnees.be" target="_blank" rel="noopener noreferrer">
          Autorité de protection des données
        </a>{" "}
        (APD, Belgique).
      </P>

      <H2>7. Cookies</H2>
      <P>
        Le Site utilise uniquement des cookies strictement nécessaires à son fonctionnement,
        pour lesquels aucun consentement préalable n'est requis :
      </P>
      <Ul>
        <li><strong>Cookie de session</strong> — vous garde connecté(e) à votre compte le temps de votre visite.</li>
        <li><strong>Cookie de panier</strong> — mémorise le contenu de votre panier d'achat entre deux visites, même sans compte.</li>
      </Ul>
      <P>
        Le Site n'utilise à ce jour aucun cookie de mesure d'audience (type Google Analytics)
        ni aucun cookie publicitaire. Si cela devait changer, cette politique sera mise à jour
        et un bandeau de consentement vous sera présenté au préalable.
      </P>

      <H3>Réseaux sociaux</H3>
      <P>
        Certaines images affichées sur le Site (par exemple dans la section Instagram) sont
        chargées directement depuis les serveurs d'Instagram/Meta. Consultez la politique de
        confidentialité de Meta pour en savoir plus sur leur propre traitement de données.
      </P>

      <H2>8. Droit à l'image</H2>
      <P>
        Le Site présente notamment des photographies publiées sur les réseaux sociaux de Meri
        Beauty (section Instagram) et dans sa galerie, pouvant montrer des clientes, clients ou
        visiteurs du salon. Ces photographies sont publiées avec l'accord des personnes
        photographiées au moment de la prise de vue.
      </P>
      <P>
        Si vous apparaissez sur une photographie diffusée sur le Site et souhaitez qu'elle soit
        retirée, contactez-nous à{" "}
        <a className="text-gold underline" href="mailto:contact@meribeautystudio.com">contact@meribeautystudio.com</a>{" "}
        en précisant la page concernée : nous la retirerons dans les meilleurs délais, sans
        justification requise de votre part.
      </P>

      <H2>9. Sécurité</H2>
      <P>
        Vos mots de passe sont stockés de manière chiffrée (jamais en clair). Les échanges avec
        le Site sont sécurisés par chiffrement TLS (HTTPS). L'accès aux outils de gestion interne
        est restreint au personnel autorisé. Les paiements sont traités par Stripe, certifié
        PCI-DSS, le plus haut niveau de sécurité pour le traitement de données bancaires.
      </P>

      <H2>10. Mineurs</H2>
      <P>
        Le Site s'adresse à un public majeur. Si vous êtes mineur(e), l'utilisation du Site et
        la réservation de prestations doivent se faire avec l'accord d'un parent ou tuteur légal.
      </P>

      <H2>11. Modifications</H2>
      <P>
        Cette politique peut être mise à jour pour refléter une évolution du Site ou de la
        réglementation. La date de dernière mise à jour figure en haut de cette page.
      </P>
    </LegalPageLayout>
  );
}
