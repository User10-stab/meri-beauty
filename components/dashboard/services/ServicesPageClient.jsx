"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "../Tables/DataTable";
import { CategoryRow } from "./CategoryRow";
import { ServiceRow } from "./ServiceRow";
import { CreateServiceModal } from "./CreateServiceModal";
import { AdminServiceCreateForm } from "./forms/AdminServiceCreateForm";
import { StaffServiceCreateForm } from "./forms/StaffServiceCreateForm";
import { CreateCategoryModal } from "./CreateCategoryModal";
import { ServiceDetailsDrawer } from "./ServiceDetailsDrawer";
import { deleteService } from "@/actions/services/create-service";
import { deleteCategory } from "@/actions/services/create-service";
import { useConfirm } from "@/components/ConfirmProvider";
import Button from "@/components/ui/Button";

const CATEGORIES_COLUMNS = [
  { key: "name", label: "Nom" },
  { key: "description", label: "Description" },
  { key: "services", label: "Services associés" },
  { key: "servicesCount", label: "Nombre de services" },
];

const SERVICES_COLUMNS = [
  { key: "name", label: "Service Name" },
  { key: "staffNames", label: "Staff Name(s)" },
  { key: "category", label: "Category" },
  { key: "price", label: "Prix" },
  { key: "duration", label: "Durée" },
  { key: "margin", label: "Marge tampon" },
  { key: "availableDays", label: "Jours" },
];

export function ServicesPageClient({ initialCategories, initialServices, userRole }) {
  const router = useRouter();
  const confirm = useConfirm();
  
  // Staff members can only see the Services tab
  const isAdminOrOwner = userRole === "ADMIN" || userRole === "OWNER";
  const [activeTab, setActiveTab] = useState(isAdminOrOwner ? "categories" : "services");
  const [selectedService, setSelectedService] = useState(null);
  const [editingService, setEditingService] = useState(null);
  const [editingCategory, setEditingCategory] = useState(null);
  const [showManageModal, setShowManageModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAdminCreateModal, setShowAdminCreateModal] = useState(false);
  const [showStaffCreateModal, setShowStaffCreateModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [detailsService, setDetailsService] = useState(null);
  const [isDeleting, startDelete] = useTransition();

  function openManageModal(service) {
    setSelectedService(service);
    setShowManageModal(true);
  }

  // ─── Service handlers ─────────────────────────────────────────────
  function handleEditService(service) {
    setEditingService(service);
    setShowCreateModal(true);
  }

  async function handleDeleteService(service) {
    const isStaffUser = userRole === "STAFF";
    const confirmMessage = isStaffUser
      ? `Retirer « ${service.name} » de votre profil ? Le service restera disponible pour les autres professionnels.`
      : `Supprimer « ${service.name} » ? Il ne sera plus visible dans le système mais les données historiques seront préservées.`;

    if (!(await confirm(confirmMessage, { danger: true }))) return;

    startDelete(async () => {
      const result = await deleteService(service.id);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleServiceModalClose() {
    setShowCreateModal(false);
    setEditingService(null);
  }

  function handleAdminCreateClose() {
    setShowAdminCreateModal(false);
  }

  function handleStaffCreateClose() {
    setShowStaffCreateModal(false);
  }

  // ─── Category handlers ─────────────────────────────────────────────
  function handleEditCategory(category) {
    setEditingCategory(category);
    setShowCategoryModal(true);
  }

  async function handleDeleteCategory(category) {
    if (!(await confirm(`Supprimer la catégorie « ${category.name} » et tous ses services ? Ils ne seront plus visibles mais les données historiques seront préservées.`, { danger: true }))) return;

    startDelete(async () => {
      const result = await deleteCategory(category.id);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleCategoryModalClose() {
    setShowCategoryModal(false);
    setEditingCategory(null);
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200">
        <div className="flex gap-2">
          {isAdminOrOwner && (
            <TabButton
              active={activeTab === "categories"}
              onClick={() => setActiveTab("categories")}
              label="Catégories"
              count={initialCategories.length}
            />
          )}
          <TabButton
            active={activeTab === "services"}
            onClick={() => setActiveTab("services")}
            label="Services"
            count={initialServices.length}
          />
        </div>

        {isAdminOrOwner && activeTab === "categories" && (
          <Button onClick={() => { setEditingCategory(null); setShowCategoryModal(true); }} className="mb-2 bg-[#2f3a2e]">
            <Plus size={16} /> Nouvelle catégorie
          </Button>
        )}

        {activeTab === "services" && (
          <Button
            onClick={() => {
              setEditingService(null);
              if (userRole === "STAFF") setShowStaffCreateModal(true);
              else setShowAdminCreateModal(true);
            }}
            className="mb-2 bg-[#2f3a2e]"
          >
            <Plus size={16} /> Nouveau service
          </Button>
        )}
      </div>

      {/* Table */}
      {activeTab === "categories" ? (
        <>
          <DataTable
            data={initialCategories}
            columns={CATEGORIES_COLUMNS}
            renderRow={CategoryRow}
            onEdit={handleEditCategory}
            onDelete={handleDeleteCategory}
            searchPlaceholder="Rechercher par nom ou description..."
            searchFilter={(row, query) =>
              row.name?.toLowerCase().includes(query) ||
              row.description?.toLowerCase().includes(query)
            }
          />
          <CreateCategoryModal
            open={showCategoryModal}
            onClose={handleCategoryModalClose}
            onCreated={() => router.refresh()}
            category={editingCategory}
          />
        </>
      ) : (
        <>
          <DataTable
            data={initialServices}
            columns={SERVICES_COLUMNS}
            renderRow={(props) => <ServiceRow {...props} onManage={openManageModal} />}
            onView={(service) => setDetailsService(service)}
            onEdit={handleEditService}
            onDelete={handleDeleteService}
            searchPlaceholder="Rechercher par nom, catégorie, description ou professionnel..."
            searchFilter={(row, query) =>
              row.name?.toLowerCase().includes(query) ||
              row.category?.name?.toLowerCase().includes(query) ||
              row.description?.toLowerCase().includes(query) ||
              row.staffNames?.toLowerCase().includes(query)
            }
          />
        
          {/* Edit existing service (keeps current edit behavior) */}
          <CreateServiceModal
            open={showCreateModal}
            onClose={handleServiceModalClose}
            onCreated={() => router.refresh()}
            service={editingService}
            userRole={userRole}
          />

          {/* Create new service (role-specific flows) */}
          <AdminServiceCreateForm
            open={showAdminCreateModal}
            onClose={handleAdminCreateClose}
            onCreated={() => router.refresh()}
          />
          <StaffServiceCreateForm
            open={showStaffCreateModal}
            onClose={handleStaffCreateClose}
            onCreated={() => router.refresh()}
          />

          <ServiceDetailsDrawer
            service={detailsService}
            onClose={() => setDetailsService(null)}
          />
        </>
      )}
    </div>
  );
}

function TabButton({ active, onClick, label, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
        active
          ? "border-[#2f3a2e] text-[#2f3a2e] dark:border-white dark:text-white"
          : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-2 py-0.5 text-xs ${
          active
            ? "bg-[#2f3a2e] text-white dark:bg-white dark:text-[#2f3a2e]"
            : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
        }`}
      >
        {count}
      </span>
    </button>
  );
}