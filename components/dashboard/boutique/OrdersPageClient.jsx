"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, ScanLine, Camera, Package, Loader2 } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import Button from "@/components/ui/Button";
import { PickupScannerDialog } from "@/components/dashboard/boutique/PickupScannerDialog";
import { Pagination } from "@/components/dashboard/Tables/Pagination";
import { listOrders } from "@/actions/boutique/orders";

const PAGE_SIZE = 20;

const MODE_LABEL = {
  PICKUP_PREPAID: "Retrait (payé)",
  PICKUP_ON_SITE: "Retrait (sur place)",
  SHIPPING_PREPAID: "Livraison",
};

const STATUS_LABEL = {
  PENDING_PAYMENT: "Paiement en attente",
  PENDING_PICKUP: "En attente de retrait",
  PAID: "Payée",
  PROCESSING: "En préparation",
  READY_FOR_PICKUP: "Prête pour retrait",
  SHIPPED: "Expédiée",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
  EXPIRED: "Expirée",
};

const STATUS_STYLE = {
  PENDING_PAYMENT: "bg-gray-100 text-gray-600 border-gray-200",
  PENDING_PICKUP: "bg-amber-50 text-amber-700 border-amber-100",
  PAID: "bg-blue-50 text-blue-700 border-blue-100",
  PROCESSING: "bg-blue-50 text-blue-700 border-blue-100",
  READY_FOR_PICKUP: "bg-emerald-50 text-emerald-700 border-emerald-100",
  SHIPPED: "bg-emerald-50 text-emerald-700 border-emerald-100",
  COMPLETED: "bg-gray-100 text-gray-500 border-gray-200",
  CANCELLED: "bg-red-50 text-red-600 border-red-100",
  EXPIRED: "bg-red-50 text-red-600 border-red-100",
};

function formatPrice(n) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(n);
}

export function OrdersPageClient({ initialOrders, initialTotalCount }) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [pickupLookup, setPickupLookup] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function refetch(next) {
    const params = {
      search: next.search !== undefined ? next.search : search,
      status: next.status !== undefined ? next.status : statusFilter,
      mode: next.mode !== undefined ? next.mode : modeFilter,
      page: next.page !== undefined ? next.page : 1,
    };
    startTransition(async () => {
      const result = await listOrders({
        search: params.search || undefined,
        status: params.status || undefined,
        fulfilmentMode: params.mode || undefined,
        page: params.page,
        pageSize: PAGE_SIZE,
      });
      if (result.success) {
        setOrders(result.data);
        setTotalCount(result.totalCount);
        setPage(params.page);
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    refetch({ search });
  }

  const lookupByPickupCode = useCallback(
    async (rawCode) => {
      const code = rawCode.trim().toUpperCase();
      if (!code) return;
      // The current page may not contain the order the code belongs to
      // (pagination) — search the server directly by pickup code instead
      // of only checking the page's already-loaded rows.
      const result = await listOrders({ search: code, page: 1, pageSize: 1 });
      const order = result.data?.find((o) => o.pickupCode === code);
      if (!order) {
        toast.error("Aucune commande ne correspond à ce code.");
        return;
      }
      router.push(`/dashboard/boutique/orders/${order.id}`);
    },
    [router]
  );

  function handlePickupLookup(e) {
    e.preventDefault();
    lookupByPickupCode(pickupLookup);
  }

  function handleScanned(code) {
    setScannerOpen(false);
    lookupByPickupCode(code);
  }

  return (
    <div className="space-y-4">
      {/* Pickup code quick-lookup — manual entry or camera scan of the customer's QR */}
      <div className="flex items-center gap-3 rounded-[10px] border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <ScanLine size={18} className="flex-shrink-0 text-[#2f3a2e]" />
        <form onSubmit={handlePickupLookup} className="flex flex-1 items-center gap-2">
          <input
            type="text"
            value={pickupLookup}
            onChange={(e) => setPickupLookup(e.target.value)}
            placeholder="Code de retrait client (ex : A3F9C1B2)"
            className="h-9 flex-1 rounded-lg border border-gray-200 px-3 text-sm uppercase tracking-wide text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          />
          <Button type="submit">Vérifier</Button>
          <Button type="button" onClick={() => setScannerOpen(true)}>
            <Camera size={14} />
            Scanner
          </Button>
        </form>
      </div>

      <PickupScannerDialog open={scannerOpen} onClose={() => setScannerOpen(false)} onDecoded={handleScanned} />

      <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3 border-b border-stroke px-6 py-4 dark:border-dark-3 sm:flex-row sm:items-center">
          <div className="relative w-full max-w-xs">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher client, n°, code… (Entrée)"
              className="h-9 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              refetch({ status: e.target.value });
            }}
            className="h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          >
            <option value="">Tous les statuts</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          <select
            value={modeFilter}
            onChange={(e) => {
              setModeFilter(e.target.value);
              refetch({ mode: e.target.value });
            }}
            className="h-9 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          >
            <option value="">Tous les modes</option>
            {Object.entries(MODE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          {isPending && <Loader2 size={16} className="animate-spin text-gray-400" />}
        </form>

        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-50">
              <Package size={22} className="text-gray-300" />
            </div>
            <p className="font-medium text-gray-700">
              {totalCount > 0 ? "Aucune commande ne correspond à votre recherche" : "Aucune commande pour le moment"}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Commande</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Total</TableHead>
                <TableHead className="pr-6">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow
                  key={o.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/dashboard/boutique/orders/${o.id}`)}
                >
                  <TableCell className="pl-6">
                    <span className="font-medium text-gray-800 dark:text-white">n°{o.orderNumber}</span>
                    {o.pickupCode && <span className="block text-xs text-gray-400">{o.pickupCode}</span>}
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-700 dark:text-dark-6">{o.user?.fullName ?? "—"}</span>
                    <span className="block text-xs text-gray-400">{o.user?.email}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-gray-600 dark:text-dark-6">{MODE_LABEL[o.fulfilmentMode]}</span>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[o.status]}`}>
                      {STATUS_LABEL[o.status]}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium text-gray-700 dark:text-dark-6">{formatPrice(o.totalAmount)}</span>
                  </TableCell>
                  <TableCell className="pr-6">
                    <span className="text-gray-500 dark:text-dark-6">
                      {new Date(o.createdAt).toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {totalCount > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-stroke px-6 py-4 dark:border-dark-3">
            <span className="text-xs text-gray-500 dark:text-dark-6">
              {totalCount} commande{totalCount > 1 ? "s" : ""} au total
            </span>
            <Pagination
              currentPage={page}
              totalPages={Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}
              onPageChange={(p) => refetch({ page: p })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
