"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  UserPlus,
  Mail,
  Eye,
  MousePointerClick,
  Heart,
  FlaskConical,
  BadgeCheck,
  UserX,
} from "lucide-react";
import { fetchJson } from "@/lib/api-client";
import {
  PROSPECT_SOURCE_CHOICES,
  PROSPECT_STATUS_LABELS,
  getSourceLabel,
} from "@/lib/prospects/prospect-choices";

const STATUS_ICONS = {
  nouveau: UserPlus,
  contacte: Mail,
  lecteur: Eye,
  engage: MousePointerClick,
  interesse: Heart,
  demo_essai: FlaskConical,
  client: BadgeCheck,
  perdu: UserX,
};

const STATUS_BORDERS = {
  nouveau: "border-gray-200 dark:border-dark-3",
  contacte: "border-blue-200 dark:border-blue-900/50",
  lecteur: "border-sky-200 dark:border-sky-900/50",
  engage: "border-violet-200 dark:border-violet-900/50",
  interesse: "border-amber-200 dark:border-amber-900/50",
  demo_essai: "border-teal-200 dark:border-teal-900/50",
  client: "border-emerald-200 dark:border-emerald-900/50",
  perdu: "border-red-200 dark:border-red-900/50",
};

const STATUS_COLORS = {  nouveau: "bg-gray-100 text-gray-700 dark:bg-dark-2 dark:text-dark-6",
  contacte: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  lecteur: "bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400",
  engage: "bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400",
  interesse: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  demo_essai: "bg-teal-50 text-teal-700 dark:bg-teal-900/20 dark:text-teal-400",
  client: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  perdu: "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400",
};

