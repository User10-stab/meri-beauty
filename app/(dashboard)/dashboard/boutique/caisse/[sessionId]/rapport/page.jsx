import { notFound } from "next/navigation";
import { requireDashboardPermission } from "@/lib/route-protection";
import { STAFF_PERMISSIONS } from "@/lib/authorization";
import { getDayReport } from "@/actions/dashboard/cash-book";
import { DayReportClient } from "@/components/dashboard/boutique/DayReportClient";

export const metadata = { title: "Rapport de caisse — Meri Beauty" };

export const dynamic = "force-dynamic";

export default async function DayReportPage({ params }) {
  await requireDashboardPermission(STAFF_PERMISSIONS.CASH_REGISTER);

  const { sessionId } = await params;
  const report = await getDayReport(sessionId);
  if (!report.success) notFound();

  return <DayReportClient report={report.data} sessionId={sessionId} />;
}
