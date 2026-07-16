"use client";

import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { SidebarProvider } from "./sidebar/sidebar-context";

export function DashboardShell({ user, children }) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen">
        <Sidebar />

        <div className="w-full bg-gray-2 dark:bg-[#020d1a]">
          <Header user={user} />

          <main className="isolate mx-auto w-full max-w-(--breakpoint-2xl) overflow-hidden p-4 md:p-6 2xl:p-10">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
