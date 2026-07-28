"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "../Tables/DataTable";
import { ActivityRow } from "./ActivityRow";
import { AnimatorRow } from "./AnimatorRow";
import { CreateActivityModal } from "./CreateActivityModal";
import { CreateAnimatorModal } from "./CreateAnimatorModal";
import { deleteActivity } from "@/actions/workshops/create-activity";
import { deleteAnimator } from "@/actions/workshops/create-animator";
import { useConfirm } from "@/components/ConfirmProvider";
import Button from "@/components/ui/Button";

const ACTIVITIES_COLUMNS = [
  { key: "title", label: "Titre & Description" },
  { key: "type", label: "Type" },
  { key: "price", label: "Tarif" },
  { key: "duration", label: "Durée" },
  { key: "capacity", label: "Capacité" },
  { key: "animator", label: "Animateur" },
  { key: "status", label: "Statut" },
];

const ANIMATORS_COLUMNS = [
  { key: "name", label: "Nom & Biographie" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Téléphone" },
  { key: "socials", label: "Réseaux / Web" },
];

export function WorkshopsPageClient({ initialActivities = [], initialAnimators = [], userRole }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState("activities");

  const [editingActivity, setEditingActivity] = useState(null);
  const [editingAnimator, setEditingAnimator] = useState(null);

  const [showActivityModal, setShowActivityModal] = useState(false);
  const [showAnimatorModal, setShowAnimatorModal] = useState(false);

  const [isDeleting, startDelete] = useTransition();

  const isAdminOrOwner = userRole === "ADMIN" || userRole === "OWNER";

  // --- Activity Actions ---
  function handleEditActivity(activity) {
    setEditingActivity(activity);
    setShowActivityModal(true);
  }

  async function handleDeleteActivity(activity) {
    if (!(await confirm(`Supprimer définitivement l'activité « ${activity.title} » ? Cette action est irréversible.`, { danger: true }))) return;

    startDelete(async () => {
      const result = await deleteActivity(activity.id);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleActivityModalClose() {
    setShowActivityModal(false);
    setEditingActivity(null);
  }

  // --- Animator Actions ---
  function handleEditAnimator(animator) {
    setEditingAnimator(animator);
    setShowAnimatorModal(true);
  }

  async function handleDeleteAnimator(animator) {
    if (!(await confirm(`Supprimer définitivement l'animateur « ${animator.name} » ? Cette action est irréversible.`, { danger: true }))) return;

    startDelete(async () => {
      const result = await deleteAnimator(animator.id);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleAnimatorModalClose() {
    setShowAnimatorModal(false);
    setEditingAnimator(null);
  }

  return (
    <div className="space-y-4">
      {/* Tabs & Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200">
        <div className="flex gap-2">
          <TabButton
            active={activeTab === "activities"}
            onClick={() => setActiveTab("activities")}
            label="Activités"
            count={initialActivities.length}
          />
          <TabButton
            active={activeTab === "animators"}
            onClick={() => setActiveTab("animators")}
            label="Animateurs"
            count={initialAnimators.length}
          />
        </div>

        {isAdminOrOwner && activeTab === "activities" && (
          <Button
            onClick={() => {
              setEditingActivity(null);
              setShowActivityModal(true);
            }}
            className="mb-2 bg-[#2f3a2e]"
          >
            <Plus size={16} /> Nouvelle activité
          </Button>
        )}

        {isAdminOrOwner && activeTab === "animators" && (
          <Button
            onClick={() => {
              setEditingAnimator(null);
              setShowAnimatorModal(true);
            }}
            className="mb-2 bg-[#2f3a2e]"
          >
            <Plus size={16} /> Nouvel animateur
          </Button>
        )}
      </div>

      {/* Main Table Views */}
      {activeTab === "activities" ? (
        <>
          <DataTable
            data={initialActivities}
            columns={ACTIVITIES_COLUMNS}
            renderRow={ActivityRow}
            onView={handleEditActivity}
            onEdit={handleEditActivity}
            onDelete={handleDeleteActivity}
            searchPlaceholder="Rechercher une activité..."
            searchFilter={(row, query) =>
              row.title?.toLowerCase().includes(query) ||
              row.description?.toLowerCase().includes(query) ||
              row.type?.toLowerCase().includes(query) ||
              row.animator?.name?.toLowerCase().includes(query)
            }
          />

          <CreateActivityModal
            open={showActivityModal}
            onClose={handleActivityModalClose}
            onCreated={() => router.refresh()}
            activity={editingActivity}
            animators={initialAnimators}
          />
        </>
      ) : (
        <>
          <DataTable
            data={initialAnimators}
            columns={ANIMATORS_COLUMNS}
            renderRow={AnimatorRow}
            onView={handleEditAnimator}
            onEdit={handleEditAnimator}
            onDelete={handleDeleteAnimator}
            searchPlaceholder="Rechercher un animateur..."
            searchFilter={(row, query) =>
              row.name?.toLowerCase().includes(query) ||
              row.bio?.toLowerCase().includes(query) ||
              row.email?.toLowerCase().includes(query) ||
              row.phone?.toLowerCase().includes(query)
            }
          />

          <CreateAnimatorModal
            open={showAnimatorModal}
            onClose={handleAnimatorModalClose}
            onCreated={() => router.refresh()}
            animator={editingAnimator}
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
