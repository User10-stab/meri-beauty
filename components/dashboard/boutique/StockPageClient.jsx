"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, AlertTriangle, Boxes, History } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StockAdjustDialog } from "@/components/dashboard/boutique/StockAdjustDialog";
import { StockHistoryDrawer } from "@/components/dashboard/boutique/StockHistoryDrawer";

export function StockPageClient({ initialVariants }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [adjusting, setAdjusting] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialVariants.filter((v) => {
      if (lowStockOnly && !v.isLowStock) return false;
      if (!q) return true;
      const hay = `${v.product.name} ${v.name} ${v.sku} ${v.barcode ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [initialVariants, search, lowStockOnly]);

  return (
    <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex flex-col gap-3 border-b border-stroke px-6 py-4 dark:border-dark-3 sm:flex-row sm:items-center">
        <div className="relative w-full max-w-xs">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Produit, référence, code-barres…"
            className="h-9 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
          Stock bas uniquement
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Boxes size={22} className="text-gray-300" />
          <p className="font-medium text-gray-700">
            {initialVariants.length === 0 ? "Aucune déclinaison pour le moment" : "Rien ne correspond à ces filtres"}
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Produit</TableHead>
              <TableHead>Référence</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead>Réservé</TableHead>
              <TableHead>Disponible</TableHead>
              <TableHead className="pr-6 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((v) => (
              <TableRow key={v.id} className={v.isLowStock ? "bg-amber-50/40" : ""}>
                <TableCell className="pl-6">
                  <div className="font-medium text-gray-800 dark:text-white">{v.product.name}</div>
                  <div className="text-xs text-gray-400">{v.name}</div>
                </TableCell>
                <TableCell>
                  <div className="text-gray-600 dark:text-dark-6">{v.sku}</div>
                  {v.barcode && <div className="text-xs text-gray-400">{v.barcode}</div>}
                </TableCell>
                <TableCell>
                  <span className="font-medium text-gray-700 dark:text-dark-6">{v.stockQuantity}</span>
                </TableCell>
                <TableCell>
                  <span className="text-gray-500">{v.reservedQuantity}</span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-gray-700 dark:text-dark-6">{v.availableQuantity}</span>
                    {v.isLowStock && (
                      <span title={`Seuil bas : ${v.lowStockThreshold}`}>
                        <AlertTriangle size={14} className="text-amber-500" />
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="pr-6">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setHistoryFor(v)}
                      title="Historique des mouvements"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                    >
                      <History size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdjusting(v)}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      Ajuster
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <StockAdjustDialog
        variant={adjusting}
        onClose={() => setAdjusting(null)}
        onAdjusted={() => {
          setAdjusting(null);
          router.refresh();
        }}
      />

      <StockHistoryDrawer variant={historyFor} onClose={() => setHistoryFor(null)} />
    </div>
  );
}
