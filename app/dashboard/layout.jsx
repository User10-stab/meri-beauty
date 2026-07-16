import { DashboardShell } from "@/components/dashboard/Layouts/dashboard-shell";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

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

  return <DashboardShell user={session.user}>{children}</DashboardShell>;
}
