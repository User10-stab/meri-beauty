"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { checkOnboardingStatus } from "@/actions/staff/check-onboarding-status";
import { OnboardingModal } from "./OnboardingModal";

export function OnboardingGuard({ userRole }) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState(null);

  if (userRole !== "STAFF") return null;

  useEffect(() => {
    checkOnboardingStatus().then(setStatus);
  }, [pathname]);

  useEffect(() => {
    if (!status || !status.isStaff) return;

    const isAccountRoute = pathname === "/dashboard/account-settings" || pathname === "/dashboard";
    const isPaymentsRoute = pathname.startsWith("/dashboard/payments");

    if (!status.setupCompleted && !isAccountRoute) {
      router.replace("/dashboard/account-settings");
    }

    if (status.setupCompleted && status.stripeRequired && !isPaymentsRoute) {
      router.replace("/dashboard/payments");
    }
  }, [pathname, router, status]);

  if (!status || !status.isStaff) return null;

  if (
    pathname === "/dashboard/account-settings" ||
    pathname.startsWith("/dashboard/services") ||
    pathname.startsWith("/dashboard/payments")
  ) {
    return null;
  }

  if (!status.setupCompleted) {
    return <OnboardingModal step="account" />;
  }

  if (!status.hasServices) {
    return <OnboardingModal step="services" />;
  }

  if (status.stripeRequired) {
    return <OnboardingModal step="stripe" />;
  }

  return null;
}
