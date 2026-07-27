"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";

/**
 * Modal for creating and editing newsletters.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {object} [props.newsletter] - If provided, we're editing an existing draft
 * @param {(formData: {title: string, subject: string, content: string}) => Promise<{success: boolean, message: string, errors?: object}>} props.serverAction
 * @param {() => void} props.onClose
 * @param {() => void} props.onSuccess
 */
export function NewsletterCreateEditModal({
  open,
  newsletter = null,
  serverAction,
  onClose,
  onSuccess,
}) {
  const isEditing = !!newsletter;
  const router = useRouter();

  const [form, setForm] = useState({
    title: "",
    subject: "",
    content: "",
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const prevOpenRef = useRef(open);

  // Sync form state whenever the modal opens or the newsletter prop changes
  // This ensures pre-filled values for editing and empty form for creating
  useEffect(() => {
    setForm({
      title: newsletter?.title ?? "",
      subject: newsletter?.subject ?? "",
      content: newsletter?.content ?? "",
    });
    setErrors({});
  }, [open, newsletter?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = useCallback(() => {
    setForm({ title: "", subject: "", content: "" });
    setErrors({});
    onClose();
  }, [onClose]);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    try {
      const result = await serverAction(form);

      if (result.success) {
        handleClose();
        await router.refresh();
        toast.success(result.message);
        onSuccess?.(result);
      } else {
        setErrors(result.errors ?? {});
        if (result.message && !result.errors) {
          toast.error(result.message);
        }
      }
    } catch (err) {
      toast.error("Une erreur inattendue s'est produite.");
    } finally {
      setLoading(false);
    }
  }

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Clear error on change
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">
            {isEditing ? "Modifier la newsletter" : "Nouvelle newsletter"}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-5">
            {/* Title */}
            <div>
              <label
                htmlFor="nl-title"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Titre interne <span className="text-red-500">*</span>
              </label>
              <input
                id="nl-title"
                type="text"
                value={form.title}
                onChange={(e) => handleChange("title", e.target.value)}
                placeholder="Ex: Promotion été 2026"
                className={`w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[#2f3a2e] focus:ring-1 focus:ring-[#2f3a2e]/20 ${
                  errors.title
                    ? "border-red-300 bg-red-50"
                    : "border-gray-300 bg-white"
                }`}
              />
              {errors.title && (
                <p className="mt-1 text-xs text-red-500">{errors.title}</p>
              )}
              <p className="mt-1 text-xs text-gray-400">
                Utilisé uniquement dans le tableau de bord pour identifier la newsletter.
              </p>
            </div>

            {/* Subject */}
            <div>
              <label
                htmlFor="nl-subject"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Objet de l'email <span className="text-red-500">*</span>
              </label>
              <input
                id="nl-subject"
                type="text"
                value={form.subject}
                onChange={(e) => handleChange("subject", e.target.value)}
                placeholder="Ex: Nos nouveautés de l'été vous attendent !"
                className={`w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[#2f3a2e] focus:ring-1 focus:ring-[#2f3a2e]/20 ${
                  errors.subject
                    ? "border-red-300 bg-red-50"
                    : "border-gray-300 bg-white"
                }`}
              />
              {errors.subject && (
                <p className="mt-1 text-xs text-red-500">{errors.subject}</p>
              )}
            </div>

            {/* Content */}
            <div>
              <label
                htmlFor="nl-content"
                className="mb-1.5 block text-sm font-medium text-gray-700"
              >
                Contenu <span className="text-red-500">*</span>
              </label>
              <textarea
                id="nl-content"
                rows={10}
                value={form.content}
                onChange={(e) => handleChange("content", e.target.value)}
                placeholder="Écrivez le contenu de votre newsletter ici... Utilisez des sauts de ligne pour structurer votre message."
                className={`w-full resize-y rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[#2f3a2e] focus:ring-1 focus:ring-[#2f3a2e]/20 ${
                  errors.content
                    ? "border-red-300 bg-red-50"
                    : "border-gray-300 bg-white"
                }`}
              />
              {errors.content && (
                <p className="mt-1 text-xs text-red-500">{errors.content}</p>
              )}
              <p className="mt-1 text-xs text-gray-400">
                Les sauts de ligne sont automatiquement convertis en paragraphes dans l'email.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-8 flex justify-end gap-3 border-t border-gray-100 pt-5">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-[#2f3a2e] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#3d4e3a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? "Enregistrement..."
                : isEditing
                ? "Enregistrer les modifications"
                : "Créer la newsletter"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}