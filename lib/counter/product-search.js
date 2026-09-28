/**
 * Product finding at the till, without a label on the box.
 *
 * Two halves, both pure (no DB, no server-only import) so the counter UI and
 * the tests can use them directly:
 *
 * - Forgiving name search. The old search was one Postgres `contains` on the
 *   whole typed string: "creme hydra" never found "Crème Hydratante" (accent)
 *   and "hydratante creme" never found it either (word order). Here every
 *   typed word is matched on its own, accent-insensitive, by prefix, and with
 *   one or two typos tolerated. Scoring runs in JS over the active catalogue
 *   (a few hundred variants) — no pg_trgm/unaccent extension, so no prod
 *   migration.
 *
 * - Barcode learning. Almost every supplier box already carries an EAN; the
 *   variant just doesn't know it yet. The till links a scanned unknown code
 *   to the variant the cashier picks, once (linkPointOfSaleBarcode).
 */

// ---------------------------------------------------------------------------
// Text normalisation
// ---------------------------------------------------------------------------

export function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Query words. A lone letter is noise ("a", "l'") — a lone digit is a shade ("teinte 3"). */
export function tokenizeSearchQuery(query) {
  return normalizeSearchText(query)
    .split(" ")
    .filter((token) => token.length >= 2 || /^\d$/.test(token));
}

// Optimal-string-alignment distance (Levenshtein + adjacent transposition —
// "hydartant" is a swap, the commonest typo on a till keyboard). Bails out as
// soon as a row exceeds `max`, since only "within max or not" matters.
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prevPrev = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (prevPrev && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prevPrev[j - 2] + 1);
      }
      row.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = row;
  }
  return prev[b.length];
}

function allowedTypos(token) {
  if (token.length >= 7) return 2;
  if (token.length >= 4) return 1;
  return 0;
}

// Best score of one query word against one field. 0 = no match.
function scoreTokenInField(token, field) {
  if (!field.text) return 0;
  let best = 0;
  const typos = allowedTypos(token);
  const isNumber = /^\d+$/.test(token);
  for (const word of field.words) {
    if (word === token) return 3;
    // "Teinte 03" typed as "3".
    if (isNumber && /^\d+$/.test(word) && Number(word) === Number(token)) return 3;
    if (word.startsWith(token)) {
      best = Math.max(best, 2);
      continue;
    }
    // "15" must not match "150 ml" by substring, nor "03" match "2030".
    if (!isNumber && token.length >= 3 && word.includes(token)) {
      best = Math.max(best, 1.5);
      continue;
    }
    if (typos > 0 && !isNumber) {
      // Against the whole word ("hidratante") and against its prefix of the
      // same length, so a typo in a half-typed word still matches ("hidra").
      const whole = editDistance(token, word, typos);
      const prefix = word.length > token.length ? editDistance(token, word.slice(0, token.length), typos) : whole;
      if (Math.min(whole, prefix) <= typos) best = Math.max(best, 1);
    }
  }
  // "rosegold" typed for "Rose Gold", "antiage" for "anti-âge".
  if (best < 1.5 && !isNumber && token.length >= 4 && field.compact.includes(token)) best = Math.max(best, 1.5);
  return best;
}

const FIELD_WEIGHTS = { product: 1, variant: 0.9, brand: 0.8, category: 0.5, code: 1 };

function buildField(kind, value) {
  const text = normalizeSearchText(value);
  return { kind, text, words: text ? text.split(" ") : [], compact: text.replace(/ /g, "") };
}

/**
 * Pre-normalises one variant's searchable text. `variantName` "Standard" is
 * the placeholder for single-variant products and would otherwise match a
 * search for "standard" on the whole catalogue.
 */
export function buildSearchEntry({ productName, variantName, brandName, categoryNames = [], sku, barcode }) {
  return {
    fields: [
      buildField("product", productName),
      buildField("variant", variantName === "Standard" ? "" : variantName),
      buildField("brand", brandName),
      buildField("category", categoryNames.filter(Boolean).join(" ")),
      buildField("code", [sku, barcode].filter(Boolean).join(" ")),
    ],
  };
}

/**
 * Relevance of an entry for a query, or 0 when it doesn't match. Every query
 * word has to match somewhere (AND), otherwise "crème main" would list every
 * cream in the shop.
 */
