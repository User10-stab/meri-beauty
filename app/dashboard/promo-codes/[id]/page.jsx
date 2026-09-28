import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/route-protection";
import { getPromoCode } from "@/actions/promo-codes";
import { PromoCodeEditor } from "@/components/dashboard/promo-codes/PromoCodeEditor";

export const metadata = {
  title: "Code promo — Dashboard",
};

export const dynamic = "force-dynamic";

export default async function EditPromoCodePage({ params }) {
  await requireAdmin();
  const { id } = await params;

  const result = await getPromoCode(id);
  if (!result.success) notFound();

  return <PromoCodeEditor promoCode={result.data} />;
}
