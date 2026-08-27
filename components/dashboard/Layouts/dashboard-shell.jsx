"use client";

import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { SidebarProvider } from "./sidebar/sidebar-context";
import { OnboardingGuard } from "@/components/dashboard/onboarding/OnboardingGuard";
import { StripeReminderBanner } from "@/components/dashboard/onboarding/StripeReminderBanner";

export function DashboardShell({ user, dashboardPermissions = [], children }) {
  return (
    <SidebarProvider>
      <OnboardingGuard userRole={user?.role} />
      {user?.role === "STAFF" && <StripeReminderBanner />}
      <div className="dashboard-scope flex min-h-screen overflow-x-hidden">
        <Sidebar userRole={user?.role} dashboardPermissions={dashboardPermissions} />

        <div className="min-w-0 flex-1 bg-gray-2 dark:bg-[#020d1a]">
          <Header user={user} />

          <main className="mx-auto min-w-0 max-w-(--breakpoint-2xl) overflow-x-hidden p-3 sm:p-4 md:p-6 2xl:p-10">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
