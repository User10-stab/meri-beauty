"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { StaffTable } from "./StaffTable";
import { CreateStaffModal } from "./CreateStaffModal";
import Button from "@/components/ui/Button";
import { useTranslations } from "next-intl";

/**
 * Client shell for the auto-entrepreneur page.
 * Owns the create-modal state and triggers router.refresh() after every mutation
 * so the Server Component re-fetches fresh data (including serviceIds).
 */
export function StaffPageClient({ initialData, services }) {
  const router = useRouter();
  const t = useTranslations("dashboard.staff.autoEntrepreneur");
  const [showCreate, setShowCreate] = useState(false);

  const handleMutated = useCallback(() => {
    router.refresh();
  }, [router]);

  function handleCreateClose(mutated = false) {
    setShowCreate(false);
    if (mutated) handleMutated();
  }

  return (
    <>
      {/* Action bar */}
      <div className="flex justify-end">
        <Button  onClick={() => setShowCreate(true)}>
          {t("newProfessional")}
        </Button>
        {/* <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#2f3a2e] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#3d4e3b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f3a2e] active:scale-[0.98]"
        >
          <UserPlus size={16} />
          Nouveau professionnel
        </button> */}
      </div>

      {/* Table */}
      <StaffTable
        data={initialData}
        services={services}
        onMutated={handleMutated}
      />

      {/* Create modal */}
      {showCreate && (
        <CreateStaffModal
          services={services}
          onClose={handleCreateClose}
        />
      )}
    </>
  );
}
