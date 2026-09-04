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
  { key: "lastLogin", label: "Dernière connexion" },
];

const PAGE_SIZE = 20;

export function CustomersPageClient({ initialCustomers, initialTotalCount, userRole }) {
  const isAdmin = userRole === "OWNER" || userRole === "ADMIN";
  const [customers, setCustomers] = useState(initialCustomers);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [isLoading, startTransition] = useTransition();
  const [viewingCustomerId, setViewingCustomerId] = useState(null);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [deletingCustomer, setDeletingCustomer] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  function fetchPage({ nextPage = page, nextPageSize = pageSize, nextSearch = search } = {}) {
    startTransition(async () => {
      const result = await getCustomers({ search: nextSearch || undefined, page: nextPage, pageSize: nextPageSize });
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

  return (
    <>
      <DataTable
        data={customers}
        isLoading={isLoading}
        columns={CUSTOMERS_COLUMNS}
        renderRow={(props) => <CustomerRow {...props} />}
        onView={handleView}
        onEdit={isAdmin ? handleEdit : undefined}
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