export function ProspectsClient() {
  const [stats, setStats] = useState(null);
  const [prospects, setProspects] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const json = await fetchJson("/api/prospects/stats");
      if (json?.success) setStats(json.data);
    } catch {
      // stats optionnelles — la liste reste utilisable.
    }
  }, []);

  const fetchProspects = useCallback(
    async (page = 1) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(pagination.limit),
          ...(search ? { search } : {}),
          ...(status ? { status } : {}),
          ...(source ? { source } : {}),
        });
        const json = await fetchJson(`/api/prospects?${params}`);
        if (!json?.success) throw new Error(json?.message || "Chargement impossible.");
        setProspects(json.data.prospects);
        setPagination(json.data.pagination);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search, status, source]
  );

  useEffect(() => {
    fetchStats();
    fetchProspects(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, source]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
          {Object.entries(PROSPECT_STATUS_LABELS).map(([key, label]) => {
            const Icon = STATUS_ICONS[key];
            return (
              <button
                key={key}
                onClick={() => setStatus(status === key ? "" : key)}
                className={`rounded-xl border-2 px-3 py-2 text-left transition-all ${STATUS_COLORS[key] ?? ""} ${
                  status === key
                    ? "border-[#2f3a2e] ring-1 ring-[#2f3a2e]"
                    : STATUS_BORDERS[key] ?? "border-stroke dark:border-dark-3"
                }`}
              >
                <div className="flex items-center gap-2">
                  {Icon && <Icon className="h-4 w-4" />}
                  <span className="text-xl font-bold leading-none">
                    {stats.byStatus?.[key] ?? 0}
                  </span>
                </div>
                <div className="mt-0.5 text-xs font-medium opacity-80">{label}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-[10px] border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark sm:flex-row sm:items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (e-mail, nom, société, téléphone)…"
          className="h-10 flex-1 rounded-lg border border-stroke bg-transparent px-3 text-sm text-dark outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:text-white"
        />
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="h-10 w-full rounded-lg border border-stroke bg-transparent px-3 text-sm text-dark outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:text-white sm:w-56"
        >
          <option value="">Toutes sources</option>
          {PROSPECT_SOURCE_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <button
          onClick={() => setShowCreate(true)}
          className="h-10 shrink-0 rounded-lg bg-[#2f3a2e] px-4 text-sm font-semibold text-white hover:bg-[#3d4d3c]"
        >
          + Nouveau prospect
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Liste */}
      <div className="overflow-hidden rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark">
        <div className="divide-y divide-stroke dark:divide-dark-3">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4">
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-2/5 animate-pulse rounded bg-gray-100 dark:bg-dark-2" />
                  <div className="h-3 w-1/4 animate-pulse rounded bg-gray-100 dark:bg-dark-2" />
                </div>
              </div>
            ))
          ) : prospects.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-gray-500">Aucun prospect trouvé.</p>
          ) : (
            prospects.map((p) => (
              <Link
                key={p.id}
                href={`/dashboard/marketing/prospects/${p.id}`}
                className="flex flex-wrap items-center gap-3 px-6 py-4 transition-colors hover:bg-gray-50 dark:hover:bg-dark-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-dark dark:text-white">
                    {p.firstName || p.lastName ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() : p.email}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {p.email}
                    {p.company ? ` · ${p.company}` : ""}
                    {p.city ? ` · ${p.city}` : ""}
                    {p.source ? ` · ${getSourceLabel(p.source)}` : ""}
                    {p._count?.activities ? ` · ${p._count.activities} activité(s)` : ""}
                  </p>
                </div>
                {p.nextActionType && p.nextActionType !== "aucune" && (
                  <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700 dark:bg-orange-900/20 dark:text-orange-400">
                    → {p.nextActionType.replace(/_/g, " ")}
                  </span>
                )}
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_COLORS[p.status] ?? STATUS_COLORS.nouveau}`}>
                  {PROSPECT_STATUS_LABELS[p.status] ?? p.status}
                </span>
              </Link>
            ))
          )}
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-stroke px-6 py-3 text-sm dark:border-dark-3">
            <span className="text-gray-500">
              Page {pagination.page} / {pagination.totalPages} — {pagination.total} prospect(s)
            </span>
            <div className="flex gap-2">
              <button
                disabled={pagination.page <= 1}
                onClick={() => fetchProspects(pagination.page - 1)}
                className="rounded-lg border border-stroke px-3 py-1.5 disabled:opacity-40 dark:border-dark-3"
              >
                ←
              </button>
              <button
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => fetchProspects(pagination.page + 1)}
                className="rounded-lg border border-stroke px-3 py-1.5 disabled:opacity-40 dark:border-dark-3"
              >
                →
              </button>
            </div>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateProspectModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            fetchStats();
            fetchProspects(1);
          }}
        />
      )}
    </div>
  );
}

function CreateProspectModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    email: "",
    firstName: "",
    lastName: "",
    phone: "",
    company: "",
    city: "",
    website: "",
    source: "autre",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const json = await fetchJson("/api/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!json?.success) throw new Error(json?.message || "Création impossible.");
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const textField = (key, label, required = false, placeholder = "") => (
    <label key={key} className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      <input
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        required={required}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-stroke bg-transparent px-3 text-sm text-dark outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:text-white"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-6 dark:bg-gray-dark"
      >
        <h2 className="text-lg font-bold text-dark dark:text-white">Nouveau prospect</h2>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {textField("email", "E-mail *", true)}
        <div className="grid grid-cols-2 gap-3">
          {textField("firstName", "Prénom")}
          {textField("lastName", "Nom")}
        </div>
        {textField("phone", "Téléphone")}
        {textField("company", "Société")}
        <div className="grid grid-cols-2 gap-3">
          {textField("city", "Ville", false, "Bruxelles")}
          {textField("website", "Site web", false, "https://…")}
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">Source *</span>
          <select
            value={form.source}
            onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
            required
            className="h-10 w-full rounded-lg border border-stroke bg-transparent px-3 text-sm text-dark outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:text-white"
          >
            {PROSPECT_SOURCE_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-stroke px-4 py-2 text-sm dark:border-dark-3">
            Annuler
          </button>
          <button type="submit" disabled={saving} className="rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? "Création…" : "Créer"}
          </button>
        </div>
      </form>
    </div>
  );
}
