"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Euro,
  Package,
  TrendingUp,
  Receipt,
  Banknote,
  Percent,
  Plus,
  Pencil,
  Trash2,
  Download,
  ChevronRight,
  Repeat,
  Wallet,
  Landmark,
  FileSpreadsheet,
  Printer,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConfirm } from "@/components/ConfirmProvider";
import { deleteSalonExpense } from "@/actions/dashboard/gestion";
import { SalonExpenseModal } from "@/components/dashboard/gestion/SalonExpenseModal";

function formatEuro(value) {
  // `+ 0` turns a negated zero (−0, from "−charges" when there are none) into 0.
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format((value ?? 0) + 0);
}

function formatRate(value) {
  return value == null ? "—" : `${String(value).replace(".", ",")} %`;
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("fr-BE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

function formatMonthKey(key) {
  const [year, month] = key.split("-").map(Number);
  const label = new Date(year, month - 1, 1).toLocaleDateString("fr-BE", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatMonthOf(value) {
  return new Date(value).toLocaleDateString("fr-BE", { month: "2-digit", year: "numeric", timeZone: "Europe/Brussels" });
}

function describePeriod(expense) {
  if (!expense.isRecurring) return formatDate(expense.date);
  const start = formatMonthOf(expense.date);
  return expense.endDate ? `${start} → ${formatMonthOf(expense.endDate)}` : `depuis ${start}`;
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Exports exactly the figures on screen — same payload, no second query. */
function downloadGestionCsv(data) {
  const { filters, summary, categories, months, expenses, cashExpenses } = data;
  const lines = [
    ["Gestion — Meri Beauty"],
    ["Période", `du ${filters.from} au ${filters.to}`],
    ["Catégorie", filters.categoryLabel],
    ["Exporté le", new Date().toLocaleString("fr-BE")],
    [],
    ["Synthèse", "Montant (€)"],
    ["Chiffre d'affaires TTC", summary.revenueTtc],
    ["TVA collectée", summary.revenueVat],
    ["Chiffre d'affaires HT", summary.revenueHt],
    ["Coût d'achat des produits vendus", -summary.costHt],
    ["Marge brute", summary.grossMarginHt],
    ["Charges du salon (HT)", -summary.chargesHt],
    ["Dépenses de caisse", -summary.cashExpenses],
    ["Bénéfice net", summary.netProfitHt ?? ""],
    [],
    ["Par catégorie", "Écritures", "CA HT (€)", "Coût produits (€)", "Marge brute (€)", "Taux (%)"],
    ...categories.map((c) => [c.label, c.count, c.revenueHt, c.costHt, c.marginHt, c.marginRate ?? ""]),
    [],
    ["Par mois", "CA TTC (€)", "TVA (€)", "CA HT (€)", "Coût produits (€)", "Marge brute (€)", "Charges HT (€)", "Dépenses caisse (€)", "Bénéfice net (€)"],
    ...months.map((m) => [
      formatMonthKey(m.month),
      m.revenueTtc,
      m.revenueVat,
      m.revenueHt,
      m.costHt,
      m.grossMarginHt,
      m.chargesHt,
      m.cashExpenses,
      m.netProfitHt ?? "",
    ]),
    [],
    ["Charges du salon", "Type", "Période", "Montant TTC (€)", "TVA (%)", "Sur la période HT (€)"],
    ...expenses.map((e) => [e.label, e.categoryLabel, describePeriod(e), e.amountTtc, e.vatRate, e.periodAmountHt]),
    [],
    ["Dépenses de caisse", "Pièce", "Date", "Montant (€)"],
    ...cashExpenses.map((c) => [c.label, c.pieceNumber, formatDate(c.occurredAt), c.amount]),
  ];

  const BOM = "﻿";
  const csv = `${BOM}${lines.map((row) => row.map(escapeCsv).join(";")).join("\r\n")}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `gestion-${filters.from}_${filters.to}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const EXPORT_BUTTON =
  "inline-flex items-center gap-2 rounded-[7px] border border-stroke bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-primary hover:text-primary dark:border-dark-3 dark:bg-gray-dark dark:text-dark-6";

const POSITIVE = "text-emerald-700 dark:text-emerald-400";
const NEGATIVE = "text-red-700 dark:text-red-400";

function signTint(value) {
  if (value == null) return "";
  return value < 0 ? NEGATIVE : POSITIVE;
}

export function GestionClient({ data }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [, startRefresh] = useTransition();
  const [modal, setModal] = useState({ open: false, expense: null });
  const [showCashExpenses, setShowCashExpenses] = useState(false);

  const { filters, summary, categories, months, expenses, cashExpenses, truncated } = data;
  const isWholeSalon = filters.category === "ALL";
  // Excel / PDF are re-built server-side for exactly the period and category on screen.
  const exportQuery = new URLSearchParams({ from: filters.from, to: filters.to, category: filters.category }).toString();
  const headline = isWholeSalon ? summary.netProfitHt : summary.grossMarginHt;

  async function handleDelete(expense) {
    const ok = await confirm(`Supprimer la charge « ${expense.label} » ? Elle ne sera plus déduite d'aucune période.`, {
      title: "Supprimer la charge",
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    const result = await deleteSalonExpense(expense.id);
    if (!result.success) return toast.error(result.message);
    toast.success(result.message);
    startRefresh(() => router.refresh());
  }

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-wrap justify-end gap-2 print:hidden">
        <button
          type="button"
          onClick={() => setModal({ open: true, expense: null })}
          className="inline-flex items-center gap-2 rounded-[7px] bg-[#2f3a2e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#232b22]"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Ajouter une charge
        </button>
        <a
          href={`/api/gestion/export?${exportQuery}`}
          className={EXPORT_BUTTON}
        >
          <FileSpreadsheet className="h-4 w-4" strokeWidth={2} />
          Exporter Excel (.xlsx)
        </a>
        <button type="button" onClick={() => downloadGestionCsv(data)} className={EXPORT_BUTTON}>
          <Download className="h-4 w-4" strokeWidth={2} />
          Exporter CSV
        </button>
        <a
          href={`/api/gestion/pdf?${exportQuery}`}
          target="_blank"
          rel="noopener noreferrer"
          className={EXPORT_BUTTON}
        >
          <Printer className="h-4 w-4" strokeWidth={2} />
          Imprimer (PDF)
        </a>
      </div>

      {truncated && (
        <div
          role="alert"
          className="rounded-[10px] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          Période trop large — seules les 5 000 premières recettes sont comptées. Réduisez la période pour un résultat
          exact.
        </div>
      )}

      {summary.itemsWithoutCost > 0 && (
        <div
          role="status"
          className="rounded-[10px] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <p>
            {summary.itemsWithoutCost} article{summary.itemsWithoutCost > 1 ? "s" : ""} vendu
            {summary.itemsWithoutCost > 1 ? "s" : ""} sans prix d&apos;achat renseigné : leur coût est compté à 0 €, la
            marge est donc surestimée. Complétez le prix d&apos;achat des produits ci-dessous — la marge se recalcule
            aussitôt, ventes passées comprises.
          </p>
          {summary.productsWithoutCost?.length > 0 && (
            <ul className="mt-2 divide-y divide-amber-200/70 rounded-md border border-amber-200 bg-white/60 dark:divide-amber-500/20 dark:border-amber-500/30 dark:bg-transparent">
              {summary.productsWithoutCost.map((product) => (
                <li key={product.variantId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="font-semibold">{product.productName}</span>
                    {product.variantName && <span> — {product.variantName}</span>}
                    <span className="text-amber-700/80 dark:text-amber-200/70">
                      {" "}
                      · {product.quantity} vendu{product.quantity > 1 ? "s" : ""}
                      {product.orderNumbers.length > 0 &&
                        ` (commande${product.orderNumbers.length > 1 ? "s" : ""} n° ${product.orderNumbers.join(", ")})`}
                    </span>
                  </span>
                  {product.productId && (
                    <Link
                      href={`/dashboard/boutique/products/${product.productId}`}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-transparent dark:text-amber-200"
                    >
                      <Pencil className="h-3 w-3" strokeWidth={2} />
                      Compléter le prix d&apos;achat
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Result ────────────────────────────────────────────────────────── */}
      <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card print:shadow-none">
        <p className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6">
          {isWholeSalon ? "Bénéfice net du salon (HT)" : `Marge brute — ${filters.categoryLabel} (HT)`}
        </p>
        <p className={`mt-1 text-4xl font-bold tabular-nums ${signTint(headline)}`}>{formatEuro(headline)}</p>
        <p className="mt-1 text-sm text-gray-500 dark:text-dark-6">
          du {formatDate(filters.from)} au {formatDate(filters.to)}
          {isWholeSalon && summary.netMarginRate != null && ` · ${formatRate(summary.netMarginRate)} du chiffre d'affaires`}
        </p>

        <dl className="mt-5 grid grid-cols-1 gap-y-1.5 text-sm sm:max-w-md">
          {/* From what clients paid (TTC) down to the HT base the margin is
              computed on: the TVA is the State's money, not the salon's. */}
          <BreakdownLine label="Chiffre d'affaires TTC (encaissé)" value={summary.revenueTtc} />
          <BreakdownLine label="TVA collectée (reversée à l'État)" value={-summary.revenueVat} />
          <BreakdownLine label="Chiffre d'affaires HT" value={summary.revenueHt} strong />
          <BreakdownLine label="Coût d'achat des produits vendus" value={-summary.costHt} />
          <BreakdownLine label="Marge brute" value={summary.grossMarginHt} strong />
          {isWholeSalon ? (
            <>
              <BreakdownLine
                label="Charges du salon (HT)"
                value={-summary.chargesHt}
                hint={summary.chargesTtc !== summary.chargesHt ? `${formatEuro(summary.chargesTtc)} TTC` : null}
              />
              <BreakdownLine label="Dépenses de caisse" value={-summary.cashExpenses} />
              <BreakdownLine label="Bénéfice net" value={summary.netProfitHt} strong />
            </>
          ) : (
            <div className="pt-2 text-xs text-gray-400">
              Les charges du salon ne sont pas réparties par catégorie : choisissez « Toutes les catégories » pour voir
              le bénéfice net.
            </div>
          )}
        </dl>
      </div>

      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4 print:gap-2">
        {/* What the clients actually paid, TVA included — the figure that
            matches the Livre de recettes and the bank/till totals. */}
        <StatCard
          icon={<Wallet size={20} />}
          label="Chiffre d'affaires TTC"
          value={formatEuro(summary.revenueTtc)}
          note="Encaissé, TVA comprise"
        />
        <StatCard
          icon={<Landmark size={20} />}
          label="TVA collectée"
          value={formatEuro(summary.revenueVat)}
          note="À reverser à l'État — ne fait pas partie de la marge"
        />
        <StatCard
          icon={<Euro size={20} />}
          label="Chiffre d'affaires HT"
          value={formatEuro(summary.revenueHt)}
          note="TTC − TVA : la base de la marge"
        />
        <StatCard icon={<Package size={20} />} label="Coût des produits vendus" value={formatEuro(summary.costHt)} />
        <StatCard
          icon={<TrendingUp size={20} />}
          label="Marge brute"
          value={formatEuro(summary.grossMarginHt)}
          note={summary.grossMarginRate != null ? `${formatRate(summary.grossMarginRate)} du CA` : null}
        />
        <StatCard
          icon={<Receipt size={20} />}
          label="Charges du salon (HT)"
          value={formatEuro(summary.chargesHt)}
          note={`${formatEuro(summary.chargesTtc)} TTC`}
        />
        <StatCard icon={<Banknote size={20} />} label="Dépenses de caisse" value={formatEuro(summary.cashExpenses)} />
        <StatCard
          icon={<Percent size={20} />}
          label="Marge nette"
          value={isWholeSalon ? formatRate(summary.netMarginRate) : "—"}
        />
      </div>

      {/* ── By category ───────────────────────────────────────────────────── */}
      <Section title="Par catégorie" subtitle="Produits, rendez-vous, ateliers, formations, loyers staff…">
        {categories.length === 0 ? (
          <Empty>Aucune recette sur cette période.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Catégorie</TableHead>
                <TableHead className="text-right">Écritures</TableHead>
                <TableHead className="text-right">CA HT</TableHead>
                <TableHead className="text-right">Coût produits</TableHead>
                <TableHead className="text-right">Marge brute</TableHead>
                <TableHead className="text-right">Taux</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((cat) => (
                <TableRow key={cat.category}>
                  <TableCell className="font-medium">{cat.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{cat.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(cat.revenueHt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{cat.costHt ? formatEuro(cat.costHt) : "—"}</TableCell>
                  <TableCell className={`text-right font-semibold tabular-nums ${signTint(cat.marginHt)}`}>
                    {formatEuro(cat.marginHt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatRate(cat.marginRate)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-stroke bg-neutral-50 font-semibold dark:border-dark-3 dark:bg-dark-2">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">{categories.reduce((n, c) => n + c.count, 0)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatEuro(summary.revenueHt)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatEuro(summary.costHt)}</TableCell>
                <TableCell className={`text-right tabular-nums ${signTint(summary.grossMarginHt)}`}>
                  {formatEuro(summary.grossMarginHt)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatRate(summary.grossMarginRate)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Section>

      {/* ── By month ──────────────────────────────────────────────────────── */}
      <Section title="Par mois">
        {months.length === 0 ? (
          <Empty>Rien sur cette période.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mois</TableHead>
                <TableHead className="text-right">CA TTC</TableHead>
                <TableHead className="text-right">TVA</TableHead>
                <TableHead className="text-right">CA HT</TableHead>
                <TableHead className="text-right">Coût produits</TableHead>
                <TableHead className="text-right">Marge brute</TableHead>
                <TableHead className="text-right">Charges HT</TableHead>
                <TableHead className="text-right">Dépenses caisse</TableHead>
                <TableHead className="text-right">Bénéfice net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {months.map((m) => (
                <TableRow key={m.month}>
                  <TableCell className="font-medium">{formatMonthKey(m.month)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(m.revenueTtc)}</TableCell>
                  <TableCell className="text-right tabular-nums text-gray-500 dark:text-dark-6">{formatEuro(m.revenueVat)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(m.revenueHt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(m.costHt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(m.grossMarginHt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(m.chargesHt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(m.cashExpenses)}</TableCell>
                  <TableCell className={`text-right font-semibold tabular-nums ${signTint(m.netProfitHt)}`}>
                    {m.netProfitHt == null ? "—" : formatEuro(m.netProfitHt)}
                  </TableCell>
                </TableRow>
              ))}
              {months.length > 1 && (
                <TableRow className="border-t-2 border-stroke bg-neutral-50 font-semibold dark:border-dark-3 dark:bg-dark-2">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(summary.revenueTtc)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(summary.revenueVat)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(summary.revenueHt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(summary.costHt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(summary.grossMarginHt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(summary.chargesHt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatEuro(summary.cashExpenses)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${signTint(summary.netProfitHt)}`}>
                    {summary.netProfitHt == null ? "—" : formatEuro(summary.netProfitHt)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Section>

      {/* ── Salon charges ─────────────────────────────────────────────────── */}
      <Section
        title="Charges du salon"
        subtitle="Loyer, électricité, eau, internet… Une charge mensuelle est comptée en entier pour chaque mois de la période."
        action={
          <button
            type="button"
            onClick={() => setModal({ open: true, expense: null })}
            className="inline-flex items-center gap-1.5 rounded-[7px] border border-stroke px-3 py-1.5 text-sm font-semibold text-gray-600 hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6 print:hidden"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            Ajouter
          </button>
        }
      >
        {expenses.length === 0 ? (
          <Empty>Aucune charge sur cette période. Ajoutez le loyer, l&apos;électricité, l&apos;eau, internet…</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Libellé</TableHead>
                <TableHead>Date / période</TableHead>
                <TableHead className="text-right">Montant TTC</TableHead>
                <TableHead className="text-right">TVA</TableHead>
                <TableHead className="text-right">Sur la période (HT)</TableHead>
                <TableHead className="w-20 print:hidden" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((expense) => (
                <TableRow key={expense.id}>
                  <TableCell className="whitespace-nowrap font-medium">{expense.categoryLabel}</TableCell>
                  <TableCell className="max-w-[240px]">
                    <span className="block truncate">{expense.label}</span>
                    {expense.note && <span className="block truncate text-xs text-gray-400">{expense.note}</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {expense.isRecurring && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(47,58,46,0.08)] px-2 py-0.5 text-[11px] font-semibold text-[#2f3a2e] dark:bg-[#FFFFFF1A] dark:text-white">
                          <Repeat size={11} />
                          Mensuel
                        </span>
                      )}
                      {describePeriod(expense)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatEuro(expense.amountTtc)}
                    {expense.isRecurring && <span className="text-xs text-gray-400"> /mois</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{expense.vatRate} %</TableCell>
                  <TableCell className={`text-right font-semibold tabular-nums ${NEGATIVE}`}>
                    −{formatEuro(expense.periodAmountHt)}                  </TableCell>
                  <TableCell className="print:hidden">
                    <div className="flex justify-end gap-1">
                      <IconButton label="Modifier" onClick={() => setModal({ open: true, expense })}>
                        <Pencil size={15} />
                      </IconButton>
                      <IconButton label="Supprimer" danger onClick={() => handleDelete(expense)}>
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-stroke bg-neutral-50 font-semibold dark:border-dark-3 dark:bg-dark-2">
                <TableCell colSpan={5}>Total des charges sur la période</TableCell>
                <TableCell className={`text-right tabular-nums ${NEGATIVE}`}>−{formatEuro(summary.chargesHt)}</TableCell>
                <TableCell className="print:hidden" />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Section>

      {/* ── Till expenses ─────────────────────────────────────────────────── */}
      <Section
        title={`Dépenses de caisse — ${formatEuro(summary.cashExpenses)}`}
        subtitle="Sorties « Dépense » enregistrées dans le Livre de caisse. Montant déduit en entier (pas de détail de TVA)."
        action={
          cashExpenses.length > 0 && (
            <button
              type="button"
              onClick={() => setShowCashExpenses((v) => !v)}
              className="inline-flex items-center gap-1 text-sm font-semibold text-gray-500 hover:text-primary dark:text-dark-6 print:hidden"
            >
              <ChevronRight size={15} className={`transition-transform ${showCashExpenses ? "rotate-90" : ""}`} />
              {showCashExpenses ? "Masquer" : `Voir (${cashExpenses.length})`}
            </button>
          )
        }
      >
        {cashExpenses.length === 0 ? (
          <Empty>Aucune dépense de caisse sur cette période.</Empty>
        ) : (
          showCashExpenses && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Pièce</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cashExpenses.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatDate(movement.occurredAt)}</TableCell>
                    <TableCell className="whitespace-nowrap text-gray-500 dark:text-dark-6">{movement.pieceNumber}</TableCell>
                    <TableCell>{movement.label}</TableCell>
                    <TableCell className={`text-right tabular-nums ${NEGATIVE}`}>−{formatEuro(movement.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        )}
      </Section>

      <SalonExpenseModal
        open={modal.open}
        expense={modal.expense}
        onClose={() => setModal({ open: false, expense: null })}
        onSaved={() => {
          setModal({ open: false, expense: null });
          startRefresh(() => router.refresh());
        }}
      />
    </div>
  );
}

function BreakdownLine({ label, value, strong = false, hint = null }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-6 ${
        strong ? "border-t border-stroke pt-1.5 font-semibold text-dark dark:border-dark-3 dark:text-white" : "text-gray-600 dark:text-dark-6"
      }`}
    >
      <dt>
        {label}
        {hint && <span className="ml-1.5 text-xs font-normal text-gray-400">({hint})</span>}
      </dt>
      <dd className={`tabular-nums ${strong ? signTint(value) : ""}`}>{value == null ? "—" : formatEuro(value)}</dd>
    </div>
  );
}

function Section({ title, subtitle, action, children }) {
  return (
    <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card print:border-0 print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-stroke px-6 py-4 dark:border-dark-3 print:px-0">
        <div>
          <h2 className="text-lg font-bold text-dark dark:text-white">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-gray-500 dark:text-dark-6">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return <p className="px-6 py-10 text-center text-sm text-gray-400">{children}</p>;
}

function IconButton({ label, onClick, danger = false, children }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`rounded-md p-1.5 text-gray-400 transition-colors ${
        danger ? "hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10" : "hover:bg-neutral-100 hover:text-dark dark:hover:bg-dark-2 dark:hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function StatCard({ icon, label, value, note }) {
  return (
    <div className="flex items-center gap-4 rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card print:gap-2 print:p-2 print:shadow-none">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgba(47,58,46,0.08)] text-[#2f3a2e] dark:bg-[#FFFFFF1A] dark:text-white print:hidden">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-dark dark:text-white print:text-base">{value}</p>
        <p className="truncate text-sm text-gray-500 dark:text-dark-6">{label}</p>
        {note && <p className="text-xs text-gray-400">{note}</p>}
      </div>
    </div>
  );
}
