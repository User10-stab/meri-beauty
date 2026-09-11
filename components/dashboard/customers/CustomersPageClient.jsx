"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { getCustomers } from "@/actions/customers/get-customers";
import { deleteCustomer } from "@/actions/customers/delete-customer";
import { DataTable } from "../Tables/DataTable";
import { CustomerRow } from "./CustomerRow";
import { CustomerDetailsDrawer } from "./CustomerDetailsDrawer";
import { CustomerEditModal } from "./CustomerEditModal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

const CUSTOMERS_COLUMNS = [
  { key: "fullName", label: "Nom complet" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Téléphone" },
  { key: "clientType", label: "Type" },
  { key: "vatNumber", label: "N° TVA" },
  { key: "appointmentsCount", label: "Rendez-vous" },
  { key: "formationsCount", label: "Formations" },
  { key: "isActive", label: "Statut" },
  { key: "joinedAt", label: "Inscrit le" },
];

const PAGE_SIZE = 20;

/**
 * @param {object} props
 * @param {string} [props.initialCreatedMonth] - Deep-link preset ("YYYY-MM",
 *   e.g. from the dashboard "new customers" card): only customers created
 *   in that month are listed until cleared.
 * @param {string} [props.initialStaffId] - Deep-link preset: scope to one
 *   staff member's customers (admins only — enforced server-side).
 * @param {string|null} [props.initialStaffName] - Display name for the preset.
 */
export function CustomersPageClient({ initialCustomers, initialTotalCount, userRole, initialCreatedMonth = "", initialStaffId = "", initialStaffName = null }) {
  const isAdmin = userRole === "OWNER" || userRole === "ADMIN";
  // Edit is allowed for any dashboard user who can view customers (OWNER/ADMIN always,
  // STAFF when they hold the CUSTOMERS capability — the page itself is already gated
  // by requireDashboardPermission(CUSTOMERS), so reaching here implies they can read;
  // the server action re-checks the write permission + per-customer scope).
  const canEdit = userRole === "OWNER" || userRole === "ADMIN" || userRole === "STAFF";
  const [customers, setCustomers] = useState(initialCustomers);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [createdMonth, setCreatedMonth] = useState(initialCreatedMonth);
  const [staffId, setStaffId] = useState(initialStaffId);
  const [isLoading, startTransition] = useTransition();
  const [viewingCustomerId, setViewingCustomerId] = useState(null);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [deletingCustomer, setDeletingCustomer] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  function fetchPage({ nextPage = page, nextPageSize = pageSize, nextSearch = search, nextCreatedMonth = createdMonth, nextStaffId = staffId } = {}) {
    startTransition(async () => {
      const result = await getCustomers({
        search: nextSearch || undefined,
        page: nextPage,
        pageSize: nextPageSize,
        createdMonth: nextCreatedMonth || undefined,
        staffId: nextStaffId || undefined,
      });
      if (result.success) {
        setCustomers(result.data);
        setTotalCount(result.totalCount);
        setPage(nextPage);
        setPageSize(nextPageSize);
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleSearchChange(value) {
    setSearch(value);
    fetchPage({ nextPage: 1, nextSearch: value });
  }

  function handlePageChange(nextPage) {
    fetchPage({ nextPage });
  }

  function handlePerPageChange(nextPageSize) {
    fetchPage({ nextPage: 1, nextPageSize });
  }

  function handleView(customer) {
    setViewingCustomerId(customer.id);
  }

  function handleEdit(customer) {
    setEditingCustomer(customer);
  }

  function handleDelete(customer) {
    setDeletingCustomer(customer);
  }

  function handleSaved() {
    setEditingCustomer(null);
    fetchPage();
  }

  async function confirmDelete() {
    if (!deletingCustomer) return;
    setIsDeleting(true);
    const result = await deleteCustomer(deletingCustomer.id);
    setIsDeleting(false);
    setDeletingCustomer(null);
    if (result.success) {
      toast.success(result.message);
      fetchPage();
    } else {
      toast.error(result.message);
    }
  }

  function clearLinkedFilters() {
    setCreatedMonth("");
    setStaffId("");
    fetchPage({ nextPage: 1, nextCreatedMonth: "", nextStaffId: "" });
  }

  const hasLinkedFilters = Boolean(createdMonth || staffId);

  return (
    <>
      {/* Deep-linked presets from a dashboard card, shown until cleared. */}
      {/* {hasLinkedFilters && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[10px] border border-indigo-200 bg-indigo-50/50 px-4 py-2.5 text-xs text-indigo-800 dark:border-indigo-900/40 dark:bg-indigo-900/10 dark:text-indigo-300">
          <span className="font-medium">
            Filtres liés{createdMonth ? ` · inscrits en ${createdMonth}` : ""}{staffId ? ` · ${initialStaffName ?? "prestataire filtré"}` : ""}
          </span>
          <button
            type="button"
            onClick={clearLinkedFilters}
            className="rounded-md border border-indigo-200 bg-white px-2 py-1 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-900/40 dark:bg-transparent dark:text-indigo-300"
          >
            Effacer
          </button>
        </div>
      )} */}
      <DataTable
        data={customers}
        isLoading={isLoading}
        columns={CUSTOMERS_COLUMNS}
        renderRow={(props) => <CustomerRow {...props} />}
        onView={handleView}
        onEdit={canEdit ? handleEdit : undefined}
        onDelete={isAdmin ? handleDelete : undefined}
        searchPlaceholder="Rechercher par nom, email ou téléphone..."
        serverPagination={{
          page,
          pageSize,
          totalCount,
          onPageChange: handlePageChange,
          onPerPageChange: handlePerPageChange,
        }}
        onSearchChange={handleSearchChange}
      />

      <CustomerDetailsDrawer customerId={viewingCustomerId} onClose={() => setViewingCustomerId(null)} />

      <CustomerEditModal
        customer={editingCustomer}
        onClose={() => setEditingCustomer(null)}
        onSaved={handleSaved}
      />

      <ConfirmDialog
        open={Boolean(deletingCustomer)}
        title="Supprimer ce client ?"
        message={`${deletingCustomer?.fullName ?? ""} sera désactivé et ne pourra plus se connecter. Ses rendez-vous et commandes restent conservés.`}
        confirmLabel="Supprimer"
        danger
        loading={isDeleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeletingCustomer(null)}
      />
    </>
  );
}
