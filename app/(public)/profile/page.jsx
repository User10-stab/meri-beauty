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
  const isCompany = settingsResult.success ? settingsResult.data.isCompany : false;
  const initialAddress = settingsResult.success
    ? {
        addressLine1: settingsResult.data.addressLine1,
        addressLine2: settingsResult.data.addressLine2,
        addressCity: settingsResult.data.addressCity,
        addressPostalCode: settingsResult.data.addressPostalCode,
        addressCountry: settingsResult.data.addressCountry,
      }
    : null;
  const initialBillingProfile = settingsResult.success ? settingsResult.data.billingProfile : null;

  return (
    <ProfilePageClient
      user={{ ...profileResult.data, isCompany }}
      initialNewsletterSubscribed={newsletterSubscribed}
      initialVatNumber={vatNumber}
      initialAddress={initialAddress}
      initialBillingProfile={initialBillingProfile}
    />
  );
}
