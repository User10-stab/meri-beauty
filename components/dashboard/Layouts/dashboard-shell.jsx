"use client";

import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { SidebarProvider } from "./sidebar/sidebar-context";
import { OnboardingGuard } from "@/components/dashboard/onboarding/OnboardingGuard";
// import { StripeReminderBanner } from "@/components/dashboard/onboarding/StripeReminderBanner";

export function DashboardShell({ user, isSalonAccount = false, dashboardPermissions = [], pickupsToVerifyCount = 0, unreadNotificationsCount = 0, children }) {
  return (
    <SidebarProvider>
      <OnboardingGuard userRole={user?.role} />
      {/* {user?.role === "STAFF" && <StripeReminderBanner />} */}
      {/* Fixed app frame: the window never scrolls. The sidebar (sticky
          h-screen on desktop, fixed drawer on mobile) and the header stay
          put; only <main> scrolls. Content can never slide underneath them
          because they remain in normal flow with their own backgrounds. */}
      <div className="dashboard-scope flex h-screen overflow-hidden">
        <Sidebar
          userRole={user?.role}
          isSalonAccount={isSalonAccount}
          dashboardPermissions={dashboardPermissions}
          pickupsToVerifyCount={pickupsToVerifyCount}
          unreadNotificationsCount={unreadNotificationsCount}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-gray-2 dark:bg-[#020d1a]">
          <Header user={user} />

          <main className="mx-auto min-h-0 w-full min-w-0 max-w-(--breakpoint-2xl) flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-4 md:p-6 2xl:p-10">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
