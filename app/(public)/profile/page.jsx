import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getMyProfile } from "@/actions/customer/profile";
import { getMySettings } from "@/actions/customer/settings";
import { ProfilePageClient } from "@/components/website/ProfilePageClient";

export const metadata = { title: "Mon profil — Meri Beauty" };

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const profileResult = await getMyProfile();
  if (!profileResult.success) {
    redirect("/login");
  }

  const settingsResult = await getMySettings();
  const newsletterSubscribed = settingsResult.success ? settingsResult.data.newsletterSubscribed : false;
  const vatNumber = settingsResult.success ? settingsResult.data.vatNumber : null;

  return (
    <ProfilePageClient
      user={profileResult.data}
      initialNewsletterSubscribed={newsletterSubscribed}
      initialVatNumber={vatNumber}
    />
  );
}
