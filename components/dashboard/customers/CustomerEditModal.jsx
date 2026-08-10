"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { updateCustomer } from "@/actions/customers/update-customer";

/**
 * @param {{ customer: object|null, onClose: () => void, onSaved: () => void }} props
 */
export function CustomerEditModal({ customer, onClose, onSaved }) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (customer) {
      setFullName(customer.fullName ?? "");
      setPhone(customer.phone ?? "");
      setIsActive(customer.isActive ?? true);
    }
  }, [customer]);

  if (!customer) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setIsSaving(true);
    const result = await updateCustomer({ id: customer.id, fullName, phone, isActive });
    setIsSaving(false);
    if (result.success) {
      toast.success(result.message);
      onSaved();
    } else {
      toast.error(result.message);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl animate-in fade-in-0 zoom-in-95 duration-200"
      >
        <h2 className="mb-4 text-base font-semibold text-gray-900">Modifier le client</h2>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Nom complet</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#2f3a2e] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Téléphone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#2f3a2e] focus:outline-none"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Compte actif
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#3d4e3b] disabled:opacity-50"
          >
            {isSaving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
      </form>
    </div>
  );
}