export function scoreSearchEntry(entry, tokens, normalizedQuery = tokens.join(" ")) {
  if (tokens.length === 0) return 0;
  let total = 0;
  for (const token of tokens) {
    let tokenBest = 0;
    for (const field of entry.fields) {
      const score = scoreTokenInField(token, field) * FIELD_WEIGHTS[field.kind];
      if (score > tokenBest) tokenBest = score;
    }
    if (tokenBest === 0) return 0;
    total += tokenBest;
  }
  // The words typed in the product's own order — a strong hint it's the one.
  const product = entry.fields[0].text;
  if (tokens.length > 1 && product.includes(normalizedQuery)) total += 2;
  if (product === normalizedQuery) total += 2;
  return total;
}

/**
 * Ranks `items` (each carrying a `searchEntry`) for the query. Weak matches
 * are dropped once a clearly better one exists, so a single typo-tolerant
 * hit on "gel" doesn't bury the exact product under twenty lookalikes.
 */
export function rankSearchEntries(items, query, { minRelativeScore = 0.5 } = {}) {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return [];
  const normalizedQuery = tokens.join(" ");
  const scored = [];
  for (const item of items) {
    const score = scoreSearchEntry(item.searchEntry, tokens, normalizedQuery);
    if (score > 0) scored.push({ item, score });
  }
  if (scored.length === 0) return [];
  const best = Math.max(...scored.map((row) => row.score));
  return scored.filter((row) => row.score >= best * minRelativeScore);
}

// ---------------------------------------------------------------------------
// Barcodes
// ---------------------------------------------------------------------------

/** ProductEditor's generated fallback: "IN" + 10 hex. Never a supplier code. */
export function isInternalBarcode(code) {
  return /^IN[0-9A-F]{10}$/i.test(String(code ?? "").trim());
}

/** GS1 check digit for EAN-8 / UPC-A / EAN-13 / GTIN-14. */
export function isValidGtin(code) {
  const value = String(code ?? "").trim();
  if (!/^(\d{8}|\d{12,14})$/.test(value)) return false;
  const digits = value.split("").map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * The same product number read as UPC-A (12 digits), EAN-13 (a leading 0)
 * or GTIN-14 (another leading 0) — scanners and supplier exports disagree on
 * which, so a lookup tries every form. Non-numeric codes are looked up as is.
 */
export function barcodeLookupCandidates(code) {
  const value = String(code ?? "").trim();
  if (!value) return [];
  // EAN-8 is its own numbering space, not a zero-padded EAN-13.
  if (!/^\d+$/.test(value) || value.length < 11) return [value];
  const stripped = value.replace(/^0+/, "");
  const forms = new Set([value]);
  for (const length of [12, 13, 14]) {
    if (stripped.length <= length) forms.add(stripped.padStart(length, "0"));
  }
  return [...forms];
}

// Counter codes that must never become a product barcode: a booking/pickup
// ticket (R-/A-/F- + 10 hex, or 8 hex) — same shape as CounterSurface's
// looksLikeCode.
function looksLikeCounterCode(value) {
  return /^(?:[AFR]-?[0-9A-F]{10}|[0-9A-F]{8})$/i.test(value) && !/^\d{8}$/.test(value);
}

/**
 * Whether a scanned code may be linked to a variant from the till. Returns
 * a French refusal message, or null when it's acceptable.
 */
export function linkableBarcodeError(code) {
  const value = String(code ?? "").trim();
  if (value.length < 6 || value.length > 48) return "Ce code-barres n'a pas un format reconnu.";
  if (!/^[A-Za-z0-9._-]+$/.test(value)) return "Ce code-barres n'a pas un format reconnu.";
  if (isInternalBarcode(value)) return "C'est un code interne Meri Beauty — il appartient déjà à un produit.";
  if (looksLikeCounterCode(value)) return "C'est un code de réservation ou de commande, pas un code-barres produit.";
  // A mistyped EAN would be linked forever and never scan again — the check
  // digit catches a single wrong or swapped digit.
  if (/^\d+$/.test(value) && [8, 12, 13, 14].includes(value.length) && !isValidGtin(value)) {
    return "Ce code-barres est invalide (chiffre de contrôle incorrect). Rescannez-le.";
  }
  return null;
}

/**
 * A camera read that is certainly a product barcode (valid EAN-13/UPC-A/
 * GTIN-14), so the counter's omnibar can hand it to the till instead of
 * searching bookings with it. EAN-8 is left out on purpose: 8 digits is also
 * a valid 8-hex check-in code.
 */
export function looksLikeProductGtin(value) {
  const code = String(value ?? "").trim();
  return /^\d{12,14}$/.test(code) && isValidGtin(code);
}
