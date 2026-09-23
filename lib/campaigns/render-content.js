/**
 * Rendu du contenu rédigé par l'admin — module PUR (client + serveur).
 *
 * Règle : on ne touche JAMAIS à la structure d'origine.
 * - Si le contenu contient déjà du HTML (balises), il est gardé tel quel.
 * - Si c'est du texte brut (rédigé dans le textarea du wizard), on
 *   l'échappe puis on convertit les sauts de ligne en <br> et on fige
 *   les suites d'espaces en &nbsp; — sinon le HTML écrase les retours
 *   à la ligne et les espacements (c'est ce qui "mangeait" ta mise en page).
 */

const HTML_HINT = /<\s*(p|br|div|ul|ol|li|h[1-6]|a|img|table|strong|em|span|blockquote)\b/i;

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

export function looksLikeHtml(content) {
  return HTML_HINT.test(String(content ?? ""));
}

export function renderCampaignContent(content) {
  const raw = String(content ?? "");
  if (looksLikeHtml(raw)) return raw;
  return escapeText(raw)
    .replace(/ {2,}/g, (run) => "&nbsp;".repeat(run.length))
    .replace(/\r\n|\r|\n/g, "<br>");
}
