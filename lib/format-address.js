const COUNTRY_NAMES = {
  BE: "Belgique",
  FR: "France",
  LU: "Luxembourg",
  NL: "Pays-Bas",
  DE: "Allemagne",
};

/**
 * Formats a structured address into a single display string for invoices,
 * e.g. "Rue de la Paix 12, 1000 Bruxelles, Belgique".
 *
 * Returns null if the required parts (line1/city/postalCode) are missing.
 *
 * @param {{ line1?: string|null, line2?: string|null, city?: string|null, postalCode?: string|null, countryCode?: string|null }} address
 * @returns {string|null}
 */
export function formatAddress({ line1, line2, city, postalCode, countryCode } = {}) {
  if (!line1 || !city || !postalCode) return null;

  const code = countryCode || "BE";
  const countryName = COUNTRY_NAMES[code] ?? code;

  const parts = [
    [line1, line2].filter(Boolean).join(", "),
    `${postalCode} ${city}`,
    countryName,
  ];

  return parts.filter(Boolean).join(", ");
}

/**
 * User's billing address (mandatory at registration — see the field
 * comments on User in prisma/schema.prisma). Returns null for accounts
 * created before this field existed, rather than a half-formatted string.
 *
 * @param {{ addressLine1?: string|null, addressLine2?: string|null, addressCity?: string|null, addressPostalCode?: string|null, addressCountry?: string|null }} user
 * @returns {string|null}
 */
export function formatUserAddress(user) {
  return formatAddress({
    line1: user?.addressLine1,
    line2: user?.addressLine2,
    city: user?.addressCity,
    postalCode: user?.addressPostalCode,
    countryCode: user?.addressCountry,
  });
}

/**
 * Salon's structured legal address — see lib/invoicing.js#issueInvoice's
 * seller-data gate, which requires this to resolve before any invoice can
 * be issued.
 *
 * @param {{ addressLine1?: string|null, addressLine2?: string|null, city?: string|null, postalCode?: string|null, countryCode?: string|null }} salon
 * @returns {string|null}
 */
export function formatSalonAddress(salon) {
  return formatAddress({
    line1: salon?.addressLine1,
    line2: salon?.addressLine2,
    city: salon?.city,
    postalCode: salon?.postalCode,
    countryCode: salon?.countryCode,
  });
}
