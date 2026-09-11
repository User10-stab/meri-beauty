import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS, isTillCashOperator, isAdminRole } from "@/lib/authorization";
import { getCashBookLedger } from "@/actions/dashboard/cash-book";
import { getCurrentCashSession, getSuggestedOpeningFloat } from "@/actions/dashboard/cash-sessions";
import { refreshSalonBranding } from "@/lib/email-templates";
import { getAbsoluteUrl } from "@/lib/site-url";
import { CaisseClient } from "@/components/dashboard/boutique/caisse/CaisseClient";

export const metadata = { title: "Livre de caisse — Meri Beauty" };

export const dynamic = "force-dynamic";

export default async function CaissePage({ searchParams }) {
  const { user } = await requireDashboardPermission(STAFF_PERMISSIONS.CASH_REGISTER);
  const params = await searchParams;
  const filterInput = {
    from: typeof params?.from === "string" ? params.from : undefined,
    to: typeof params?.to === "string" ? params.to : undefined,
  };

  // The detailed "Rapport" (revenue by method/category/VAT) now lives on its
  // own route (CaisseRapportPage) with its own data fetch — this page only
  // needs the journal-facing data. No per-row "send ticket by email" action
  // here — that stays an Operations-only capability (TransactionDetailDrawer).
  const [ledger, currentSession, suggestedFloat, branding] = await Promise.all([
    getCashBookLedger(filterInput),
    getCurrentCashSession(),
    getSuggestedOpeningFloat(),
    refreshSalonBranding(),
  ]);

  const logoUrl = branding?.logo
    ? branding.logo.startsWith("http")
      ? branding.logo
      : getAbsoluteUrl(branding.logo)
    : null;

  return (
    <CaisseClient
      ledger={ledger.success ? ledger.data : null}
      ledgerError={ledger.success ? null : ledger.message}
      currentSession={currentSession.success ? currentSession.data : null}
      suggestedOpeningFloat={suggestedFloat.success ? suggestedFloat.data : null}
      canVerify={isTillCashOperator(user) || isAdminRole(user.role)}
      salonName={branding?.name ?? "Meri Beauty"}
      logoUrl={logoUrl}
    />
  );
}
