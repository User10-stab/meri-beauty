"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/api-client";
import { PROSPECT_STATUS_LABELS, getSourceLabel } from "@/lib/prospects/prospect-choices";

const NEXT_ACTIONS = [
  "envoyer_email",
  "relancer_email",
  "appeler",
  "envoyer_campagne",
  "proposer_demo",
  "suivre_essai",
  "autre",
  "aucune",
];

const TIMELINE_ICONS = {
  activity: "📝",
  open: "👁️",
  click: "👆",
};

export function ProspectDetailClient({ id }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const [newStatus, setNewStatus] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [nextAction, setNextAction] = useState({ type: "", dueDate: "", note: "" });
  const [noteText, setNoteText] = useState("");

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const json = await fetchJson(`/api/prospects/${id}`);
      if (!json?.success) throw new Error(json?.message || "Chargement impossible.");
      setData(json.data);
      setNextAction({
        type: json.data.prospect.nextActionType || "",
        dueDate: json.data.prospect.nextActionDueDate
          ? new Date(json.data.prospect.nextActionDueDate).toISOString().slice(0, 10)
          : "",
        note: json.data.prospect.nextActionNote || "",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  async function handleDelete() {
    const name = data?.prospect?.email || "ce prospect";
    if (!confirm(`Supprimer ${name} et tout son historique d'activités ? Irréversible.`)) return;
    setActionLoading(true);
    try {
      const json = await fetchJson(`/api/prospects/${id}`, { method: "DELETE" });
      if (!json?.success) throw new Error(json?.message || "Suppression impossible.");
      router.push("/dashboard/marketing/prospects");
    } catch (err) {
      alert(err.message);
      setActionLoading(false);
    }
  }

  async function callApi(url, method, body) {
    setActionLoading(true);
    try {
      const json = await fetchJson(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!json?.success) throw new Error(json?.message || "Action impossible.");
      await fetchDetail();
    } catch (err) {
      alert(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-500">Chargement de la fiche…</p>;
  if (error) {
    return (
      <div className="space-y-4">
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        <Link href="/dashboard/marketing/prospects" className="text-sm text-[#2f3a2e] underline">← Retour aux prospects</Link>
      </div>
    );
  }

  const { prospect, timeline, campaignEngagement } = data;

  return (
    <div className="space-y-6">
      <Link href="/dashboard/marketing/prospects" className="text-sm text-[#2f3a2e] underline dark:text-white">
        ← Retour aux prospects
      </Link>

      {/* Infos */}
      <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-dark dark:text-white">
              {prospect.firstName || prospect.lastName
                ? `${prospect.firstName ?? ""} ${prospect.lastName ?? ""}`.trim()
                : prospect.email}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              {prospect.email}
              {prospect.phone ? ` · ${prospect.phone}` : ""}
              {prospect.company ? ` · ${prospect.company}` : ""}
              {prospect.city ? ` · ${prospect.city}` : ""}
              {prospect.website ? (
                <>
                  {" · "}
                  <a
                    href={prospect.website.startsWith("http") ? prospect.website : `https://${prospect.website}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {prospect.website}
                  </a>
                </>
              ) : ""}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Source : {getSourceLabel(prospect.source)} · Créé le {new Date(prospect.createdAt).toLocaleDateString("fr-BE")}
              {prospect.user ? ` · Compte lié : ${prospect.user.fullName}` : " · Sans compte"}
              {prospect.marketingOptOut ? " · ⛔ désinscrit des campagnes" : ""}
            </p>
            {prospect.utmCampaign && (
              <p className="mt-1 text-xs text-gray-400">
                UTM : {prospect.utmSource}/{prospect.utmMedium}/{prospect.utmCampaign}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
              {PROSPECT_STATUS_LABELS[prospect.status] ?? prospect.status}
            </span>
            <button
              disabled={actionLoading}
              onClick={() => callApi(`/api/prospects/${id}/resync`, "POST")}
              className="rounded-lg border border-stroke px-3 py-1.5 text-xs font-medium disabled:opacity-50 dark:border-dark-3"
              title="Recale le statut depuis les paiements / réservations / commandes du salon"
            >
              🔄 Resync salon
            </button>
            <button
              disabled={actionLoading}
              onClick={handleDelete}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/40 dark:hover:bg-red-900/10"
              title="Supprime le prospect et tout son historique (irréversible)"
            >
              🗑 Supprimer
            </button>
          </div>
        </div>

        {/* Changement de statut */}
        <div className="mt-4 flex flex-col gap-2 border-t border-stroke pt-4 dark:border-dark-3 sm:flex-row">
          <select
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value)}
            className="h-10 rounded-lg border border-stroke bg-transparent px-3 text-sm dark:border-dark-3"
          >
            <option value="">Changer de statut…</option>
            {Object.entries(PROSPECT_STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <input
            value={statusNote}
            onChange={(e) => setStatusNote(e.target.value)}
            placeholder="Note (optionnel)"
            className="h-10 flex-1 rounded-lg border border-stroke bg-transparent px-3 text-sm dark:border-dark-3"
          />
          <button
            disabled={actionLoading || !newStatus}
            onClick={() => {
              callApi(`/api/prospects/${id}/status`, "PATCH", { status: newStatus, note: statusNote || undefined });
              setNewStatus("");
              setStatusNote("");
            }}
            className="h-10 rounded-lg bg-[#2f3a2e] px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            Appliquer
          </button>
        </div>

        {/* Prochaine action */}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            value={nextAction.type}
            onChange={(e) => setNextAction((a) => ({ ...a, type: e.target.value }))}
            className="h-10 rounded-lg border border-stroke bg-transparent px-3 text-sm dark:border-dark-3"
          >
            <option value="">Prochaine action…</option>
            {NEXT_ACTIONS.map((a) => (
              <option key={a} value={a}>{a.replace(/_/g, " ")}</option>
            ))}
          </select>
          <input
            type="date"
            value={nextAction.dueDate}
            onChange={(e) => setNextAction((a) => ({ ...a, dueDate: e.target.value }))}
            className="h-10 rounded-lg border border-stroke bg-transparent px-3 text-sm dark:border-dark-3"
          />
          <input
            value={nextAction.note}
            onChange={(e) => setNextAction((a) => ({ ...a, note: e.target.value }))}
            placeholder="Note d'action"
            className="h-10 flex-1 rounded-lg border border-stroke bg-transparent px-3 text-sm dark:border-dark-3"
          />
          <button
            disabled={actionLoading}
            onClick={() => callApi(`/api/prospects/${id}/next-action`, "PATCH", {
              type: nextAction.type || null,
              dueDate: nextAction.dueDate || undefined,
              note: nextAction.note || undefined,
            })}
            className="h-10 rounded-lg bg-[#2f3a2e] px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            Enregistrer
          </button>
        </div>
      </div>

      {/* Engagement par campagne */}
      {campaignEngagement?.length > 0 && (
        <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
          <h2 className="mb-3 text-base font-bold text-dark dark:text-white">Engagement par campagne</h2>
          <div className="space-y-2">
            {campaignEngagement.map((e, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2 text-sm dark:bg-dark-2">
                <span className="font-medium">{e.campaign?.title ?? "Hors campagne"}</span>
                <span className="text-gray-500">👁️ {e.opens} · 👆 {e.clicks}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ajouter une note */}
      <div className="flex flex-col gap-2 rounded-[10px] border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark sm:flex-row">
        <input
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Ajouter une note ou un compte-rendu d'appel…"
          className="h-10 flex-1 rounded-lg border border-stroke bg-transparent px-3 text-sm dark:border-dark-3"
        />
        <button
          disabled={actionLoading || !noteText.trim()}
          onClick={() => {
            callApi(`/api/prospects/${id}/activities`, "POST", { type: "note_added", description: noteText });
            setNoteText("");
          }}
          className="h-10 rounded-lg bg-[#2f3a2e] px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Ajouter
        </button>
      </div>

      {/* Timeline */}
      <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
        <h2 className="mb-4 text-base font-bold text-dark dark:text-white">
          Timeline ({timeline?.length ?? 0})
        </h2>
        {!timeline || timeline.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune activité pour le moment.</p>
        ) : (
          <ol className="space-y-3">
            {timeline.map((item) => (
              <li key={item.id} className="flex gap-3 text-sm">
                <span className="shrink-0">{TIMELINE_ICONS[item.kind] ?? "📝"}</span>
                <div className="min-w-0">
                  <p className="text-dark dark:text-white">{item.description || item.type}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(item.date).toLocaleString("fr-BE")}
                    {item.campaign ? ` · ${item.campaign.title}` : ""}
                    {item.metadata?.url ? ` · ${item.metadata.url}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
