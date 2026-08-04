"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DataTable } from "../Tables/DataTable";
import { ReservationRow } from "./ReservationRow";
import { ChangeSessionModal } from "./ChangeSessionModal";
import { cancelWorkshopReservation } from "@/actions/workshops/manage-reservation";
import { useConfirm } from "@/components/ConfirmProvider";
import { isAdminRole } from "@/lib/authorization";

const COLUMNS = [
  { key: "activity", label: "Activité & Séance" },
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
  const [changeModalReservation, setChangeModalReservation] = useState(null);

  async function handleCancel(reservation) {
    if (
      !(await confirm(
        `Annuler la réservation de « ${reservation.customer?.fullName} » pour « ${reservation.session?.workshop?.title} » ? L'acompte versé ne sera pas remboursé.`,
        { danger: true }
      ))
    )
      return;

    startCancel(async () => {
      const result = await cancelWorkshopReservation(reservation.id);
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
        onEdit={isAdmin ? (row) => setChangeModalReservation(row) : undefined}
        onDelete={isAdmin ? handleCancel : undefined}
        searchPlaceholder="Rechercher une réservation..."
        searchFilter={(row, query) =>
          row.session?.workshop?.title?.toLowerCase().includes(query) ||
          row.customer?.fullName?.toLowerCase().includes(query) ||
          row.customer?.email?.toLowerCase().includes(query)
        }
      />

      <ChangeSessionModal
        open={!!changeModalReservation}
        onClose={() => setChangeModalReservation(null)}
        reservation={changeModalReservation}
      />
    </div>
  );
}
