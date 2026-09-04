import { redirect } from "next/navigation";
import { getCart } from "@/actions/boutique/cart";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CheckoutPageClient } from "@/components/boutique/CheckoutPageClient";
import { getTranslations } from "next-intl/server";
import { isBoutiqueShippingEnabled } from "@/lib/commerce-availability";

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
      // isCompany/vatNumber/vatValidatedAt feed CheckoutPageClient's live VAT
      // preview (see resolveGoodsVatPolicy) — display only, the real
      // computation still happens server-side in createOrderFromCart.
      //
      // The address fields let the client tell "already on file" apart from
      // "never entered" for a signed-in customer — without them here, the
      // page could not require the billing address from an account that
      // still lacks one, and createOrderFromCart's server-side ADDRESS_REQUIRED
      // check would be the only thing standing between checkout and a Stripe
      // charge for an order that can never be invoiced.
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        isCompany: true,
        vatNumber: true,
        vatValidatedAt: true,
        addressLine1: true,
        addressLine2: true,
        addressCity: true,
        addressPostalCode: true,
        addressCountry: true,
      },
    });
    if (user) customerSession = user;
  }

  return (
    <CheckoutPageClient
      cart={cart}
      customerSession={customerSession}
      shippingEnabled={isBoutiqueShippingEnabled()}
    />
  );
}
