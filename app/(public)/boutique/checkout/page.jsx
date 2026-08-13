import { redirect } from "next/navigation";
import { getCart } from "@/actions/boutique/cart";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CheckoutPageClient } from "@/components/boutique/CheckoutPageClient";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("boutique.metadata");
  return { title: t("checkoutPage") };
}

export default async function CheckoutPage() {
  const [cartResult, session] = await Promise.all([getCart(), auth()]);
  const cart = cartResult.data;

  if (!cart || cart.items.length === 0) {
    redirect("/boutique/cart");
  }

  // The session's JWT only ever carries id/role/email/isActive (see
  // auth.js's jwt/session callbacks) — fullName and phone are never in
  // there, so they must come from the DB, not session.user.
  let customerSession = null;
  if (session?.user?.role === "CUSTOMER") {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, fullName: true, email: true, phone: true },
    });
    if (user) customerSession = user;
  }

  return <CheckoutPageClient cart={cart} customerSession={customerSession} />;
}
