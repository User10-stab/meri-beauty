const COUNTRY_NAMES = {
  BE: "Belgique",
  FR: "France",
  LU: "Luxembourg",
  NL: "Pays-Bas",
  DE: "Allemagne",
};

/**
 * Formats a User's billing address into a single display string for
 * invoices, e.g. "Rue de la Paix 12, 1000 Bruxelles, Belgique".
 *
 * Returns null if the required parts (line1/city/postalCode) are missing —
 * accounts created before this field existed have none of this on file, and
 * an invoice should show a genuinely blank address rather than a
 * half-formatted string.
 *
 * @param {{ addressLine1?: string|null, addressLine2?: string|null, addressCity?: string|null, addressPostalCode?: string|null, addressCountry?: string|null }} user
 * @returns {string|null}
 */
export function formatUserAddress(user) {
  if (!user?.addressLine1 || !user?.addressCity || !user?.addressPostalCode) {
    return null;
  }

  const countryCode = user.addressCountry || "BE";
  const countryName = COUNTRY_NAMES[countryCode] ?? countryCode;

  const parts = [
    [user.addressLine1, user.addressLine2].filter(Boolean).join(", "),
    `${user.addressPostalCode} ${user.addressCity}`,
    countryName,
  ];

  return parts.filter(Boolean).join(", ");
}
