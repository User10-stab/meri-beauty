"use client";

import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { reviewCancellationExceptionRequest } from "@/actions/reservation/cancellation-exception-request";

function formatDate(value) {
  return new Date(value).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });
}

export function CancellationExceptionRequestsClient({ initialRequests }) {
  const [requests, setRequests] = useState(initialRequests);
  const [notes, setNotes] = useState({});
  const [processingId, setProcessingId] = useState(null);

  async function decide(requestId, decision) {
    setProcessingId(requestId);
    const result = await reviewCancellationExceptionRequest({ requestId, decision, decisionNote: notes[requestId] ?? "" });
    setProcessingId(null);
    if (!result.success) return toast.error(result.message);
    toast.success(result.message);
    setRequests((current) => current.map((request) => request.id === requestId ? { ...request, status: decision, decisionNote: notes[requestId] ?? "", reviewedAt: new Date().toISOString() } : request));
  }

  if (!requests.length) {
    return <div className="rounded-xl border border-stroke bg-white p-6 text-sm text-gray-500 dark:border-dark-3 dark:bg-gray-dark">Aucune demande pour le moment.</div>;
  }

  return (
    <div className="space-y-4">
      {requests.map((request) => {
        const pending = request.status === "PENDING";
        const appointment = request.appointment;
        return (
          <article key={request.id} className="rounded-xl border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-semibold text-dark dark:text-white">{request.requestedBy.fullName} — {appointment.staffService.service.name}</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-dark-6">Rendez-vous : {formatDate(appointment.startTime)} · {appointment.staffService.staff.user.fullName}</p>
                <p className="text-sm text-gray-500 dark:text-dark-6">Client : {request.requestedBy.email}{request.requestedBy.phone ? ` · ${request.requestedBy.phone}` : ""}</p>
              </div>
              <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${pending ? "bg-amber-50 text-amber-700" : request.status === "APPROVED" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                {pending ? "À traiter" : request.status === "APPROVED" ? "Acceptée" : "Refusée"}
              </span>
            </div>

            <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-dark dark:bg-dark-2 dark:text-white">
              <span className="font-semibold">Motif du client : </span>{request.reason}
            </div>

            {pending ? (
              <div className="mt-4 space-y-3">
                <textarea value={notes[request.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))} rows={2} placeholder="Message facultatif pour le client" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white" />
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" disabled={processingId === request.id} onClick={() => decide(request.id, "REJECTED")} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"><X size={15} /> Refuser</button>
                  <button type="button" disabled={processingId === request.id} onClick={() => decide(request.id, "APPROVED")} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{processingId === request.id ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Accepter et rembourser l&apos;acompte</button>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-500 dark:text-dark-6">Décision : {request.decisionNote || "Aucun message ajouté."}</p>
            )}
          </article>
        );
      })}
    </div>
  );
}
