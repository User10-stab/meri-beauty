"use client";

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

export function CustomersPageClient({ initialCustomers }) {
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
      data={initialCustomers}
      columns={CUSTOMERS_COLUMNS}
      renderRow={(props) => <CustomerRow {...props} />}
      onView={handleView}
      onEdit={handleEdit}
      onDelete={handleDelete}
      searchPlaceholder="Rechercher par nom, email ou téléphone..."
      searchFilter={(row, query) =>
        row.fullName?.toLowerCase().includes(query) ||
        row.email?.toLowerCase().includes(query) ||
        row.phone?.toLowerCase().includes(query)
      }
    />
  );
}