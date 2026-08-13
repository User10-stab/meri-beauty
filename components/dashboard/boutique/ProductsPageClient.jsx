"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, Plus, Upload, AlertTriangle, Package, ScanLine } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RowActions } from "@/components/dashboard/Tables/RowActions";
import { ProductScanDialog } from "@/components/dashboard/boutique/ProductScanDialog";
import { deleteProduct } from "@/actions/boutique/products";
import { useTranslations } from "next-intl";

const STATUS_STYLE = {
  DRAFT: "bg-gray-100 text-gray-600 border-gray-200",
  ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-100",
  ARCHIVED: "bg-amber-50 text-amber-700 border-amber-100",
};

function formatPrice(n) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(n);
}

/** A product can have several variants at different prices — show a range. */
function priceRange(variants) {
  if (!variants.length) return "—";
  const prices = variants.map((v) => v.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatPrice(min) : `${formatPrice(min)} – ${formatPrice(max)}`;
}

export function ProductsPageClient({ initialProducts, brands, isAdmin = false }) {
  const router = useRouter();
  const t = useTranslations("dashboardBoutique.products");
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [toDelete, setToDelete] = useState(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const STATUS_LABEL = {
    DRAFT: t("status.DRAFT"),
    ACTIVE: t("status.ACTIVE"),
    ARCHIVED: t("status.ARCHIVED"),
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initialProducts.filter((p) => {
      if (q) {
        const hay = `${p.name} ${p.brand?.name ?? ""} ${p.variants.map((v) => v.sku).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (brandFilter && p.brand?.id !== brandFilter) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      return true;
    });
  }, [initialProducts, search, brandFilter, statusFilter]);

  function handleDelete() {
    if (!toDelete) return;
    startTransition(async () => {
      const result = await deleteProduct(toDelete.id);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
      setToDelete(null);
    });
  }

  return (
    <div className="flex h-[75vh] flex-col rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      {/* Toolbar — Wix-style: search + filters on the left, primary action on the right */}
      <div className="flex shrink-0 flex-col gap-3 border-b border-stroke px-6 py-4 dark:border-dark-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-9 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>

          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          >
            <option value="">{t("allBrands")}</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          >
            <option value="">{t("allStatuses")}</option>
            <option value="ACTIVE">{t("status.ACTIVE")}</option>
            <option value="DRAFT">{t("status.DRAFT")}</option>
            <option value="ARCHIVED">{t("status.ARCHIVED")}</option>
          </select>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setScanOpen(true)}
              className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
            >
              <ScanLine size={16} />
              {t("scanner")}
            </button>
            <Link href="/dashboard/boutique/products/import">
              <button
                type="button"
                className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
              >
                <Upload size={16} />
                {t("importFromWix")}
              </button>
            </Link>
            <Link href="/dashboard/boutique/products/new">
              <Button>
                <Plus size={16} />
                {t("addProduct")}
              </Button>
            </Link>
          </div>
        )}
      </div>

      {isAdmin && (
        <ProductScanDialog
          open={scanOpen}
          onClose={() => setScanOpen(false)}
          onFound={(productId) => {
            setScanOpen(false);
            router.push(`/dashboard/boutique/products/${productId}`);
          }}
          onNotFound={(code) => {
            setScanOpen(false);
            router.push(`/dashboard/boutique/products/new?barcode=${encodeURIComponent(code)}`);
          }}
        />
      )}

      {filtered.length === 0 ? (
        <EmptyState hasProducts={initialProducts.length > 0} isAdmin={isAdmin} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">{t("tableHeaders.product")}</TableHead>
              <TableHead>{t("tableHeaders.category")}</TableHead>
              <TableHead>{t("tableHeaders.price")}</TableHead>
              <TableHead>{t("tableHeaders.stock")}</TableHead>
              <TableHead>{t("tableHeaders.status")}</TableHead>
              <TableHead className="pr-6 text-right">{t("tableHeaders.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p) => (
              <TableRow
                key={p.id}
                className={isAdmin ? "cursor-pointer" : ""}
                onClick={isAdmin ? () => router.push(`/dashboard/boutique/products/${p.id}`) : undefined}
              >
                <TableCell className="pl-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-100 bg-gray-50">
                      {p.thumbnail ? (
                        <img src={p.thumbnail} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Package size={16} className="text-gray-300" />
                      )}
                    </div>
                    <div>
                      <div className="font-medium text-gray-800 dark:text-white">{p.name}</div>
                      <div className="text-xs text-gray-400">
                        {p.brand?.name ?? t("noBrand")} · {p.variants.length} {p.variants.length > 1 ? t("variants_plural") : t("variants")}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-gray-600 dark:text-dark-6">{p.category?.name ?? "—"}</span>
                  <span className="block text-xs text-gray-400">{p.subcategory?.name ?? ""}</span>
                </TableCell>
                <TableCell>
                  <span className="font-medium text-gray-700 dark:text-dark-6">{priceRange(p.variants)}</span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-gray-700 dark:text-dark-6">{p.totalStock}</span>
                    {p.lowStock && (
                      <span title={t("lowStockTooltip")}>
                        <AlertTriangle size={14} className="text-amber-500" />
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[p.status]}`}>
                    {STATUS_LABEL[p.status]}
                  </span>
                </TableCell>
                <TableCell className="pr-6" onClick={(e) => e.stopPropagation()}>
                  {isAdmin && (
                    <RowActions
                      row={p}
                      onEdit={() => router.push(`/dashboard/boutique/products/${p.id}`)}
                      onDelete={() => setToDelete(p)}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title={t("deleteConfirm")}
        message={
          toDelete
            ? t("deleteMessage", { name: toDelete.name })
            : ""
        }
        confirmLabel={t("deleteButton")}
        danger
        loading={isPending}
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

function EmptyState({ hasProducts, isAdmin }) {
  const t = useTranslations("dashboardBoutique.products.emptyState");
  const tProducts = useTranslations("dashboardBoutique.products");
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-50">
        <Package size={22} className="text-gray-300" />
      </div>
      <div>
        <p className="font-medium text-gray-700">
          {hasProducts ? t("noMatch") : t("noProducts")}
        </p>
        <p className="mt-1 text-sm text-gray-400">
          {hasProducts
            ? t("tryOtherFilters")
            : t("addFirst")}
        </p>
      </div>
      {!hasProducts && isAdmin && (
        <Link href="/dashboard/boutique/products/new">
          <Button className="mt-2">
            <Plus size={16} />
            {tProducts("addProduct")}
          </Button>
        </Link>
      )}
    </div>
  );
}
