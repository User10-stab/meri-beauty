import { requireTillCashOperator } from "@/lib/route-protection";
import { getCashBookLedger, getCashReport } from "@/actions/dashboard/cash-book";
import { getCurrentCashSession, getSuggestedOpeningFloat } from "@/actions/dashboard/cash-sessions";
import { CaisseClient } from "@/components/dashboard/boutique/caisse/CaisseClient";

export const metadata = { title: "Livre de caisse — Meri Beauty" };

export const dynamic = "force-dynamic";

export default async function CaissePage({ searchParams }) {
  await requireTillCashOperator();
  const params = await searchParams;
  const filterInput = {
    from: typeof params?.from === "string" ? params.from : undefined,
    to: typeof params?.to === "string" ? params.to : undefined,
  };

  // The "Rapport" (cash-only revenue by category/VAT + reconciliation) is
  // fetched here alongside the journal and rendered inline by CaisseClient —
  // it used to live on its own route, but that meant a click away from the
  // book it describes for no real benefit. No per-row "send ticket by email"
  // action here — that stays an Operations-only capability
  // (TransactionDetailDrawer). No salon-branding fetch either: printing goes
  // through the generated PDF route (/api/caisse/pdf), which draws its own
  // fixed letterhead the same way the Livre de recettes' PDF does, not a
  // dashboard-screen print.
  const [ledger, report, currentSession, suggestedFloat] = await Promise.all([
    getCashBookLedger(filterInput),
    getCashReport(filterInput),
    getCurrentCashSession(),
    getSuggestedOpeningFloat(),
  ]);

  return (
    <CaisseClient
      ledger={ledger.success ? ledger.data : null}
      ledgerError={ledger.success ? null : ledger.message}
      report={report.success ? report.data : null}
      reportError={report.success ? null : report.message}
      currentSession={currentSession.success ? currentSession.data : null}
      suggestedOpeningFloat={suggestedFloat.success ? suggestedFloat.data : null}
    />
  );
}
