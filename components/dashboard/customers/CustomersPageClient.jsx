"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { getCustomers } from "@/actions/customers/get-customers";
import { DataTable } from "../Tables/DataTable";
import { CustomerRow } from "./CustomerRow";

const CUSTOMERS_COLUMNS = [
  { key: "fullName", label: "Nom complet" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Téléphone" },
  { key: "appointmentsCount", label: "Rendez-vous" },
  { key: "isActive", label: "Statut" },
  { key: "joinedAt", label: "Inscrit le" },
  { key: "lastLogin", label: "Dernière connexion" },
];

const PAGE_SIZE = 20;

export function CustomersPageClient({ initialCustomers, initialTotalCount }) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [isLoading, startTransition] = useTransition();

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
    // TODO: open customer detail modal or navigate
    console.log("View", customer);
  }

  function handleEdit(customer) {
    // TODO: open edit modal
    console.log("Edit", customer);
  }

  function handleDelete(customer) {
    // TODO: soft-delete
    console.log("Delete", customer);
  }

  return (
    <DataTable
      data={customers}
      isLoading={isLoading}
      columns={CUSTOMERS_COLUMNS}
      renderRow={(props) => <CustomerRow {...props} />}
      onView={handleView}
      onEdit={handleEdit}
      onDelete={handleDelete}
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
  );
}
