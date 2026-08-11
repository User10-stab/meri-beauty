"use client";

import Link from "next/link";
import { useSidebarContext } from "../sidebar/sidebar-context";
import { MenuIcon } from "./icons";
import { ThemeToggleSwitch } from "./theme-toggle";
import { UserInfo } from "./user-info";
import NotificationBell from "@/components/dashboard/notifications/NotificationBell";
import { HeaderSearch } from "./header-search";

export function Header({ user }) {
  const { toggleSidebar, isMobile } = useSidebarContext();

  return (
    <header className="border-stroke shadow-1 dark:border-stroke-dark dark:bg-gray-dark sticky top-0 z-20 flex items-center justify-between border-b bg-white px-4 py-5 md:px-5 2xl:px-10">
      <button
        onClick={toggleSidebar}
        className="dark:border-stroke-dark rounded-lg border px-1.5 py-1 lg:hidden dark:bg-[#020D1A] hover:dark:bg-[#FFFFFF1A]"
      >
        <MenuIcon />
        <span className="sr-only">Toggle Sidebar</span>
      </button>

      {isMobile && (
        <Link href="/dashboard" className="2xsm:ml-4 ml-2 max-[430px]:hidden">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white">
            MB
          </span>
        </Link>
      )}

      <div className="max-xl:hidden">
        <h1 className="text-heading-5 text-dark mb-0.5 font-bold dark:text-white">
          Dashboard
        </h1>
        <p className="font-medium">Meri Beauty Salon Management</p>
      </div>

      <div className="2xsm:gap-4 flex flex-1 items-center justify-end gap-2">
        <HeaderSearch />

        <ThemeToggleSwitch />

        <div className="shrink-0">
          <NotificationBell user={user} />
        </div>

        <div className="shrink-0">
          <UserInfo user={user} />
        </div>
      </div>
    </header>
  );
}
