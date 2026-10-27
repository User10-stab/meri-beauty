import LegalPageLayout, { H2, H3, P, Ul } from "@/components/website/LegalPageLayout";
import CookieSettingsButton from "@/components/analytics/CookieSettingsButton";

export const metadata = {
  title: "Politique de confidentialité | Meri Beauty",
  description: "Comment Meri Beauty collecte, utilise et protège vos données personnelles, conformément au RGPD.",
  alternates: { canonical: "/politique-de-confidentialite" },
};

export default function PolitiqueConfidentialitePage() {
  return (
    <LegalPageLayout eyebrow="Vos données" title="Politique de confidentialité" updated="27 octobre 2026">
      <H2>1. Responsable du traitement</H2>
      <P>
        Le responsable du traitement des données collectées via meribeautystudio.com (le
        « Site ») est Marie Mercier, exploitant Meri
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
        <li><strong>Avis clients :</strong> la note et le commentaire que vous rédigez après un rendez-vous terminé (voir section 9).</li>
      </Ul>

      <H2>3. Pourquoi nous utilisons ces données</H2>
      <Ul>
        <li>Créer et gérer votre compte, vos réservations et vos commandes (exécution du contrat).</li>
        <li>Traiter vos paiements et émettre vos factures / notes de crédit (exécution du contrat et obligations comptables).</li>
        <li>Vous envoyer les emails liés à votre commande ou réservation (confirmation, rappel, facture).</li>
        <li>Vous envoyer notre newsletter, uniquement si vous y avez consenti (consentement, retirable à tout moment).</li>
        <li>Mesurer la fréquentation du Site avec Google Analytics, uniquement si vous l&apos;avez accepté (consentement, retirable à tout moment — voir section 7).</li>
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
        <li><strong>OVH</strong> (OVH SAS, France) — hébergement du site et de la base de données, sur des serveurs situés dans l'Union européenne.</li>
        <li><strong>Mondial Relay</strong> — livraison des commandes en point relais.</li>
        <li><strong>Google</strong> (Google Ireland Limited) — mesure d&apos;audience Google Analytics, uniquement si vous l&apos;avez acceptée (voir section 7).</li>
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
        <li>Avis clients : conservés et affichés jusqu'à votre demande de retrait (voir section 9).</li>
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
        <li>Droit de retirer votre consentement à tout moment, lorsque le traitement en repose (ex. newsletter, mesure d&apos;audience).</li>
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
      <H3>Cookies strictement nécessaires</H3>
      <P>
        Ces cookies sont indispensables au fonctionnement du Site ; ils ne nécessitent pas
        votre consentement préalable :
      </P>
      <Ul>
        <li><strong>Cookie de session</strong> — vous garde connecté(e) à votre compte (7 jours maximum).</li>
        <li><strong>Cookie de panier</strong> — mémorise le contenu de votre panier d'achat entre deux visites, même sans compte (30 jours).</li>
      </Ul>
      <P>
        Votre choix concernant les cookies de mesure d'audience (accepté ou refusé) est
        lui-même mémorisé dans votre navigateur (stockage local), pour ne pas vous le
        redemander à chaque visite.
      </P>

      <H3>Cookies de mesure d&apos;audience (Google Analytics 4) — avec votre consentement</H3>
      <P>
        Si vous cliquez sur « Accepter » dans le bandeau cookies, le Site utilise Google
        Analytics 4, un service de Google Ireland Limited, pour mesurer sa fréquentation :
        pages consultées, provenance des visites (par exemple un lien Instagram ou une
        campagne), type d&apos;appareil et de navigateur, pays ou ville approximatifs, ainsi que
        les réservations et commandes effectuées (sans vos nom, email ou coordonnées). Ces
        statistiques nous servent uniquement à comprendre l&apos;usage du Site et à l&apos;améliorer.
      </P>
      <Ul>
        <li><strong>Base légale :</strong> votre consentement. Tant que vous n&apos;avez pas cliqué sur « Accepter » — ou si vous cliquez sur « Refuser » — le script Google Analytics n&apos;est pas chargé et aucun cookie de mesure n&apos;est déposé.</li>
        <li><strong>Cookies déposés :</strong> <code>_ga</code> et <code>_ga_&lt;identifiant&gt;</code>, qui distinguent les visiteurs de façon pseudonyme (durée maximale : 2 ans).</li>
        <li><strong>Adresse IP :</strong> Google Analytics 4 ne conserve pas les adresses IP ; les signaux publicitaires et Google Signals sont désactivés, aucune donnée n&apos;est utilisée à des fins publicitaires.</li>
        <li><strong>Transfert :</strong> Google peut traiter ces données hors de l&apos;Espace économique européen (notamment aux États-Unis), dans le cadre du EU-US Data Privacy Framework et des clauses contractuelles types.</li>
        <li><strong>Retirer votre consentement :</strong> à tout moment, via le lien « Gérer les cookies » ci-dessous (également présent en bas de chaque page), puis « Refuser ». Les cookies <code>_ga</code> sont alors supprimés. Vous pouvez aussi effacer les cookies depuis les réglages de votre navigateur.</li>
      </Ul>
      <P>
        <CookieSettingsButton className="text-gold underline hover:text-gold/80" />
      </P>
      <P>
        Le Site n&apos;utilise aucun cookie publicitaire.
      </P>

      <H3>Contenus de tiers</H3>
      <Ul>
        <li>
          <strong>Google Maps</strong> — la page Contact affiche un plan Google Maps intégré,
          chargé depuis les serveurs de Google. Google peut alors recevoir votre adresse IP et
          déposer ses propres cookies, selon sa{" "}
          <a className="text-gold underline" href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">politique de confidentialité</a>.
        </li>
        <li>
          <strong>Instagram</strong> — les photos et vidéos de la section Instagram sont
          chargées directement depuis les serveurs d&apos;Instagram/Meta, qui reçoivent alors votre
          adresse IP ; les liens vers notre compte Instagram vous emmènent sur instagram.com.
          Consultez la{" "}
          <a className="text-gold underline" href="https://privacycenter.instagram.com/policy" target="_blank" rel="noopener noreferrer">politique de confidentialité d&apos;Instagram</a>{" "}
          pour en savoir plus.
        </li>
        <li>
          <strong>Mondial Relay</strong> — lors d&apos;une commande en point relais, le sélecteur
          de points relais est fourni par Mondial Relay et charge sa carte (OpenStreetMap) et
          ses ressources depuis leurs serveurs.
        </li>
      </Ul>

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

      <H2>9. Avis publiés sur le Site</H2>
      <P>
        Lorsque vous déposez un avis depuis votre espace client après un rendez-vous, un atelier,
        un événement ou une formation terminé(e), votre note, votre commentaire, la prestation
        concernée ainsi que votre prénom suivi de
        l'initiale de votre nom de famille (par exemple « Camille R. ») peuvent être affichés
        publiquement sur la page d'accueil du Site. Votre nom complet, votre email et vos
        coordonnées ne sont jamais publiés — ils restent visibles uniquement de l'équipe Meri
        Beauty dans son outil de gestion interne.
      </P>
      <P>
        La publication repose sur notre intérêt légitime à présenter des retours authentiques.
        Vous pouvez à tout moment demander le retrait de votre avis, sans justification, en
        écrivant à{" "}
        <a className="text-gold underline" href="mailto:contact@meribeautystudio.com">contact@meribeautystudio.com</a>.
      </P>

      <H2>10. Sécurité</H2>
      <P>
        Vos mots de passe sont stockés de manière chiffrée (jamais en clair). Les échanges avec
        le Site sont sécurisés par chiffrement TLS (HTTPS). L'accès aux outils de gestion interne
        est restreint au personnel autorisé. Les paiements sont traités par Stripe, certifié
        PCI-DSS, le plus haut niveau de sécurité pour le traitement de données bancaires.
      </P>

      <H2>11. Mineurs</H2>
      <P>
        Le Site s'adresse à un public majeur. Si vous êtes mineur(e), l'utilisation du Site et
        la réservation de prestations doivent se faire avec l'accord d'un parent ou tuteur légal.
      </P>

      <H2>12. Modifications</H2>
      <P>
        Cette politique peut être mise à jour pour refléter une évolution du Site ou de la
        réglementation. La date de dernière mise à jour figure en haut de cette page.
      </P>
    </LegalPageLayout>
  );
}
