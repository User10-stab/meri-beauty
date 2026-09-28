import { PROMO_CODE_SCOPES, PROMO_CODE_SCOPE_LABELS } from "@/lib/promo-code-scopes";

// Explicit timeZone everywhere — without it the server renders Brussels time
// but the viewer's browser its own local time (hydration mismatch + a wrong
// expiry shown to anyone outside Belgium).
const TZ = "Europe/Brussels";

export function formatPromoValue(promo) {
  const value = Number(promo.value) || 0;
  if (promo.type === "PERCENTAGE") return `-${value % 1 === 0 ? value : value.toFixed(2)} %`;
  return `-${value.toFixed(2).replace(".", ",")} €`;
}

export function formatEuro(amount) {
  return `${Number(amount ?? 0).toFixed(2).replace(".", ",")} €`;
}

export function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("fr-BE", { dateStyle: "medium", timeStyle: "short", timeZone: TZ });
}

export function formatExpiryLabel(expiresAt, now = new Date()) {
  if (!expiresAt) return "Sans date d'expiration";
  const date = new Date(expiresAt);
  const day = date.toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric", timeZone: TZ });
  const time = date.toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  return date < now ? `Expiré le ${day} à ${time}` : `Expire le ${day} à ${time}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One status per code, in priority order — what the salon actually needs to
 * know first (a switched-off code is "inactive" even if it also expired).
 */
export function promoStatus(promo, now = new Date()) {
  if (!promo.isActive) return "INACTIVE";
  if (promo.expiresAt && new Date(promo.expiresAt) < now) return "EXPIRED";
  if (promo.maxUses != null && promo.usedCount >= promo.maxUses) return "EXHAUSTED";
  if (promo.expiresAt && new Date(promo.expiresAt) - now < 7 * DAY_MS) return "EXPIRING";
  return "ACTIVE";
}

export const STATUS_META = {
  ACTIVE: { label: "Actif", className: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-900/20 dark:text-emerald-400" },
  EXPIRING: { label: "Expire bientôt", className: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-900/20 dark:text-amber-400" },
  EXHAUSTED: { label: "Épuisé", className: "bg-orange-50 text-orange-700 ring-orange-600/15 dark:bg-orange-900/20 dark:text-orange-400" },
  EXPIRED: { label: "Expiré", className: "bg-gray-100 text-gray-600 ring-gray-500/15 dark:bg-dark-2 dark:text-dark-6" },
  INACTIVE: { label: "Désactivé", className: "bg-gray-100 text-gray-500 ring-gray-500/15 dark:bg-dark-2 dark:text-dark-6" },
};

export function scopeSummary(scopes) {
  if (!scopes?.length || PROMO_CODE_SCOPES.every((s) => scopes.includes(s))) return "Partout";
  return PROMO_CODE_SCOPES.filter((s) => scopes.includes(s)).map((s) => PROMO_CODE_SCOPE_LABELS[s]).join(" · ");
}

/** Plain-French one-liner of every rule on a code, for previews and cards. */
export function describePromoRules(promo) {
  const parts = [];
  const scopes = promo.scopes ?? PROMO_CODE_SCOPES;
  const productCount = promo.products?.length ?? 0;
  const serviceCount = promo.services?.length ?? 0;

  if (scopes.includes("BOUTIQUE") && productCount > 0) {
    parts.push(productCount === 1 ? `sur « ${promo.products[0].name} »` : `sur ${productCount} produits`);
  }
  if (scopes.includes("APPOINTMENT") && serviceCount > 0) {
    parts.push(serviceCount === 1 ? `sur la prestation « ${promo.services[0].name} »` : `sur ${serviceCount} prestations`);
  }
  if (promo.minOrderAmount) parts.push(`dès ${formatEuro(promo.minOrderAmount)} d'achat`);

  const customers = promo.customers ?? [];
  if (customers.length === 1) parts.push(`réservé à ${customers[0].fullName}`);
  else if (customers.length > 1) parts.push(`réservé à ${customers.length} clients`);

  if (promo.maxUsesPerCustomer) {
    parts.push(promo.maxUsesPerCustomer === 1 ? "1 fois par client" : `${promo.maxUsesPerCustomer} fois par client`);
  }
  if (promo.maxUses) parts.push(`${promo.maxUses} utilisation${promo.maxUses > 1 ? "s" : ""} au total`);
  return parts;
}
