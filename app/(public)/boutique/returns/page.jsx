import { ReturnRequestClient } from "@/components/boutique/ReturnRequestClient";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("boutique.metadata");
  return { title: t("returnsPage") };
}

export default function ReturnsPage() {
  return <ReturnRequestClient />;
}
