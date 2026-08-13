export const locales = ["fr", "en", "nl"];
export const defaultLocale = "fr";

export function isLocale(value) {
  return locales.includes(value);
}
