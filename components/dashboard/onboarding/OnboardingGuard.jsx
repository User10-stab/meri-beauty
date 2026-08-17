"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { checkOnboardingStatus } from "@/actions/staff/check-onboarding-status";
import { OnboardingModal } from "./OnboardingModal";

export function OnboardingGuard({ userRole }) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState(null);
  const [stripeDismissed, setStripeDismissed] = useState(false);

  useEffect(() => {
    if (userRole !== "STAFF") return;
    checkOnboardingStatus().then(setStatus);
  }, [pathname, userRole]);

  useEffect(() => {
    if (userRole !== "STAFF") return;
    if (!status || !status.isStaff) return;

    const isAccountRoute = pathname === "/dashboard/account-settings" || pathname === "/dashboard";

    if (!status.setupCompleted && !isAccountRoute) {
      router.replace("/dashboard/account-settings");
    }

    // Stripe deliberately does NOT redirect. It used to send staff back to
    // /dashboard/payments from every other page, which made the dashboard
    // unusable for anyone without a connected account: the redirect fired on
    // each navigation, and the only way out was to finish a flow that can
    // fail for reasons staff cannot fix themselves (the platform not being
    // signed up for Connect, missing STRIPE_CONNECT_CLIENT_ID). A staff
    // member still needs to see today's appointments while that is sorted
    // out, so this is a reminder now, not a gate.
  }, [pathname, router, status, userRole]);

  if (userRole !== "STAFF") return null;

  if (!status || !status.isStaff) return null;

  if (
    pathname === "/dashboard/account-settings" ||
    pathname.startsWith("/dashboard/services") ||
    pathname.startsWith("/dashboard/payments")
  ) {
    return null;
  }

  if (!status.setupCompleted) {
    return <OnboardingModal step="account" steps={status.steps} />;
  }

  if (!status.hasServices) {
    return <OnboardingModal step="services" />;
  }

  // Dismissible: Stripe onboarding can be blocked by platform-level setup a
  // staff member has no control over, so they must be able to get on with
  // their day. It reappears on the next visit until the account is connected.
  if (status.stripeRequired && !stripeDismissed) {
    return <OnboardingModal step="stripe" onDismiss={() => setStripeDismissed(true)} />;
  }

  return null;
}
