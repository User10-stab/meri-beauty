"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DataTable } from "../Tables/DataTable";
import { ReservationRow } from "./ReservationRow";
import {
  cancelFormationReservation,
  completeFormationReservation,
  markFormationReservationNoShow,
} from "@/actions/formations/manage-reservation";
import { isAdminRole } from "@/lib/authorization";
import { useTranslations } from "next-intl";
import { CancelReservationDialog } from "@/components/dashboard/workshops/CancelReservationDialog";
import { SettleReservationDialog } from "@/components/dashboard/reservations/SettleReservationDialog";

export function ReservationsPageClient({ initialReservations = [], userRole }) {
  const t = useTranslations("dashboardFormations.reservations");
  
  const COLUMNS = [
    { key: "formation", label: t("columns.formation") },
    { key: "customer", label: t("columns.customer") },
    { key: "seatsCount", label: t("columns.seats") },
    { key: "status", label: t("columns.status") },
    { key: "payment", label: t("columns.payment") },
  ];

  const router = useRouter();
  const isAdmin = isAdminRole(userRole);
  const [toCancel, setToCancel] = useState(null);
  const [isCancelling, startCancel] = useTransition();
  const [toSettle, setToSettle] = useState(null);
  const [isSettling, startSettle] = useTransition();

  function handleSettle({ method, paymentConfirmed }) {
    startSettle(async () => {
      const result = await completeFormationReservation(toSettle.id, { method, paymentConfirmed });
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
      const result = await markFormationReservationNoShow(row.id);
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
        searchPlaceholder={t("searchPlaceholder")}
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

      <SettleReservationDialog
        reservation={toSettle}
        onClose={() => setToSettle(null)}
        onConfirm={handleSettle}
        loading={isSettling}
      />
    </div>
  );
}
