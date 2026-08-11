"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DataTable } from "../Tables/DataTable";
import { ReservationRow } from "./ReservationRow";
import { cancelFormationReservation } from "@/actions/formations/manage-reservation";
import { isAdminRole } from "@/lib/authorization";
import { CancelReservationDialog } from "@/components/dashboard/workshops/CancelReservationDialog";

const COLUMNS = [
  { key: "formation", label: "Formation & Séance" },
  { key: "customer", label: "Client" },
  { key: "seatsCount", label: "Places" },
  { key: "status", label: "Statut" },
  { key: "payment", label: "Paiement" },
];

export function ReservationsPageClient({ initialReservations = [], userRole }) {
  const router = useRouter();
  const isAdmin = isAdminRole(userRole);
  const [toCancel, setToCancel] = useState(null);
  const [isCancelling, startCancel] = useTransition();

  function handleConfirmCancel({ reason, refundDeposit }) {
    startCancel(async () => {
      const result = await cancelFormationReservation(toCancel.id, {
        reason,
        refundPayment: refundDeposit,
      });
      if (result.success) {
        toast.success(result.message);
        setToCancel(null);
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
        onDelete={isAdmin ? setToCancel : undefined}
        searchPlaceholder="Rechercher une réservation..."
        searchFilter={(row, query) =>
          row.session?.formation?.title?.toLowerCase().includes(query) ||
          row.customer?.fullName?.toLowerCase().includes(query) ||
          row.customer?.email?.toLowerCase().includes(query)
        }
      />
      <CancelReservationDialog
        reservation={toCancel}
        onClose={() => setToCancel(null)}
        onConfirm={handleConfirmCancel}
        loading={isCancelling}
      />
    </div>
  );
}
