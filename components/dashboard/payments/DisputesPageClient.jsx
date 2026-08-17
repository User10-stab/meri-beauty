"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, ShieldAlert, CircleCheck, FileText } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import Button from "@/components/ui/Button";
import { listDisputes, listDisputeAssignees, updateDisputeDossier } from "@/actions/dashboard/stripe-disputes";

const STATUS_LABEL = {
  NEEDS_RESPONSE: "Réponse requise",
  UNDER_REVIEW: "En cours d'examen",
  WARNING_NEEDS_RESPONSE: "Alerte — réponse requise",
  WARNING_UNDER_REVIEW: "Alerte — en cours d'examen",
  WARNING_CLOSED: "Alerte close",
  WON: "Gagné",
  LOST: "Perdu",
  CHARGE_REFUNDED: "Remboursé",
};

const STATUS_STYLE = {
  NEEDS_RESPONSE: "bg-red-50 text-red-600 border-red-100",
  UNDER_REVIEW: "bg-amber-50 text-amber-700 border-amber-100",
  WARNING_NEEDS_RESPONSE: "bg-red-50 text-red-600 border-red-100",
  WARNING_UNDER_REVIEW: "bg-amber-50 text-amber-700 border-amber-100",
  WARNING_CLOSED: "bg-gray-100 text-gray-600 border-gray-200",
  WON: "bg-green-50 text-green-700 border-green-100",
  LOST: "bg-gray-100 text-gray-600 border-gray-200",
  CHARGE_REFUNDED: "bg-gray-100 text-gray-600 border-gray-200",
};

const OPEN_STATUSES = ["NEEDS_RESPONSE", "UNDER_REVIEW", "WARNING_NEEDS_RESPONSE", "WARNING_UNDER_REVIEW"];

function formatPrice(n) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(n);
}

function formatDate(d) {
  return d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" }) : "—";
}

