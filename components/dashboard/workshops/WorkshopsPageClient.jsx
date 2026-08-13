"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Filter } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "../Tables/DataTable";
import { ActivityRow } from "./ActivityRow";
import { AnimatorRow } from "./AnimatorRow";
import { CreateActivityModal } from "./CreateActivityModal";
import { CreateAnimatorModal } from "./CreateAnimatorModal";
import { deleteActivity } from "@/actions/workshops/create-activity";
import { deleteAnimator } from "@/actions/workshops/create-animator";
import { useConfirm } from "@/components/ConfirmProvider";
import { isAdminRole } from "@/lib/authorization";
import Button from "@/components/ui/Button";
import { useTranslations } from "next-intl";

export function WorkshopsPageClient({ initialActivities = [], initialAnimators = [], userRole, currentUserId, initialTab = "activities" }) {
  const t = useTranslations("dashboardWorkshops");
  const tActivities = useTranslations("dashboardWorkshops.activities");
  const tAnimators = useTranslations("dashboardWorkshops.animators");
  
  const ACTIVITIES_COLUMNS = [
    { key: "title", label: tActivities("columns.title") },
    { key: "type", label: tActivities("columns.type") },
    { key: "price", label: tActivities("columns.price") },
    { key: "duration", label: tActivities("columns.duration") },
    { key: "capacity", label: tActivities("columns.capacity") },
    { key: "animator", label: tActivities("columns.animator") },
    { key: "status", label: tActivities("columns.status") },
  ];

  const ANIMATORS_COLUMNS = [
    { key: "name", label: tAnimators("columns.name") },
    { key: "email", label: tAnimators("columns.email") },
    { key: "phone", label: tAnimators("columns.phone") },
    { key: "socials", label: tAnimators("columns.socials") },
  ];

  const router = useRouter();
  const confirm = useConfirm();
  const activeTab = initialTab;

  const [editingActivity, setEditingActivity] = useState(null);
  const [editingAnimator, setEditingAnimator] = useState(null);

  const [showActivityModal, setShowActivityModal] = useState(false);
  const [showAnimatorModal, setShowAnimatorModal] = useState(false);

  const [isDeleting, startDelete] = useTransition();

  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const filteredActivities = useMemo(() => {
    return initialActivities
      .filter((a) => {
        if (filterType && a.type !== filterType) return false;
        if (filterStatus && a.status !== filterStatus) return false;
        return true;
      })
      .map((a) => ({ ...a, canManage: isAdminRole(userRole) || a.createdById === currentUserId }));
  }, [initialActivities, filterType, filterStatus, userRole, currentUserId]);

  const isAdminOrOwner = isAdminRole(userRole);

  // --- Activity Actions ---
  function handleEditActivity(activity) {
    setEditingActivity(activity);
    setShowActivityModal(true);
  }

  async function handleDeleteActivity(activity) {
    if (!(await confirm(tActivities("confirmDeleteActivity", { title: activity.title }), { danger: true }))) return;

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
    if (!(await confirm(tAnimators("confirmDeleteAnimator", { name: animator.name }), { danger: true }))) return;

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
            href="/dashboard/workshops/activities"
            active={activeTab === "activities"}
            label={t("tabs.activities")}
            count={filteredActivities.length}
          />
          <TabButton
            href="/dashboard/workshops/animators"
            active={activeTab === "animators"}
            label={t("tabs.animators")}
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
            <Plus size={16} /> {tActivities("buttons.newActivity")}
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
            <Plus size={16} /> {tActivities("buttons.newAnimator")}
          </Button>
        )}
      </div>

      {/* Filters */}
      {activeTab === "activities" && (
        <div className="flex flex-wrap items-center gap-3">
          <Filter size={15} className="text-gray-400" />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="h-8 rounded-lg border border-gray-200 px-3 text-xs text-gray-700 bg-white outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">{tActivities("filters.allTypes")}</option>
            <option value="WORKSHOP">{tActivities("filters.typeWorkshop")}</option>
            <option value="EVENT">{tActivities("filters.typeEvent")}</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="h-8 rounded-lg border border-gray-200 px-3 text-xs text-gray-700 bg-white outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">{tActivities("filters.allStatuses")}</option>
            <option value="DRAFT">{tActivities("filters.statusDraft")}</option>
            <option value="PUBLISHED">{tActivities("filters.statusPublished")}</option>
            <option value="CANCELLED">{tActivities("filters.statusCancelled")}</option>
            <option value="ARCHIVED">{tActivities("filters.statusArchived")}</option>
          </select>
        </div>
      )}

      {/* Main Table Views */}
      {activeTab === "activities" ? (
        <>
          <DataTable
            data={filteredActivities}
            columns={ACTIVITIES_COLUMNS}
            renderRow={ActivityRow}
            onView={handleEditActivity}
            onEdit={handleEditActivity}
            onDelete={handleDeleteActivity}
            searchPlaceholder={tActivities("searchPlaceholder")}
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
            searchPlaceholder={tAnimators("searchAnimatorPlaceholder")}
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

function TabButton({ href, active, label, count }) {
  return (
    <Link
      href={href}
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
    </Link>
  );
}
