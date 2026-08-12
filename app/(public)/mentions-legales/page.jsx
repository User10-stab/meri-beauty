import LegalPageLayout, { H2, P, Ul } from "@/components/website/LegalPageLayout";

export const metadata = {
  title: "Mentions légales | Meri Beauty",
  description: "Identité de l'exploitante, coordonnées, hébergement et informations légales du site Meri Beauty.",
  alternates: { canonical: "/mentions-legales" },
};

export default function MentionsLegalesPage() {
  return (
    <LegalPageLayout eyebrow="Informations légales" title="Mentions légales" updated="12 août 2026">
      <H2>1. Éditeur du site</H2>
      <P>
        Le site accessible à l'adresse meribeautystudio.com (le « Site ») est exploité par :
      </P>
      <Ul>
        <li><strong>Nom commercial :</strong> Meri Beauty</li>
        <li><strong>Exploitée par :</strong> Marie Mercier, agissant à titre personnel</li>
        <li><strong>Statut juridique :</strong> Personne physique (entreprise individuelle / indépendante)</li>
        <li><strong>Numéro d'entreprise (BCE) :</strong> BE 0751.854.027</li>
        <li><strong>Numéro de TVA :</strong> BE 0751.854.027</li>
        <li><strong>Adresse du siège d'exploitation :</strong> Rue Bonaventure 113, 1090 Jette, Belgique</li>
        <li><strong>Téléphone :</strong> +32 484 64 36 65</li>
        <li><strong>Email :</strong> contact@meribeautystudio.com</li>
      </Ul>
      <P>
        Le numéro d'entreprise ci-dessus peut être vérifié à tout moment sur le site de la{" "}
        Banque-Carrefour des Entreprises (
        <a className="text-gold underline" href="https://kbopub.economie.fgov.be" target="_blank" rel="noopener noreferrer">
          kbopub.economie.fgov.be
        </a>
        ).
      </P>

      <H2>2. Directeur de la publication</H2>
      <P>
        La direction de la publication est assurée par la personne physique identifiée à
        l'article 1 ci-dessus, en sa qualité d'exploitante de Meri Beauty.
      </P>

      <H2>3. Hébergement</H2>
      <P>
        Le Site et sa base de données sont hébergés par OVH SAS, 2 rue Kellermann, 59100
        Roubaix, France, sur des serveurs situés dans l'Union européenne. Les
        paiements en ligne sont traités par Stripe Payments Europe, Ltd. (voir la{" "}
        <a className="text-gold underline" href="/politique-de-confidentialite">Politique de confidentialité</a>{" "}
        pour le détail des sous-traitants).
      </P>

      <H2>4. Propriété intellectuelle</H2>
      <P>
        L'ensemble des textes, images, logos, illustrations et éléments graphiques présents sur
        le Site sont la propriété de Meri Beauty ou de ses partenaires, et sont protégés par le
        droit d'auteur et le droit des marques. Toute reproduction, représentation, modification
        ou diffusion, totale ou partielle, sans autorisation écrite préalable, est interdite.
      </P>

      <H2>5. Droit à l'image</H2>
      <P>
        Certaines photographies présentes sur le Site (notamment issues des réseaux sociaux de
        Meri Beauty) peuvent représenter des personnes identifiables. Toute personne
        s'estimant lésée par la présence de son image sur le Site peut en demander le retrait
        à{" "}
        <a className="text-gold underline" href="mailto:contact@meribeautystudio.com">contact@meribeautystudio.com</a>
        . Voir également la{" "}
        <a className="text-gold underline" href="/politique-de-confidentialite">Politique de confidentialité</a>, section « Droit à l'image ».
      </P>

      <H2>6. Liens hypertextes</H2>
      <P>
        Le Site peut contenir des liens vers des sites tiers (réseaux sociaux, prestataires de
        paiement ou de livraison). Meri Beauty n'exerce aucun contrôle sur ces sites et décline
        toute responsabilité quant à leur contenu ou leurs pratiques.
      </P>

      <H2>7. Limitation de responsabilité</H2>
      <P>
        Meri Beauty met tout en œuvre pour assurer l'exactitude et la mise à jour des
        informations diffusées sur le Site, sans pouvoir garantir l'absence totale d'erreur.
        Meri Beauty ne pourra être tenue responsable des dommages directs ou indirects résultant
        de l'accès au Site, de son indisponibilité ou d'une interruption technique.
      </P>

      <H2>8. Droit applicable et litiges</H2>
      <P>
        Les présentes mentions légales sont soumises au droit belge. En cas de litige, et à
        défaut de résolution amiable, les tribunaux de l'arrondissement judiciaire de Bruxelles
        seront seuls compétents.
      </P>
      <P>
        Conformément au Code de droit économique, tout consommateur peut également s'adresser
        gratuitement au{" "}
        <a className="text-gold underline" href="https://mediationconsommateur.be" target="_blank" rel="noopener noreferrer">
          Service de Médiation pour le Consommateur
        </a>{" "}
        ou déposer une plainte via la{" "}
        <a className="text-gold underline" href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">
          plateforme européenne de règlement en ligne des litiges (RLL)
        </a>
        .
      </P>
    </LegalPageLayout>
  );
}
