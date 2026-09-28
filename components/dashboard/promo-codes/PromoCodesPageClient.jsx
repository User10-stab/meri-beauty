"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus, Search, Tag, Copy, Check, Pencil, Power, Users, Package, Scissors, Repeat, Ticket, Clock, Sparkles,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { setPromoCodeActive } from "@/actions/promo-codes";
import { PROMO_CODE_SCOPES, PROMO_CODE_SCOPE_LABELS } from "@/lib/promo-code-scopes";
import { PromoTicket } from "./PromoTicket";
import { STATUS_META, promoStatus } from "./promo-format";

const FILTERS = [
  { value: "ALL", label: "Tous" },
  { value: "ACTIVE", label: "Actifs" },
  { value: "EXPIRING", label: "Expirent bientôt" },
  { value: "EXHAUSTED", label: "Épuisés" },
  { value: "EXPIRED", label: "Expirés" },
  { value: "INACTIVE", label: "Désactivés" },
];

function matchesFilter(status, filter) {
  if (filter === "ALL") return true;
  // "Actifs" = usable right now, including the ones about to expire.
  if (filter === "ACTIVE") return status === "ACTIVE" || status === "EXPIRING";
  return status === filter;
}

export function PromoCodesPageClient({ initialPromoCodes }) {
  const router = useRouter();
  const [promoCodes, setPromoCodes] = useState(initialPromoCodes);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [scope, setScope] = useState("ALL");
  const [toDeactivate, setToDeactivate] = useState(null);
  const [isPending, startTransition] = useTransition();

  // Computed once per render from the same clock, so every card and counter agree.
  const now = useMemo(() => new Date(), []);
  const withStatus = useMemo(
    () => promoCodes.map((p) => ({ ...p, status: promoStatus(p, now) })),
    [promoCodes, now]
  );

  const stats = useMemo(() => {
    const usable = withStatus.filter((p) => p.status === "ACTIVE" || p.status === "EXPIRING");
    return {
      active: usable.length,
      uses: withStatus.reduce((sum, p) => sum + p.usedCount, 0),
      expiring: withStatus.filter((p) => p.status === "EXPIRING").length,
      personal: usable.filter((p) => p.customers.length > 0).length,
    };
  }, [withStatus]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.value, withStatus.filter((p) => matchesFilter(p.status, f.value)).length])),
    [withStatus]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return withStatus.filter((p) => {
      if (!matchesFilter(p.status, filter)) return false;
      if (scope !== "ALL" && !p.scopes.includes(scope)) return false;
      if (!q) return true;
      return (
        p.code.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.customers.some((c) => c.fullName.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
      );
    });
  }, [withStatus, query, filter, scope]);

  function toggleActive(promo, nextActive) {
    startTransition(async () => {
      const result = await setPromoCodeActive(promo.id, nextActive);
      if (result.success) {
        toast.success(result.message);
        setPromoCodes((prev) => prev.map((p) => (p.id === promo.id ? result.data : p)));
      } else {
        toast.error(result.message);
      }
      setToDeactivate(null);
    });
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-[#2f3a2e] px-6 py-7 text-white sm:px-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_0%,rgba(200,164,106,0.35),transparent_55%)]" />
        <div className="pointer-events-none absolute -bottom-10 right-10 h-40 w-40 rounded-full border border-[#C8A46A]/20" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[#C8A46A]">Marketing</p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Codes promo</h1>
            <p className="mt-1.5 max-w-xl text-sm text-white/70">
              Créez des remises pour la boutique, les rendez-vous, les ateliers et les formations — pour tout le monde ou
              pour une cliente en particulier.
            </p>
          </div>
          <Link
            href="/dashboard/promo-codes/new"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#C8A46A] px-4 py-2.5 text-sm font-semibold text-[#2f3a2e] shadow-sm transition hover:bg-[#d6b67f] active:scale-[0.98]"
          >
            <Plus size={16} />
            Nouveau code
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Ticket} label="Codes utilisables" value={stats.active} />
        <StatCard icon={Repeat} label="Utilisations au total" value={stats.uses} />
        <StatCard icon={Clock} label="Expirent sous 7 jours" value={stats.expiring} tone={stats.expiring ? "amber" : undefined} />
        <StatCard icon={Users} label="Codes personnels actifs" value={stats.personal} />
      </div>

      {/* Toolbar */}
      <div className="rounded-2xl border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-xs">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un code, une note, une cliente…"
              className="h-10 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            aria-label="Filtrer par domaine"
            className="h-10 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white lg:w-52"
          >
            <option value="ALL">Tous les domaines</option>
            {PROMO_CODE_SCOPES.map((s) => (
              <option key={s} value={s}>{PROMO_CODE_SCOPE_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                filter === f.value
                  ? "bg-[#2f3a2e] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-dark-2 dark:text-dark-6"
              }`}
            >
              {f.label}
              <span className={`rounded-full px-1.5 text-[10px] ${filter === f.value ? "bg-white/20" : "bg-white dark:bg-dark-3"}`}>
                {counts[f.value]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Cards */}
      {promoCodes.length === 0 ? (
        <EmptyState />
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 px-6 py-14 text-center text-sm text-gray-500 dark:border-dark-3">
          Aucun code ne correspond à ces filtres.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {visible.map((promo) => (
            <PromoCard
              key={promo.id}
              promo={promo}
              onOpen={() => router.push(`/dashboard/promo-codes/${promo.id}`)}
              onDeactivate={() => setToDeactivate(promo)}
              onReactivate={() => toggleActive(promo, true)}
              busy={isPending}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!toDeactivate}
        title="Désactiver ce code promo ?"
        message={toDeactivate ? `Le code "${toDeactivate.code}" ne pourra plus être utilisé. Vous pourrez le réactiver à tout moment.` : ""}
        confirmLabel="Désactiver"
        danger
        loading={isPending}
        onConfirm={() => toggleActive(toDeactivate, false)}
        onCancel={() => setToDeactivate(null)}
      />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          tone === "amber" ? "bg-amber-50 text-amber-600" : "bg-[#2f3a2e]/5 text-[#2f3a2e] dark:bg-white/5 dark:text-[#C8A46A]"
        }`}
      >
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-xl font-bold leading-tight text-dark dark:text-white">{value}</p>
        <p className="truncate text-xs text-gray-500 dark:text-dark-6">{label}</p>
      </div>
    </div>
  );
}

function PromoCard({ promo, onOpen, onDeactivate, onReactivate, busy }) {
  const [copied, setCopied] = useState(false);
  const meta = STATUS_META[promo.status];
  const dimmed = promo.status === "INACTIVE" || promo.status === "EXPIRED";
  const cap = promo.maxUses;
  const pct = cap ? Math.min(100, Math.round((promo.usedCount / cap) * 100)) : null;

  function copy(e) {
    e.stopPropagation();
    navigator.clipboard?.writeText(promo.code);
    setCopied(true);
    toast.success(`Code ${promo.code} copié`);
    setTimeout(() => setCopied(false), 1500);
  }

  const restrictions = [
    promo.customers.length > 0 && {
      icon: Users,
      text: promo.customers.length === 1 ? promo.customers[0].fullName : `${promo.customers.length} clients`,
      title: promo.customers.map((c) => c.fullName).join(", "),
    },
    promo.scopes.includes("BOUTIQUE") && promo.products.length > 0 && {
      icon: Package,
      text: promo.products.length === 1 ? promo.products[0].name : `${promo.products.length} produits`,
      title: promo.products.map((p) => p.name).join(", "),
    },
    promo.scopes.includes("APPOINTMENT") && promo.services.length > 0 && {
      icon: Scissors,
      text: promo.services.length === 1 ? promo.services[0].name : `${promo.services.length} prestations`,
      title: promo.services.map((s) => s.name).join(", "),
    },
    promo.maxUsesPerCustomer && {
      icon: Repeat,
      text: `${promo.maxUsesPerCustomer}× / client`,
      title: "Utilisations maximum par client",
    },
  ].filter(Boolean);

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className="group flex cursor-pointer flex-col rounded-2xl border border-stroke bg-white p-4 shadow-1 transition hover:-translate-y-0.5 hover:border-[#C8A46A]/60 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2f3a2e]/30 dark:border-dark-3 dark:bg-gray-dark"
    >
      <PromoTicket promo={promo} muted={dimmed} />

      <div className="mt-4 flex items-center justify-between gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${meta.className}`}>{meta.label}</span>
        <div className="flex items-center gap-1">
          <IconButton label="Copier le code" onClick={copy}>
            {copied ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
          </IconButton>
          <IconButton label="Modifier" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
            <Pencil size={15} />
          </IconButton>
          {promo.isActive ? (
            <IconButton label="Désactiver" danger disabled={busy} onClick={(e) => { e.stopPropagation(); onDeactivate(); }}>
              <Power size={15} />
            </IconButton>
          ) : (
            <IconButton label="Réactiver" disabled={busy} onClick={(e) => { e.stopPropagation(); onReactivate(); }}>
              <Power size={15} className="text-emerald-600" />
            </IconButton>
          )}
        </div>
      </div>

      {promo.description && <p className="mt-2 line-clamp-2 text-xs text-gray-500 dark:text-dark-6">{promo.description}</p>}

      {restrictions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {restrictions.map((r, i) => (
            <span
              key={i}
              title={r.title}
              className="inline-flex max-w-full items-center gap-1 rounded-md bg-[#fdf8f0] px-2 py-1 text-[11px] font-medium text-[#6f5a3a] ring-1 ring-inset ring-[#C8A46A]/25 dark:bg-white/5 dark:text-[#e3cfa6]"
            >
              <r.icon size={12} className="shrink-0" />
              <span className="truncate">{r.text}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto pt-4">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-gray-500 dark:text-dark-6">Utilisations</span>
          <span className="font-semibold text-dark dark:text-white">
            {promo.usedCount} <span className="font-normal text-gray-400">/ {cap ?? "∞"}</span>
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-dark-2">
          <div
            className={`h-full rounded-full ${pct != null && pct >= 100 ? "bg-orange-400" : "bg-[#C8A46A]"}`}
            style={{ width: pct != null ? `${pct}%` : promo.usedCount > 0 ? "100%" : "0%", opacity: pct == null ? 0.35 : 1 }}
          />
        </div>
      </div>
    </div>
  );
}

function IconButton({ label, children, danger, ...props }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors disabled:opacity-40 ${
        danger ? "hover:bg-red-50 hover:text-red-600" : "hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-dark-2"
      }`}
      {...props}
    >
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-[#C8A46A]/40 bg-[#fdf8f0]/60 px-6 py-16 text-center dark:bg-white/5">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#2f3a2e] text-[#C8A46A]">
        <Tag size={24} />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-dark dark:text-white">Aucun code promo pour l&apos;instant</h2>
      <p className="mt-1 max-w-sm text-sm text-gray-500">
        Offrez une remise de bienvenue, remerciez une cliente fidèle ou lancez une offre sur un produit.
      </p>
      <Link
        href="/dashboard/promo-codes/new"
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3d4e3b]"
      >
        <Sparkles size={15} />
        Créer mon premier code
      </Link>
    </div>
  );
}
