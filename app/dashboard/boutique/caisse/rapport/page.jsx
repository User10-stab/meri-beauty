import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS } from "@/lib/authorization";
import { getCashReport } from "@/actions/dashboard/cash-book";
import { refreshSalonBranding } from "@/lib/email-templates";
import { getAbsoluteUrl } from "@/lib/site-url";
import { CaisseRapportClient } from "@/components/dashboard/boutique/caisse/CaisseRapportClient";

export const metadata = { title: "Rapport — Livre de caisse — Meri Beauty" };

export const dynamic = "force-dynamic";

export default async function CaisseRapportPage({ searchParams }) {
  await requireDashboardPermission(STAFF_PERMISSIONS.CASH_REGISTER);
  const params = await searchParams;
  const filterInput = {
    from: typeof params?.from === "string" ? params.from : undefined,
    to: typeof params?.to === "string" ? params.to : undefined,
  };

  const [report, branding] = await Promise.all([getCashReport(filterInput), refreshSalonBranding()]);

  const logoUrl = branding?.logo
    ? branding.logo.startsWith("http")
      ? branding.logo
      : getAbsoluteUrl(branding.logo)
    : null;

  return (
    <CaisseRapportClient
      report={report.success ? report.data : null}
      filters={report.success ? report.data.filters : filterInput}
      salonName={branding?.name ?? "Meri Beauty"}
      logoUrl={logoUrl}
    />
  );
}
