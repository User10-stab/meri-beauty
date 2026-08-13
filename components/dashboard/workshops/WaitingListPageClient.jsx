"use client";

import { DataTable } from "../Tables/DataTable";
import { WaitingListRow } from "./WaitingListRow";
import { useTranslations } from "next-intl";

export function WaitingListPageClient({ initialEntries = [] }) {
  const t = useTranslations("dashboardWorkshops.waitingList");
  const columns = [
    { key: "activity", label: t("columns.activity") },
    { key: "customer", label: t("columns.customer") },
    { key: "position", label: t("columns.position") },
    { key: "seatsRequested", label: t("columns.seatsRequested") },
    { key: "status", label: t("columns.status") },
  ];

  return (
    <DataTable
      data={initialEntries}
      columns={columns}
      renderRow={WaitingListRow}
      searchPlaceholder={t("searchPlaceholder")}
      searchFilter={(row, query) =>
        row.session?.workshop?.title?.toLowerCase().includes(query) ||
        row.customer?.fullName?.toLowerCase().includes(query) ||
        row.customer?.email?.toLowerCase().includes(query)
      }
    />
  );
}
