import { notFound } from "next/navigation";
import { getStorefrontProductBySlug } from "@/actions/boutique/storefront";
import { ProductDetailClient } from "@/components/boutique/ProductDetailClient";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://meribeautystudio.com";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const result = await getStorefrontProductBySlug(slug);
  if (!result.success) return { title: "Produit introuvable – Meri Beauty" };
  return {
    title: `${result.data.name} – Meri Beauty`,
    description: result.data.description ?? undefined,
    // Canonical to the slug-only URL so all ?variant= selections consolidate
    // to one product URL instead of fragmenting link equity.
    alternates: { canonical: `/boutique/${slug}` },
  };
}

/** Product JSON-LD — lets Google show price/availability/brand as rich
 *  results for boutique product pages. All fields are read server-side
 *  from the DB via getStorefrontProductBySlug; nothing is client-trusted. */
function buildProductSchema(product) {
  if (!product) return null;

  // Cheapest in-stock variant drives the primary Offer; out-of-stock
  // variants are still listed so availability is accurate.
  const variants = product.variants ?? [];
  const inStock = variants.filter((v) => v.availableQuantity > 0);
  const primaryPool = inStock.length > 0 ? inStock : variants;
  const lowest = primaryPool.length > 0
    ? primaryPool.reduce((min, v) => (Number(v.price) < Number(min.price) ? v : min))
    : null;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    ...(product.description ? { description: product.description } : {}),
    ...(product.brand?.name ? { brand: { "@type": "Brand", name: product.brand.name } } : {}),
    ...(product.category?.name ? { category: product.category.name } : {}),
    ...(product.images?.length
      ? { image: product.images.map((img) => img.path) }
      : {}),
    sku: product.id,
    url: `${SITE_URL}/boutique/${product.slug}`,
    ...(lowest
      ? {
          offers: {
            "@type": "Offer",
            price: String(lowest.price),
            priceCurrency: "EUR",
            availability:
              lowest.availableQuantity > 0
                ? "https://schema.org/InStock"
                : "https://schema.org/OutOfStock",
            url: `${SITE_URL}/boutique/${product.slug}`,
            seller: { "@type": "Organization", name: "Merri Beauty" },
          },
        }
      : {}),
  };
}

export default async function ProductPage({ params, searchParams }) {
  const { slug } = await params;
  const { variant } = await searchParams;
  const result = await getStorefrontProductBySlug(slug);

  if (!result.success) notFound();

  const productSchema = buildProductSchema(result.data);

  return (
    <>
      {productSchema && (
        <script
          type="application/ld+json"
          // Escape "<" so a salon-editable field (name, description) can
          // never break out of the script tag or inject markup. Same guard
          // the HairSalon schema uses in (public)/layout.js.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(productSchema).replace(/</g, "\\u003c"),
          }}
        />
      )}
      <ProductDetailClient product={result.data} initialVariantId={variant} />
    </>
  );
}
