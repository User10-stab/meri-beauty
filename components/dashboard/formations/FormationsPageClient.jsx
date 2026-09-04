"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Filter } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "../Tables/DataTable";
import { FormationRow } from "./FormationRow";
import { CreateFormationModal } from "./CreateFormationModal";
import { deleteFormation } from "@/actions/formations/create-formation";
import { useConfirm } from "@/components/ConfirmProvider";
import { isAdminRole } from "@/lib/authorization";
import Button from "@/components/ui/Button";
import { useTranslations } from "next-intl";

export function FormationsPageClient({ initialFormations = [], initialStaffOptions = [], userRole, currentUserId }) {
  const t = useTranslations("dashboardFormations");
  const router = useRouter();
  const confirm = useConfirm();
  
  const COLUMNS = [
    { key: "title", label: t("columns.title") },
    { key: "type", label: t("columns.type") },
    { key: "price", label: t("columns.price") },
    { key: "duration", label: t("columns.duration") },
    { key: "capacity", label: t("columns.capacity") },
    { key: "animator", label: t("columns.animator") },
    { key: "status", label: t("columns.status") },
  ];

  const [editingFormation, setEditingFormation] = useState(null);
  const [showFormationModal, setShowFormationModal] = useState(false);
  const [isDeleting, startDelete] = useTransition();

  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const filteredFormations = useMemo(() => {
    return initialFormations
      .filter((f) => {
        if (filterType && f.type !== filterType) return false;
        if (filterStatus && f.status !== filterStatus) return false;
        return true;
      })
      .map((f) => ({
        ...f,
        canEdit: isAdminRole(userRole) || f.canEdit || f.createdById === currentUserId,
        canDelete: isAdminRole(userRole) || f.canDelete || f.createdById === currentUserId,
      }));
  }, [initialFormations, filterType, filterStatus, userRole, currentUserId]);

  function handleEdit(formation) {
    setEditingFormation(formation);
    setShowFormationModal(true);
  }

  async function handleDelete(formation) {
    if (!(await confirm(t("confirmDelete", { title: formation.title }), { danger: true }))) return;

    startDelete(async () => {
      const result = await deleteFormation(formation.id);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleModalClose() {
    setShowFormationModal(false);
    setEditingFormation(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-lg font-semibold text-gray-800">{t("title")}</h1>
        <Button
          onClick={() => {
            setEditingFormation(null);
            setShowFormationModal(true);
          }}
          className="bg-[#2f3a2e]"
        >
          <Plus size={16} /> {t("button")}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Filter size={15} className="text-gray-400" />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="h-8 rounded-lg border border-gray-200 px-3 text-xs text-gray-700 bg-white outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
        >
          <option value="">{t("filters.allTypes")}</option>
          <option value="PRIVATE">{t("filters.typePrivate")}</option>
          <option value="PUBLIC">{t("filters.typePublic")}</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="h-8 rounded-lg border border-gray-200 px-3 text-xs text-gray-700 bg-white outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
        >
          <option value="">{t("filters.allStatuses")}</option>
          <option value="DRAFT">{t("filters.statusDraft")}</option>
          <option value="PUBLISHED">{t("filters.statusPublished")}</option>
          <option value="CANCELLED">{t("filters.statusCancelled")}</option>
          <option value="ARCHIVED">{t("filters.statusArchived")}</option>
        </select>
      </div>

      <DataTable
        data={filteredFormations}
        columns={[
          { key: "title", label: t("columns.title") },
          { key: "type", label: t("columns.type") },
          { key: "price", label: t("columns.price") },
          { key: "duration", label: t("columns.duration") },
          { key: "capacity", label: t("columns.capacity") },
          { key: "animator", label: t("columns.animator") },
          { key: "status", label: t("columns.status") },
        ]}
        renderRow={FormationRow}
        onView={handleEdit}
        onEdit={handleEdit}
        onDelete={handleDelete}
        searchPlaceholder={t("searchPlaceholder")}
        searchFilter={(row, query) =>
          row.title?.toLowerCase().includes(query) ||
          row.description?.toLowerCase().includes(query) ||
          row.type?.toLowerCase().includes(query) ||
          row.animator?.name?.toLowerCase().includes(query)
        }
      />

      <CreateFormationModal
        open={showFormationModal}
        onClose={handleModalClose}
        onCreated={() => router.refresh()}
        formation={editingFormation}
        staffOptions={initialStaffOptions}
        canAssignStaff={isAdminRole(userRole)}
      />
    </div>
  );
}