function DossierDialog({ dispute, assignees, onClose, onSaved }) {
  const [assignedStaffId, setAssignedStaffId] = useState(dispute.assignedStaffId ?? "");
  const [responseSent, setResponseSent] = useState(Boolean(dispute.responseSentAt));
  const [proofOfShipmentReference, setProofOfShipmentReference] = useState(dispute.proofOfShipmentReference ?? "");
  const [conclusion, setConclusion] = useState(dispute.conclusion ?? "");
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await updateDisputeDossier({
        disputeId: dispute.id,
        assignedStaffId: assignedStaffId || null,
        responseSent,
        proofOfShipmentReference,
        conclusion,
      });
      if (result.success) {
        toast.success(result.message);
        onSaved();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dispute-dossier-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-dark">
        <div>
          <h2 id="dispute-dossier-title" className="text-base font-semibold text-gray-900 dark:text-white">
            Dossier litige — {dispute.type} {dispute.reference}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {formatPrice(dispute.amount)} · motif Stripe : {dispute.reason ?? "non communiqué"} · échéance {formatDate(dispute.dueBy)}
          </p>
          {dispute.shipmentHint && <p className="mt-1 text-xs text-gray-400">{dispute.shipmentHint}</p>}
          {dispute.invoiceId && (
            <a
              href={`/api/invoices/${dispute.invoiceId}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#2f3a2e] underline"
            >
              <FileText size={13} />
              Facture {dispute.invoiceNumber ?? ""}
            </a>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-500" htmlFor="dispute-assignee">Responsable</label>
            <select
              id="dispute-assignee"
              value={assignedStaffId}
              onChange={(event) => setAssignedStaffId(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            >
              <option value="">Non assigné</option>
              {assignees.map((person) => (
                <option key={person.id} value={person.id}>{person.fullName}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-dark-6">
            <input type="checkbox" checked={responseSent} onChange={(event) => setResponseSent(event.target.checked)} className="h-4 w-4 rounded border-gray-300" />
            Réponse envoyée à Stripe
          </label>

          <div>
            <label className="text-xs font-medium text-gray-500" htmlFor="dispute-proof">Preuve d&apos;expédition / retrait citée</label>
            <input
              id="dispute-proof"
              value={proofOfShipmentReference}
              onChange={(event) => setProofOfShipmentReference(event.target.value)}
              placeholder="N° de suivi, date de retrait, capture d'écran jointe…"
              className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500" htmlFor="dispute-conclusion">Conclusion</label>
            <textarea
              id="dispute-conclusion"
              value={conclusion}
              onChange={(event) => setConclusion(event.target.value)}
              rows={3}
              placeholder="Résultat final, notes pour l'équipe…"
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} disabled={isPending} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Fermer
          </button>
          <Button onClick={save} disabled={isPending}>
            {isPending && <Loader2 size={14} className="animate-spin" />}
            Enregistrer
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DisputesPageClient({ initialDisputes, assignees }) {
  const [disputes, setDisputes] = useState(initialDisputes);
  const [openDispute, setOpenDispute] = useState(null);
  const [isRefreshing, startRefresh] = useTransition();

  useEffect(() => setDisputes(initialDisputes), [initialDisputes]);

  function refetch() {
    startRefresh(async () => {
      const result = await listDisputes();
      if (result.success) setDisputes(result.data);
    });
  }

  const openCount = useMemo(() => disputes.filter((d) => OPEN_STATUSES.includes(d.status)).length, [disputes]);
  const openTotal = useMemo(
    () => disputes.filter((d) => OPEN_STATUSES.includes(d.status)).reduce((sum, d) => sum + d.amount, 0),
    [disputes],
  );

  return (
    <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex items-center gap-2 border-b border-stroke px-6 py-4 text-sm text-gray-600 dark:border-dark-3 dark:text-dark-6">
        {openCount > 0 ? (
          <>
            <ShieldAlert size={16} className="text-red-500" />
            <span>{openCount} litige{openCount > 1 ? "s" : ""} ouvert{openCount > 1 ? "s" : ""} — {formatPrice(openTotal)} en jeu</span>
          </>
        ) : (
          <>
            <CircleCheck size={16} className="text-green-500" />
            <span>Aucun litige Stripe ouvert</span>
          </>
        )}
        {isRefreshing && <Loader2 size={14} className="animate-spin text-gray-400" />}
      </div>

      {disputes.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
            <CircleCheck size={22} className="text-green-400" />
          </div>
          <p className="font-medium text-gray-700 dark:text-white">Aucun litige enregistré</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Type</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Montant</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Échéance</TableHead>
              <TableHead>Responsable</TableHead>
              <TableHead className="pr-6 text-right">Dossier</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {disputes.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="pl-6">
                  <span className="font-medium text-gray-800 dark:text-white">{d.type}</span>
                  <span className="block text-xs text-gray-400">{d.reference}</span>
                </TableCell>
                <TableCell>
                  <span className="text-gray-700 dark:text-dark-6">{d.customerName ?? "—"}</span>
                  <span className="block text-xs text-gray-400">{d.customerEmail ?? ""}</span>
                </TableCell>
                <TableCell><span className="font-medium text-gray-700 dark:text-dark-6">{formatPrice(d.amount)}</span></TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[d.status]}`}>
                    {STATUS_LABEL[d.status]}
                  </span>
                  {d.responseSentAt && <span className="block text-xs text-green-600">Réponse envoyée</span>}
                </TableCell>
                <TableCell><span className={`text-gray-500 dark:text-dark-6 ${OPEN_STATUSES.includes(d.status) ? "font-medium text-red-500" : ""}`}>{formatDate(d.dueBy)}</span></TableCell>
                <TableCell><span className="text-gray-500 dark:text-dark-6">{d.assignedStaffName ?? "Non assigné"}</span></TableCell>
                <TableCell className="pr-6 text-right">
                  <Button onClick={() => setOpenDispute(d)} className="!px-3 !py-1.5 text-xs">Gérer</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {openDispute && (
        <DossierDialog
          dispute={openDispute}
          assignees={assignees}
          onClose={() => setOpenDispute(null)}
          onSaved={() => {
            setOpenDispute(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}
