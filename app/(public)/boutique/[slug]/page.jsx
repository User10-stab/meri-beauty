import { notFound } from "next/navigation";
import { getStorefrontProductBySlug } from "@/actions/boutique/storefront";
import { ProductDetailClient } from "@/components/boutique/ProductDetailClient";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const result = await getStorefrontProductBySlug(slug);
  if (!result.success) return { title: "Produit introuvable – Meri Beauty" };
  return {
    title: `${result.data.name} – Meri Beauty`,
    description: result.data.description ?? undefined,
  };
}

export default async function ProductPage({ params, searchParams }) {
  const { slug } = await params;
  const { variant } = await searchParams;
  const result = await getStorefrontProductBySlug(slug);

  if (!result.success) notFound();

  return <ProductDetailClient product={result.data} initialVariantId={variant} />;
}
