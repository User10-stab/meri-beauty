import { prisma } from "@/lib/prisma";
import { getAppBaseUrl } from "@/lib/site-url";
import { reportPublicDataError } from "@/lib/prisma-public-fallback";

const SITE_URL = getAppBaseUrl();

// Same reasoning as app/sitemap.js: cached for an hour, and rendered on
// demand so `next build` never depends on the database being reachable.
export const revalidate = 3600;
export const dynamic = "force-dynamic";

const DAY_LABEL = {
  MONDAY: "Lundi",
  TUESDAY: "Mardi",
  WEDNESDAY: "Mercredi",
  THURSDAY: "Jeudi",
  FRIDAY: "Vendredi",
  SATURDAY: "Samedi",
  SUNDAY: "Dimanche",
};

// Descriptions are free text typed in the dashboard — flatten them to one
// line so a stray newline or "#" can't break the markdown list structure.
function oneLine(text, max = 200) {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function link(title, path, note) {
  const suffix = note ? `: ${note}` : "";
  return `- [${oneLine(title, 120)}](${SITE_URL}${path})${suffix}`;
}

function formatPrice(value) {
  return `${Number(value).toFixed(2).replace(".", ",")} €`;
}

async function loadCatalogue() {
  const [salon, categories, activities, formations] = await Promise.all([
    prisma.salon.findUnique({
      where: { id: "main-salon" },
      include: { workingDays: { orderBy: { day: "asc" } } },
    }),
    // Only prestations a client can actually book: at least one active
    // staff member offering it.
    prisma.category.findMany({
      where: { isDeleted: false },
      orderBy: { name: "asc" },
      select: {
        name: true,
        services: {
          where: {
            isDeleted: false,
            staffServices: { some: { isActive: true, isDeleted: false } },
          },
          orderBy: { name: "asc" },
          select: { name: true },
        },
      },
    }),
    prisma.activity.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { title: "asc" },
      select: { id: true, title: true, description: true, price: true },
    }),
    prisma.formation.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { title: "asc" },
      select: { id: true, title: true, description: true, price: true, type: true },
    }),
  ]);

  return { salon, categories, activities, formations };
}

function buildSalonFacts(salon) {
  if (!salon) return [];

  const street = salon.addressLine1
    ? [salon.addressLine1, salon.addressLine2].filter(Boolean).join(", ")
    : salon.address;
  const address = [street, [salon.postalCode, salon.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  const hours = (salon.workingDays ?? [])
    .filter((wd) => wd.isOpen)
    .map((wd) => `${DAY_LABEL[wd.day] ?? wd.day} ${wd.openingTime}–${wd.closingTime}`)
    .join(" ; ");

  return [
    address && `- Adresse : ${oneLine(address)}`,
    salon.phone && `- Téléphone : ${salon.phone}`,
    salon.email && `- E-mail : ${salon.email}`,
    hours && `- Horaires : ${hours}`,
    salon.instagram && `- Instagram : ${salon.instagram}`,
    salon.facebook && `- Facebook : ${salon.facebook}`,
    salon.tiktok && `- TikTok : ${salon.tiktok}`,
  ].filter(Boolean);
}

function buildLlmsTxt({ salon, categories, activities, formations }) {
  const sections = [
    "# Meri Beauty",
    "> Salon de beauté & bien-être à Jette, Bruxelles (Belgique) : coiffure, soins visage, manucure, massage et rituels corps, avec une boutique de produits de beauté, des ateliers et des formations professionnelles sous un même toit. Réservation et paiement en ligne.",
    "Le site est en français. Les prix affichés sont TTC (TVA belge incluse). Les rendez-vous, ateliers et formations se réservent en ligne ; la boutique livre en Belgique et propose le retrait au salon.",
    buildSalonFacts(salon).join("\n"),
    [
      "## Pages principales",
      link("Accueil", "/", "présentation du salon, équipe et avis clients"),
      link("Prendre rendez-vous", "/reservation", "réservation en ligne d'une prestation avec la praticienne de son choix"),
      link("Boutique", "/boutique", "produits de beauté en vente en ligne et au salon"),
      link("Ateliers & événements", "/evenements", "ateliers beauté et événements ouverts au public"),
      link("Formations", "/formations", "formations professionnelles privées et de groupe"),
      link("Le concept", "/concept", "salon, boutique, formations et ateliers réunis en un lieu"),
      link("Animateurs", "/animateurs", "les professionnels qui animent les ateliers et formations"),
      link("Contact", "/contact", "adresse, horaires et formulaire de contact"),
    ].join("\n"),
  ];

  const bookable = categories.filter((c) => c.services.length > 0);
  if (bookable.length > 0) {
    sections.push(
      [
        "## Prestations",
        ...bookable.map(
          (c) => `- ${oneLine(c.name, 120)} : ${c.services.map((s) => oneLine(s.name, 120)).join(", ")}`,
        ),
        "",
        `Toutes les prestations se réservent sur ${SITE_URL}/reservation.`,
      ].join("\n"),
    );
  }

  if (activities.length > 0) {
    sections.push(
      [
        "## Ateliers & événements",
        ...activities.map((a) =>
          link(
            a.title,
            `/evenements/${a.id}`,
            [formatPrice(a.price), oneLine(a.description)].filter(Boolean).join(" — "),
          ),
        ),
      ].join("\n"),
    );
  }

  if (formations.length > 0) {
    sections.push(
      [
        "## Formations",
        ...formations.map((f) =>
          link(
            f.title,
            `/formations/${f.id}`,
            [
              f.type === "PRIVATE" ? "formation privée" : "formation de groupe",
              formatPrice(f.price),
              oneLine(f.description),
            ]
              .filter(Boolean)
              .join(" — "),
          ),
        ),
      ].join("\n"),
    );
  }

  sections.push(
    [
      "## Optional",
      link("Retours boutique", "/boutique/returns", "politique de retour et de remboursement"),
      link("Conditions générales de vente", "/cgv"),
      link("Mentions légales", "/mentions-legales"),
      link("Politique de confidentialité", "/politique-de-confidentialite"),
      `- [Plan du site](${SITE_URL}/sitemap.xml): liste complète des pages, produits compris`,
    ].join("\n"),
  );

  return `${sections.filter(Boolean).join("\n\n")}\n`;
}

export async function GET() {
  let catalogue = { salon: null, categories: [], activities: [], formations: [] };
  try {
    catalogue = await loadCatalogue();
  } catch (error) {
    // The static half of the file is still worth serving if the DB is down.
    reportPublicDataError("[llms.txt]", error);
  }

  return new Response(buildLlmsTxt(catalogue), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
