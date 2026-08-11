import { auth } from "@/auth";
import { requireDashboard } from "@/lib/route-protection";
import NotificationsPageClient from "@/components/dashboard/notifications/NotificationsPageClient";

export const metadata = {
  title: "Notifications — Dashboard",
  description: "Consultez toutes vos notifications du tableau de bord.",
};

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  await requireDashboard();
  const session = await auth();

  return (
    <NotificationsPageClient
      userId={session?.user?.id}
    />
  );
}
