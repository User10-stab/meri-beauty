/**
 * Parsing for a Wix "Export Products"/"Export Inventory" CSV pair. Pure —
 * no DB, no "use server" — so the mapping logic can be unit-tested directly
 * and reused by both the preview and the actual import action.
 *
 * Wix's products export is a flat PRODUCT+MEDIA row format: one PRODUCT row
 * per product carrying its fields, followed by zero or more MEDIA rows
 * sharing the same `handle`, one per image. Category info is a single flat
 * `categorySlugs` tag list (no brand/category distinction, no 2-level
 * category→subcategory split like this schema uses) — reconciling that is
 * what the mapping step in the importer UI is for; this module never
 * guesses a slug's meaning on its own, only reports data-derived hints.
 */

const WIX_MEDIA_BASE = "https://static.wixstatic.com/media/";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const raw = String(text);
  const clean = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // strip UTF-8 BOM

  for (let i = 0; i < clean.length; i += 1) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // skip — \r\n line endings
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function rowsToObjects(rows) {
  const [header, ...rest] = rows;
  if (!header) return [];
  return rest.filter((r) => r.some((cell) => cell !== "")).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** `\b\w` regex boundaries are ASCII-only in JS and mis-capitalize accented
 * words (e.g. "ésotérique" → "éSotéRique") — split on spaces instead, since
 * String.prototype.toUpperCase() itself is Unicode-correct. */
export function titleCase(slug) {
  return String(slug)
    .replace(/-/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/** @param {string} csvText the products export (PRODUCT + MEDIA rows) */
export function parseWixProductsCsv(csvText) {
  const objects = rowsToObjects(parseCsv(csvText));
  const byHandle = new Map();

  for (const row of objects) {
    if (!row.handle) continue;
    if (!byHandle.has(row.handle)) byHandle.set(row.handle, { product: null, images: [] });
    const entry = byHandle.get(row.handle);
    if (row.fieldType === "PRODUCT") {
      entry.product = row;
    } else if (row.fieldType === "MEDIA" && row.media) {
      entry.images.push(WIX_MEDIA_BASE + row.media.trim());
    }
  }

  const products = [];
  for (const { product, images } of byHandle.values()) {
    if (!product || !product.name) continue;

    const slugs = (product.categorySlugs || "").split(";").map((s) => s.trim()).filter(Boolean);
    const primarySlug = product.primaryCategorySlug?.trim() || null;
    const price = Number(product.price) || 0;
    const costPrice = Number(product.cost) || 0;
    const strikethrough = Number(product.strikethroughPrice) || 0;

    products.push({
      handle: product.handle,
      name: product.name.trim(),
      description: stripHtml(product.plainDescription),
      price,
      costPrice,
      comparePrice: strikethrough > 0 ? strikethrough : null,
      slugs,
      primarySlug,
      images,
      wixInStock: (product.inventory || "").toUpperCase() === "IN_STOCK",
    });
  }
  return products;
}

/** @param {string} csvText the inventory export — real counts, keyed by productHandle. */
export function parseWixInventoryCsv(csvText) {
  const objects = rowsToObjects(parseCsv(csvText));
  const byHandle = new Map();
  for (const row of objects) {
    if (!row.productHandle) continue;
    const raw = (row.inventoryCurrent || "").trim();
    const n = Number(raw);
    if (raw !== "" && Number.isFinite(n)) byHandle.set(row.productHandle, n);
  }
  return byHandle;
}

/**
 * Every distinct category slug across the parsed products, with usage
 * counts and a data-derived suggestion for brand vs. subcategory (products
 * whose name is literally prefixed by the slug, e.g. "AIB - Milky Nude"
 * under slug "aib", read as a brand signal). A suggestion only — the
 * importer UI always shows it as an editable default, never applies it.
 */
export function summarizeSlugs(products) {
  const bySlug = new Map();
  for (const p of products) {
    for (const slug of p.slugs) {
      if (!bySlug.has(slug)) bySlug.set(slug, []);
      bySlug.get(slug).push(p);
    }
  }

  return [...bySlug.entries()]
    .map(([slug, prods]) => {
      const needle = slug.toLowerCase().replace(/-/g, " ");
      const prefixMatches = prods.filter((p) => {
        const n = p.name.toLowerCase();
        return n.startsWith(needle) || n.startsWith(slug.toLowerCase());
      }).length;
      const ratio = prefixMatches / prods.length;
      return {
        slug,
        readable: titleCase(slug),
        count: prods.length,
        primaryCount: prods.filter((p) => p.primarySlug === slug).length,
        suggestedKind: ratio >= 0.5 ? "brand" : "subcategory",
        suggestionReason: ratio >= 0.5 ? `${prefixMatches}/${prods.length} produits commencent par « ${titleCase(slug)} »` : null,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * Resolves one product's brand/category names from the admin-confirmed
 * slug→kind mapping. The product's primary slug wins when it's classified;
 * otherwise falls back to the first classified slug in its tag list.
 * Neither is guaranteed to resolve — the caller falls back to a "Non classé"
 * placeholder brand/category when one is missing, since the catalogue tree
 * (Brand → Category → Subcategory → Product) requires both.
 */
export function resolveProductClassification(product, slugMapping) {
  const kindOf = (slug) => slugMapping[slug] ?? "ignore";
  const ordered = product.primarySlug
    ? [product.primarySlug, ...product.slugs.filter((s) => s !== product.primarySlug)]
    : product.slugs;

  const brandSlug = ordered.find((s) => kindOf(s) === "brand");
  const categorySlug = ordered.find((s) => kindOf(s) === "subcategory");

  return {
    brandName: brandSlug ? titleCase(brandSlug) : null,
    categoryName: categorySlug ? titleCase(categorySlug) : null,
  };
}
