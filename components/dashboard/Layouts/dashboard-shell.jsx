"use client";

import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { SidebarProvider } from "./sidebar/sidebar-context";
import { OnboardingGuard } from "@/components/dashboard/onboarding/OnboardingGuard";

export function DashboardShell({ user, children }) {
  return (
    <SidebarProvider>
      <OnboardingGuard userRole={user?.role} />
      <div className="dashboard-scope flex min-h-screen">
        <Sidebar userRole={user?.role} />

        <div className="w-full bg-gray-2 dark:bg-[#020d1a]">
          <Header user={user} />

          <main className="mx-auto w-full max-w-(--breakpoint-2xl) overflow-visible p-4 md:p-6 2xl:p-10">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
