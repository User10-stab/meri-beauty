import { getCart } from "@/actions/boutique/cart";
import { CartPageClient } from "@/components/boutique/CartPageClient";

export const metadata = { title: "Mon panier – Meri Beauty" };

export default async function CartPage() {
  const result = await getCart();
  return <CartPageClient initialCart={result.data ?? { items: [], subtotal: 0, itemCount: 0 }} />;
}
