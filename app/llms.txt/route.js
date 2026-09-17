import { prisma } from "@/lib/prisma";
import { getAppBaseUrl } from "@/lib/site-url";
import { formatDurationShort } from "@/lib/format-duration";

const SITE_URL = getAppBaseUrl();

// Regenerate at most once an hour — same cadence and same reasoning as
// app/sitemap.js: cheap enough for how often services/hours actually
// change, and avoids depending on the DB being reachable at build/request
// time for every single crawler hit.
export const revalidate = 3600;
export const dynamic = "force-dynamic";

const SCHEMA_DAY_FR = {
  MONDAY: "Lundi",
  TUESDAY: "Mardi",
  WEDNESDAY: "Mercredi",
  THURSDAY: "Jeudi",
  FRIDAY: "Vendredi",
  SATURDAY: "Samedi",
  SUNDAY: "Dimanche",
};

const DAY_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value));
}

function formatPriceRange(min, max) {
  if (min == null) return null;
  return min === max ? formatEuro(min) : `${formatEuro(min)} – ${formatEuro(max)}`;
}

function formatHoursLine(salon) {
  const byDay = new Map((salon.workingDays ?? []).map((wd) => [wd.day, wd]));
  return DAY_ORDER.map((day) => {
    const wd = byDay.get(day);
    if (!wd || !wd.isOpen) return `${SCHEMA_DAY_FR[day]} : fermé`;
    return `${SCHEMA_DAY_FR[day]} : ${wd.openingTime?.slice(0, 5)} – ${wd.closingTime?.slice(0, 5)}`;
  }).join("\n");
}

/** llms.txt — a plain-text summary for AI assistants and answer engines
 * (ChatGPT, Claude, Perplexity, Gemini…), which read HTML far less reliably
 * than a search-engine crawler. Emerging convention, not a formal web
 * standard: https://llmstxt.org. Built from the same live DB rows as the
 * rest of the public site so it can never drift into stating a price, an
 * address or opening hours the site itself doesn't back up.
 */
export async function GET() {
  const [salon, categories] = await Promise.all([
    prisma.salon.findUnique({
      where: { id: "main-salon" },
      include: { workingDays: { orderBy: { day: "asc" } } },
    }),
    prisma.category.findMany({
      where: { isDeleted: false },
      orderBy: { name: "asc" },
      include: {
        services: {
          where: { isDeleted: false },
          orderBy: { name: "asc" },
          include: {
            staffServices: {
              where: { isActive: true, isDeleted: false },
              select: { price: true, duration: true },
            },
          },
        },
      },
    }),
  ]);

  const lines = [];

  lines.push(`# ${salon?.name ?? "Meri Beauty"}`);
  lines.push("");
  lines.push(
    "> Salon de beauté & bien-être à Jette, Bruxelles (Belgique) — coiffure, soins visage, manucure, massage et rituels corps sur mesure. Réservation en ligne, boutique de produits, ateliers et formations."
  );
  lines.push("");

  lines.push("## Coordonnées");
  if (salon?.address) lines.push(`- Adresse : ${salon.address}`);
  if (salon?.phone) lines.push(`- Téléphone : ${salon.phone}`);
  if (salon?.email) lines.push(`- E-mail : ${salon.email}`);
  lines.push(`- Site web : ${SITE_URL}`);
  const socials = [salon?.instagram, salon?.facebook, salon?.tiktok].filter(Boolean);
  if (socials.length) lines.push(`- Réseaux sociaux : ${socials.join(", ")}`);
  lines.push("");

  if (salon?.workingDays?.length) {
    lines.push("## Horaires");
    lines.push(formatHoursLine(salon));
    lines.push("");
  }

  lines.push("## Langues");
  lines.push("Site disponible en français, anglais et néerlandais.");
  lines.push("");

  const categoriesWithServices = categories.filter((c) => c.services.length > 0);
  if (categoriesWithServices.length) {
    lines.push("## Prestations");
    for (const category of categoriesWithServices) {
      lines.push(`### ${category.name}`);
      for (const service of category.services) {
        const prices = service.staffServices.map((s) => Number(s.price));
        const durations = service.staffServices.map((s) => s.duration);
        const priceRange = prices.length ? formatPriceRange(Math.min(...prices), Math.max(...prices)) : null;
        const durationRange = durations.length
          ? (() => {
              const min = Math.min(...durations);
              const max = Math.max(...durations);
              return min === max ? formatDurationShort(min) : `${formatDurationShort(min)} – ${formatDurationShort(max)}`;
            })()
          : null;
        const meta = [priceRange, durationRange].filter(Boolean).join(", ");
        lines.push(`- ${service.name}${meta ? ` (${meta})` : ""}`);
      }
      lines.push("");
    }
  }

  lines.push("## Pages");
  lines.push(`- Réservation en ligne : ${SITE_URL}/reservation`);
  lines.push(`- Boutique : ${SITE_URL}/boutique`);
  lines.push(`- Ateliers & événements : ${SITE_URL}/evenements`);
  lines.push(`- Formations : ${SITE_URL}/formations`);
  lines.push(`- Notre équipe : ${SITE_URL}/animateurs`);
  lines.push(`- Contact : ${SITE_URL}/contact`);
  lines.push("");
  lines.push(`Plan du site complet : ${SITE_URL}/sitemap.xml`);

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
