import { DashboardShell } from "@/components/dashboard/Layouts/dashboard-shell";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getDashboardPermissions } from "@/lib/authorization";
import { countPickupsToVerify } from "@/lib/orders/count-pickups-to-verify";
import { countUnreadUserNotifications } from "@/lib/notifications";

export const metadata = {
  title: {
    template: "%s | Meri Beauty",
    default: "Dashboard | Meri Beauty",
  },
  description: "Manage your premium salon bookings, clients, and team members.",
};

export default async function DashboardLayout({ children }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const dashboardPermissions = await getDashboardPermissions(session.user);

  // Counted here rather than fetched by the sidebar so the badge is right on
  // first paint and costs no extra round trip. It returns 0 without touching
  // the database for anyone who cannot see the orders screen, and a stale
  // count between navigations is harmless — the number only has to be enough
  // to make somebody open the list.
  const pickupsToVerifyCount = await countPickupsToVerify(session.user, dashboardPermissions);

  // Same reasoning as pickupsToVerifyCount above: computed here so the
  // sidebar badge is right on first paint. The bell icon keeps this in sync
  // afterwards over Pusher, so a stale count between navigations is harmless.
  const unreadNotificationsCount = await countUnreadUserNotifications(session.user.id);

  return (
    <DashboardShell
      user={session.user}
      dashboardPermissions={dashboardPermissions}
      pickupsToVerifyCount={pickupsToVerifyCount}
      unreadNotificationsCount={unreadNotificationsCount}
    >
      {children}
    </DashboardShell>
  );
}
