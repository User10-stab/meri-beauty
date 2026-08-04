"use client";

import { DataTable } from "../Tables/DataTable";
import { WaitingListRow } from "./WaitingListRow";

const COLUMNS = [
  { key: "activity", label: "Activité & Séance" },
  { key: "customer", label: "Client" },
  { key: "position", label: "Position" },
  { key: "seatsRequested", label: "Places demandées" },
  { key: "status", label: "Statut" },
];

export function WaitingListPageClient({ initialEntries = [] }) {
  return (
    <DataTable
      data={initialEntries}
      columns={COLUMNS}
      renderRow={WaitingListRow}
      searchPlaceholder="Rechercher dans la liste d'attente..."
      searchFilter={(row, query) =>
        row.session?.workshop?.title?.toLowerCase().includes(query) ||
        row.customer?.fullName?.toLowerCase().includes(query) ||
        row.customer?.email?.toLowerCase().includes(query)
      }
    />
  );
}
