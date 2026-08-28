import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { getMyReservations } from "@/actions/reservation/get-my-reservations";
import MyReservationsClient from "@/components/customer/MyReservationsClient";

import { getTranslations } from "next-intl/server";

export const metadata = {
  title: "Mes réservations – Meri Beauty",
  description: "Consultez et gérez vos rendez-vous Meri Beauty.",
};

/**
 * /mes-reservations
 *
 * Customer-facing reservations page.
 *
 * - Only accessible to authenticated CUSTOMER accounts.
 *   Staff and admin are redirected to the dashboard.
 *   Unauthenticated users are redirected to /login.
 *
 * - Fetches all reservations server-side and passes them to the
 *   client component. Never modifies the database.
 *
 * - The client component handles the "Finaliser le paiement" button
 *   which calls resumeReservationPayment() and redirects to Stripe.
 */
export default async function MesReservationsPage() {
  const t = await getTranslations();
  const session = await auth();

  // Not logged in → go to login, come back after
  if (!session?.user) {
    redirect("/login?callbackUrl=/mes-reservations");
  }

  // Staff/admin have their own dashboard
  if (session.user.role !== "CUSTOMER") {
    redirect("/dashboard");
  }

  const result = await getMyReservations();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page header */}
      <div className="bg-white border-b border-gray-100">
        <div className="mx-auto max-w-5xl px-3 sm:px-4 md:px-6 py-6 sm:py-8">
          <div className="flex items-center justify-between gap-3 sm:gap-4 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold text-[#2F3A2E]">{t("myAccount.myReservations")}</h1>
              <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm text-gray-500">
                {t("myAccount.findAllReservations")}
              </p>
            </div>
            <Link
              href="/reservation"
              className="inline-flex items-center gap-2 rounded-lg bg-[#2F3A2E] px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-[#3d4e3b] transition-colors whitespace-nowrap"
            >
              <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {t("myAccount.newReservation")}
            </Link>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-5xl px-3 sm:px-4 md:px-6 py-6 sm:py-8">
        {!result.success ? (
          // Server error — show a non-crashing fallback
          <div className="rounded-2xl border border-red-100 bg-red-50 px-4 sm:px-6 py-6 sm:py-8 text-center">
            <p className="text-xs sm:text-sm font-semibold text-red-700">
              {t("myAccount.failedLoadReservations")}
            </p>
            <p className="mt-1 text-xs sm:text-sm text-red-600">
              {result.message ?? t("myAccount.refreshPageOrRetry")}
            </p>
          </div>
        ) : (
          <MyReservationsClient reservations={result.data ?? []} />
        )}
      </div>
    </div>
  );
}
