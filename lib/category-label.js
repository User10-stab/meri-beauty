// Traduction des noms de catégories de prestations (Category.name).
//
// Les catégories sont saisies par Marie dans le tableau de bord et stockées
// en français uniquement (pas de colonne nameNl/nameEn dans le schéma). Pour
// le site en NL/EN, on traduit à l'affichage via messages/*.json →
// "categories.names", indexé par un slug stable dérivé du nom français.
// Une catégorie absente de la table reste affichée telle quelle (repli FR).
//
// IMPORTANT : ne traduire que le libellé affiché. Les liens (ex.
// /staff/<id>?category=…) doivent garder le nom d'origine, c'est lui que
// les pages filtrent.

/** « BEAUTÉ DES PIEDS » → « beaute-des-pieds », « CILS & SOURCILS » → « cils-sourcils ». */
export function categorySlug(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Libellé traduit d'une catégorie.
 * @param {Function} t   traducteur next-intl sur le namespace "categories.names"
 *                       (useTranslations("categories.names") / getTranslations(...))
 * @param {string} name  nom tel que stocké en base
 * @param {string} [locale] locale courante ; en "fr" on renvoie le nom d'origine
 */
export function translateCategoryName(t, name, locale) {
  if (!name) return name;
  if (locale === "fr") return name;
  const key = categorySlug(name);
  if (!key || typeof t?.has !== "function" || !t.has(key)) return name;
  const label = t(key);
  // Les noms en base sont souvent en MAJUSCULES : on garde la même casse
  // pour que l'affichage reste identique d'une langue à l'autre.
  return name === name.toLocaleUpperCase("fr") ? label.toLocaleUpperCase() : label;
}
