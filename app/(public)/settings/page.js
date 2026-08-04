import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getMySettings } from "@/actions/customer/settings";
import { SettingsPageClient } from "@/components/website/SettingsPageClient";

export const metadata = { title: "Paramètres — Meri Beauty" };

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const result = await getMySettings();
  if (!result.success) {
    redirect("/login");
  }

  return <SettingsPageClient initialNewsletterSubscribed={result.data.newsletterSubscribed} />;
}
