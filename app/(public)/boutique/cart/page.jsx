import { getCart } from "@/actions/boutique/cart";
import { auth } from "@/auth";
import { CartPageClient } from "@/components/boutique/CartPageClient";
import { prisma } from "@/lib/prisma";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("boutique.metadata");
  return { title: t("cartPage") };
}

export default async function CartPage() {
  const [result, session] = await Promise.all([getCart(), auth()]);
  let customerSession = null;

  if (session?.user?.role === "CUSTOMER") {
    customerSession = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isCompany: true, vatNumber: true, vatValidatedAt: true },
    });
  }

  return (
    <CartPageClient
      initialCart={result.data ?? { items: [], subtotal: 0, itemCount: 0 }}
      customerSession={customerSession}
    />
  );
}
