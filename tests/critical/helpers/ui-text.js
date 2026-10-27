import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Depuis la passe de traduction NL/EN (audit MB-008, oct. 2026), beaucoup de
// phrases françaises que ces tests de contrat cherchaient dans le composant
// vivent dans messages/fr.json, et le composant n'appelle plus que t("clé").
// hasUiText garde la même garantie : la phrase est montrée au client, soit
// écrite dans le composant, soit portée par une clé de fr.json que le
// composant utilise réellement.

const root = fileURLToPath(new URL("../../../", import.meta.url));
const FR = JSON.parse(readFileSync(`${root}messages/fr.json`, "utf8"));

// &apos; (JSX) et '' (échappement ICU) désignent la même apostrophe.
const normalize = (s) => s.replace(/&apos;/g, "'").replace(/''/g, "'").replace(/\r\n/g, "\n");

const LEAVES = [];
(function walk(node, path) {
  for (const [key, value] of Object.entries(node)) {
    const next = [...path, key];
    if (value && typeof value === "object") walk(value, next);
    else if (typeof value === "string") LEAVES.push({ path: next, value: normalize(value) });
  }
})(FR, []);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function hasUiText(source, text) {
  const src = normalize(source);
  const wanted = normalize(text);
  if (src.includes(wanted)) return true;
  return LEAVES.some(({ path, value }) => {
    if (!value.includes(wanted)) return false;
    // t("clé") ou t("parent.clé") : le dernier segment, entre guillemets ou
    // précédé d'un point, suffit à prouver que le composant lit cette clé.
    const leaf = escapeRe(path[path.length - 1]);
    return new RegExp(`["'\`.]${leaf}["'\`]`).test(src);
  });
}
