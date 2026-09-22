"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Calendar, Sparkles, GraduationCap, Star } from "lucide-react";
import { DataTable } from "@/components/dashboard/Tables/DataTable";
import { ReviewRow } from "./ReviewRow";
import { ReviewEmptyState } from "./ReviewEmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { deleteReview } from "@/actions/review/review-actions";

const EMPTY_POOL = { averageRating: 0, totalReviews: 0, reviews: [] };

// Each reservation kind (rendez-vous / ateliers & événements / formations)
// keeps its own review pool rather than one merged list — same tab pattern
// as MonComptePageClient's Commandes/Ateliers/Formations tabs.
const POOL_TABS = [
  { key: "appointments", label: "Rendez-vous", icon: Calendar, staffLabel: "Staff" },
  { key: "workshops", label: "Ateliers & Événements", icon: Sparkles, staffLabel: "Animateur(trice)" },
  { key: "formations", label: "Formations", icon: GraduationCap, staffLabel: "Animateur(trice)" },
];

function buildColumns(staffLabel) {
  return [
    { key: "customer", label: "Client" },
    { key: "rating", label: "Note" },
    { key: "service", label: "Service" },
    { key: "staff", label: staffLabel },
    { key: "comment", label: "Commentaire" },
    { key: "date", label: "Date" },
  ];
}

function searchReviews(review, query) {
  const q = query.toLowerCase();
  return (
    review.customerName?.toLowerCase().includes(q) ||
    review.customerEmail?.toLowerCase().includes(q) ||
    review.serviceName?.toLowerCase().includes(q) ||
    review.staffName?.toLowerCase().includes(q) ||
    review.comment?.toLowerCase().includes(q)
  );
}

/**
 * Client shell for the reviews page. Handles view and delete actions.
 */
export function ReviewsPageClient({ initialData }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("appointments");
  const [pools, setPools] = useState(initialData);

  // −−− Confirmation dialog state −−−
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: "",
    message: "",
    danger: false,
    onConfirm: null,
  });

  const handleMutated = useCallback(() => {
    router.refresh();
  }, [router]);

  // ─── Delete flow ──────────────────────────────────────────────────────
  const handleDelete = useCallback((review) => {
    setConfirmDialog({
      open: true,
      title: "Supprimer l'avis",
      message: `Êtes-vous sûr de vouloir supprimer l'avis de ${review.customerName} ? Cette action est irréversible.`,
      danger: true,
      onConfirm: async () => {
        try {
          const result = await deleteReview(review.id);

          if (result.success) {
            toast.success("Avis supprimé avec succès.");
            setPools((current) => {
              const pool = current[activeTab];
              const reviews = pool.reviews.filter((item) => item.id !== review.id);
              return {
                ...current,
                [activeTab]: { ...pool, reviews, totalReviews: reviews.length },
              };
            });
            handleMutated();
          } else {
            toast.error(result.message || "Erreur lors de la suppression");
          }
        } catch (error) {
          console.error("[handleDelete]", error);
          toast.error("Erreur lors de la suppression de l'avis");
        } finally {
          setConfirmDialog({ open: false, title: "", message: "", danger: false, onConfirm: null });
        }
      },
    });
  }, [activeTab, handleMutated]);

  const handleCancelDelete = useCallback(() => {
    setConfirmDialog({ open: false, title: "", message: "", danger: false, onConfirm: null });
  }, []);

  const activeTabConfig = POOL_TABS.find((tab) => tab.key === activeTab);
  const pool = pools[activeTab] ?? EMPTY_POOL;

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {POOL_TABS.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.key;
            const tabPool = pools[tab.key] ?? EMPTY_POOL;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-semibold transition-colors ${
                  selected
                    ? "border-[#2f3a2e] bg-[#2f3a2e] text-white shadow-sm"
                    : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-dark-3 dark:bg-gray-dark dark:text-dark-6"
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={1.75} />
                {tab.label}
                <span className={`rounded-full px-1.5 text-[11px] ${selected ? "bg-white/20" : "bg-gray-100 dark:bg-dark-2"}`}>
                  {tabPool.totalReviews}
                </span>
              </button>
            );
          })}
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-xl bg-[rgba(47,58,46,0.08)] px-3.5 py-2 text-[#2f3a2e] dark:bg-[#FFFFFF1A] dark:text-white">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          <span className="text-sm font-bold">{pool.averageRating.toFixed(1)}</span>
          <span className="text-xs font-medium">note moyenne</span>
        </div>
      </div>

      {pool.reviews.length === 0 ? (
        <table className="w-full">
          <tbody>
            <ReviewEmptyState />
          </tbody>
        </table>
      ) : (
        <DataTable
          columns={buildColumns(activeTabConfig.staffLabel)}
          data={pool.reviews}
          renderRow={ReviewRow}
          onDelete={handleDelete}
          emptyState={ReviewEmptyState}
          searchPlaceholder="Rechercher par client, service..."
          searchFilter={searchReviews}
        />
      )}

      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        danger={confirmDialog.danger}
        onConfirm={confirmDialog.onConfirm}
        onCancel={handleCancelDelete}
      />
    </div>
  );
}
