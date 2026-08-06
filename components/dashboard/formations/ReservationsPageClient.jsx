"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DataTable } from "../Tables/DataTable";
import { ReservationRow } from "./ReservationRow";
import { cancelFormationReservation } from "@/actions/formations/manage-reservation";
import { useConfirm } from "@/components/ConfirmProvider";
import { isAdminRole } from "@/lib/authorization";

const COLUMNS = [
  { key: "formation", label: "Formation & Séance" },
  { key: "customer", label: "Client" },
  { key: "seatsCount", label: "Places" },
  { key: "status", label: "Statut" },
  { key: "payment", label: "Paiement" },
];

export function ReservationsPageClient({ initialReservations = [], userRole }) {
  const router = useRouter();
  const confirm = useConfirm();
  const isAdmin = isAdminRole(userRole);
  const [, startCancel] = useTransition();

  async function handleCancel(reservation) {
    if (
      !(await confirm(
        `Annuler la réservation de « ${reservation.customer?.fullName} » pour « ${reservation.session?.formation?.title} » ? L'acompte versé ne sera pas remboursé.`,
        { danger: true }
      ))
    )
      return;

    startCancel(async () => {
      const result = await cancelFormationReservation(reservation.id);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="space-y-4">
      <DataTable
        data={initialReservations}
        columns={COLUMNS}
        renderRow={ReservationRow}
        onDelete={isAdmin ? handleCancel : undefined}
        searchPlaceholder="Rechercher une réservation..."
        searchFilter={(row, query) =>
          row.session?.formation?.title?.toLowerCase().includes(query) ||
          row.customer?.fullName?.toLowerCase().includes(query) ||
          row.customer?.email?.toLowerCase().includes(query)
        }
      />
    </div>
  );
}
