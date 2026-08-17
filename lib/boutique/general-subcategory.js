import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/validations/boutique";

async function uniqueSubcategorySlug(base, categoryId) {
  let slug = base;
  let n = 1;
  while (true) {
    const clash = await prisma.productSubcategory.findFirst({ where: { slug, categoryId }, select: { id: true } });
    if (!clash) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

/**
 * Resolves the catch-all "Général" subcategory under a category, creating it
 * on first use. Every product still belongs to a real Marque/Catégorie
 * (client decision, 17 Aug 2026 — Marie needs every product organized under
 * a brand and category, not left classified as "Non classé"), but picking a
 * specific Sous-catégorie stays optional — this is what a product falls
 * back to when staff leave it blank. Shared by the product editor and the
 * Wix importer, which already used this exact fallback for unmapped tags.
 */
export async function getOrCreateGeneralSubcategory(categoryId) {
  let sub = await prisma.productSubcategory.findFirst({ where: { categoryId, name: "Général" } });
  if (!sub) {
    sub = await prisma.productSubcategory.create({
      data: { name: "Général", categoryId, slug: await uniqueSubcategorySlug("general", categoryId) },
    });
  }
  return sub;
}
