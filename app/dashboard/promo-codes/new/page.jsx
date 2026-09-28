import { requireAdmin } from "@/lib/route-protection";
import { PromoCodeEditor } from "@/components/dashboard/promo-codes/PromoCodeEditor";

export const metadata = {
  title: "Nouveau code promo — Dashboard",
};

export const dynamic = "force-dynamic";

export default async function NewPromoCodePage() {
  await requireAdmin();
  return <PromoCodeEditor promoCode={null} />;
}
