import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getMyProfile } from "@/actions/customer/profile";
import { ProfilePageClient } from "@/components/website/ProfilePageClient";

export const metadata = { title: "Mon profil — Meri Beauty" };

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const result = await getMyProfile();
  if (!result.success) {
    redirect("/login");
  }

  return <ProfilePageClient user={result.data} />;
}
