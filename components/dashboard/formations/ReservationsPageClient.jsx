"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DataTable } from "../Tables/DataTable";
import { ReservationRow } from "./ReservationRow";
import { ChangeSessionModal } from "./ChangeSessionModal";
import {
  cancelFormationReservation,
  completeFormationReservation,
  markFormationReservationNoShow,
} from "@/actions/formations/manage-reservation";
import { isAdminRole } from "@/lib/authorization";
import { CancelReservationDialog } from "@/components/dashboard/workshops/CancelReservationDialog";
import { SettleReservationDialog } from "@/components/dashboard/reservations/SettleReservationDialog";

const COLUMNS = [
  { key: "formation", label: "Formation & Séance" },
  { key: "customer", label: "Client" },
  { key: "seatsCount", label: "Places" },
  { key: "status", label: "Statut" },
  { key: "payment", label: "Paiement" },
];

/**
 * @param {string|null} [props.focusReservationId] - Notification deep-link:
 *   filters the table to that exact reservation, highlights and scrolls to
 *   it. Cleared with the notice bar — the full list is already loaded.
 */
export function ReservationsPageClient({ initialReservations = [], userRole, canCollectCash = false, focusReservationId = null }) {
  const router = useRouter();
  const isAdmin = isAdminRole(userRole);
  const [focusedId, setFocusedId] = useState(focusReservationId);
  const focusRowRef = useRef(null);

  const focusRow = focusedId
    ? initialReservations.find((r) => r.id === focusedId) ?? null
    : null;
  // Show only the linked reservation while focused (falls back to the full
  // list when the id is unknown or outside the viewer's scope).
  const displayedReservations = focusedId && focusRow ? [focusRow] : initialReservations;

  useEffect(() => {
    if (focusedId && focusRow && focusRowRef.current) {
      focusRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusedId, focusRow]);
  const [changeModalReservation, setChangeModalReservation] = useState(null);
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

  function renderFocusedRow(props) {
    return (
      <ReservationRow
        {...props}
        highlighted={props.row.id === focusedId}
        rowRef={props.row.id === focusedId ? focusRowRef : undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      {focusedId && (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-indigo-200 bg-indigo-50/50 px-4 py-2.5 text-xs text-indigo-800 dark:border-indigo-900/40 dark:bg-indigo-900/10 dark:text-indigo-300">
          <span className="font-medium">
            {focusRow ? "Réservation liée à la notification" : "Réservation introuvable ou inaccessible"}
          </span>
          <button
            type="button"
            onClick={() => setFocusedId(null)}
            className="rounded-md border border-indigo-200 bg-white px-2 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-900/40 dark:bg-transparent dark:text-indigo-300"
          >
            Effacer
          </button>
        </div>
      )}
      <DataTable
        data={displayedReservations}
        columns={COLUMNS}
        renderRow={renderFocusedRow}
        onEdit={isAdmin ? (row) => setChangeModalReservation(row) : undefined}
        onDelete={isAdmin ? setToCancel : undefined}
        onSettle={(row) => setToSettle(row)}
        onNoShow={handleNoShow}
        searchPlaceholder="Rechercher une réservation..."
        searchFilter={(row, query) =>
          row.session?.formation?.title?.toLowerCase().includes(query) ||
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
        canCollectCash={canCollectCash}
      />
    </div>
  );
}
