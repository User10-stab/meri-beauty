export function toIntlLocale(locale) {
  switch (locale) {
    case "nl":
      return "nl-BE";
    case "en":
      return "en-GB";
    default:
      return "fr-BE";
  }
}
