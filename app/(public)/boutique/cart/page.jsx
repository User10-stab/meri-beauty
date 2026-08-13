import { getCart } from "@/actions/boutique/cart";
import { CartPageClient } from "@/components/boutique/CartPageClient";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("boutique.metadata");
  return { title: t("cartPage") };
}

export default async function CartPage() {
  const result = await getCart();
  return <CartPageClient initialCart={result.data ?? { items: [], subtotal: 0, itemCount: 0 }} />;
}
