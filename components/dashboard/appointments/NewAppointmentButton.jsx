"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { CreateManualAppointmentModal } from "../calendar/CreateManualAppointmentModal";

export function NewAppointmentButton({ isAdmin = false }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-[38px] w-full items-center justify-center gap-1.5 rounded-xl bg-[#303c2f] px-4 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.1),0_4px_12px_rgba(0,0,0,0.08)] transition-all hover:bg-[#253025] hover:shadow-[0_2px_4px_rgba(0,0,0,0.1),0_8px_16px_rgba(0,0,0,0.1)] sm:w-auto dark:bg-[#303c2f] dark:text-white dark:hover:bg-[#253025]"
      >
        <Plus size={15} strokeWidth={2.5} />
        <span className="whitespace-nowrap">Nouveau rendez-vous</span>
      </button>

      <CreateManualAppointmentModal
        open={open}
        onClose={() => setOpen(false)}
        onCreated={() => {
          router.refresh();
        }}
        isAdmin={isAdmin}
      />
    </>
  );
}
