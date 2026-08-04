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

const COLUMNS = [
  { key: "title", label: "Titre & Description" },
  { key: "type", label: "Type" },
  { key: "price", label: "Tarif" },
  { key: "duration", label: "Durée" },
  { key: "capacity", label: "Capacité" },
  { key: "animator", label: "Formateur" },
  { key: "status", label: "Statut" },
];

export function FormationsPageClient({ initialFormations = [], initialAnimators = [], userRole, currentUserId }) {
  const router = useRouter();
  const confirm = useConfirm();

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
      .map((f) => ({ ...f, canManage: isAdminRole(userRole) || f.createdById === currentUserId }));
  }, [initialFormations, filterType, filterStatus, userRole, currentUserId]);

  function handleEdit(formation) {
    setEditingFormation(formation);
    setShowFormationModal(true);
  }

  async function handleDelete(formation) {
    if (!(await confirm(`Supprimer définitivement la formation « ${formation.title} » ? Cette action est irréversible.`, { danger: true }))) return;

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
        <h1 className="text-lg font-semibold text-gray-800">Formations</h1>
        <Button
          onClick={() => {
            setEditingFormation(null);
            setShowFormationModal(true);
          }}
          className="bg-[#2f3a2e]"
        >
          <Plus size={16} /> Nouvelle formation
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
          <option value="">Tous les types</option>
          <option value="PRIVATE">Privée</option>
          <option value="PUBLIC">Groupe</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="h-8 rounded-lg border border-gray-200 px-3 text-xs text-gray-700 bg-white outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
        >
          <option value="">Tous les statuts</option>
          <option value="DRAFT">Brouillon</option>
          <option value="PUBLISHED">Publié</option>
          <option value="CANCELLED">Annulé</option>
          <option value="ARCHIVED">Archivé</option>
        </select>
      </div>

      <DataTable
        data={filteredFormations}
        columns={COLUMNS}
        renderRow={FormationRow}
        onView={handleEdit}
        onEdit={handleEdit}
        onDelete={handleDelete}
        searchPlaceholder="Rechercher une formation..."
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
        animators={initialAnimators}
      />
    </div>
  );
}
