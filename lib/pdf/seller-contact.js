import { prisma } from "@/lib/prisma";
import { getAppBaseUrl } from "@/lib/site-url";

/**
 * Presentational seller contact details (phone / email / site) for the PDF
 * header and footer.
 *
 * Deliberately NOT snapshotted onto Invoice: the legal mentions (registered
 * name, address, VAT number) are frozen on the document row at issue time
 * and must never move, but a phone number is only a way to reach the shop —
 * a reprint should show the number that works today, not a dead one from
 * two years ago.
 *
 * Cached because every fulfilment path renders a PDF right after settling a
 * payment, and this would otherwise add a query to each of them. Failures
 * are swallowed and left uncached: a missing phone number must never be the
 * reason a paid customer's invoice fails to render.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = null; // { at: number, value: object }

function websiteHost() {
  return getAppBaseUrl().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export async function getSellerContact() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  let salon = null;
  try {
    salon = await prisma.salon.findUnique({
      where: { id: "main-salon" },
      select: { phone: true, email: true, rib: true },
    });
  } catch {
    return { phone: null, email: null, website: websiteHost() };
  }

  const value = {
    phone: salon?.phone || null,
    email: salon?.email || null,
    rib: salon?.rib || null,
    website: websiteHost(),
  };
  cache = { at: Date.now(), value };
  return value;
}

/** Test/seed hook — the cache would otherwise outlive a salon settings edit. */
export function clearSellerContactCache() {
  cache = null;
}
