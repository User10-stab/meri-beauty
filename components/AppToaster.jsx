"use client";

import { usePathname } from "next/navigation";
import { Toaster } from "sonner";

/**
 * sonner's <Toaster> portals to document.body, outside the .dashboard-scope
 * wrapper the dark-mode CSS variant is keyed on (css/style.css) — so its own
 * dark: classes can't be scoped that way. Gated on the route instead: dark
 * styling only applies for toasts fired from a dashboard page.
 */
export function AppToaster() {
  const pathname = usePathname();
  const isDashboard = pathname?.startsWith("/dashboard");

  return (
    <Toaster
      position="bottom-right"
      richColors
      closeButton
      duration={5000}
      toastOptions={{
        className: isDashboard ? "dark:bg-gray-dark dark:border-dark-3 dark:text-white" : "",
      }}
    />
  );
}
