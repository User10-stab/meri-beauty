"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DataTable } from "../Tables/DataTable";
import { ReservationRow } from "./ReservationRow";
import { ChangeSessionModal } from "./ChangeSessionModal";
import { CancelReservationDialog } from "./CancelReservationDialog";
import { SettleReservationDialog } from "../reservations/SettleReservationDialog";
import {
  cancelWorkshopReservation,
  completeWorkshopReservation,
  markWorkshopReservationNoShow,
} from "@/actions/workshops/manage-reservation";
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
  const isAdmin = isAdminRole(userRole);
  const [isCancelling, startCancel] = useTransition();
  const [changeModalReservation, setChangeModalReservation] = useState(null);
  const [toCancel, setToCancel] = useState(null);
  const [toSettle, setToSettle] = useState(null);
  const [isSettling, startSettle] = useTransition();

  function handleSettle({ method, paymentConfirmed }) {
    startSettle(async () => {
      const result = await completeWorkshopReservation(toSettle.id, { method, paymentConfirmed });
      if (result.success) {
        toast.success(result.message);
        setToSettle(null);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleNoShow(row) {
    startSettle(async () => {
      const result = await markWorkshopReservationNoShow(row.id);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleConfirmCancel({ reason, refundDeposit }) {
    startCancel(async () => {
      const result = await cancelWorkshopReservation(toCancel.id, { reason, refundDeposit });
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
        onEdit={isAdmin ? (row) => setChangeModalReservation(row) : undefined}
        onDelete={isAdmin ? (row) => setToCancel(row) : undefined}
        onSettle={(row) => setToSettle(row)}
        onNoShow={handleNoShow}
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

      <CancelReservationDialog
        reservation={toCancel}
        onClose={() => setToCancel(null)}
        onConfirm={handleConfirmCancel}
        loading={isCancelling}
      />

      <SettleReservationDialog
        reservation={toSettle}
        onClose={() => setToSettle(null)}
        onConfirm={handleSettle}
        loading={isSettling}
      />
    </div>
  );
}
