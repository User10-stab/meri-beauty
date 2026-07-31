import { redirect } from "next/navigation";
import { getCart } from "@/actions/boutique/cart";
import { auth } from "@/auth";
import { CheckoutPageClient } from "@/components/boutique/CheckoutPageClient";

export const metadata = { title: "Commande – Meri Beauty" };

export default async function CheckoutPage() {
  const [cartResult, session] = await Promise.all([getCart(), auth()]);
  const cart = cartResult.data;

  if (!cart || cart.items.length === 0) {
    redirect("/boutique/cart");
  }

  const customerSession =
    session?.user?.role === "CUSTOMER"
      ? {
          id: session.user.id,
          fullName: session.user.fullName ?? session.user.name ?? "",
          email: session.user.email ?? "",
          phone: session.user.phone ?? "",
        }
      : null;

  return <CheckoutPageClient cart={cart} customerSession={customerSession} />;
}
