"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { OfflineFormationEnrollmentForm } from "./OfflineFormationEnrollmentForm";

/** « Ajouter une élève hors ligne » button that opens the enrolment popup. */
export function OfflineEnrollmentButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Ajouter une élève hors ligne à une séance de formation et enregistrer le virement reçu."
        className="inline-flex items-center gap-2 self-start rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        <UserPlus className="h-4 w-4" strokeWidth={1.75} />
        Ajouter une élève hors ligne
      </button>
      <OfflineFormationEnrollmentForm open={open} onClose={() => setOpen(false)} />
    </>
  );
}
