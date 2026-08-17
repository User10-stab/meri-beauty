"use client";

import { X, Eye, Send, Clock, CheckCircle2 } from "lucide-react";

/**
 * Modal to view a newsletter's full details.
 */
export function NewsletterViewModal({ newsletter, open, onClose }) {
  if (!open || !newsletter) return null;

  function formatDate(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Brussels",
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(47,58,46,0.08)]">
              <Eye size={20} className="text-[#2f3a2e]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">{newsletter.title}</h2>
              <p className="text-sm text-gray-500">{newsletter.subject}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={20} />
          </button>
        </div>

        {/* Status info */}
        <div className="mt-4 grid grid-cols-2 gap-4 rounded-xl bg-gray-50 p-4">
          <div>
            <p className="text-xs font-medium text-gray-500">Statut</p>
            <p className="mt-0.5 text-sm font-semibold text-gray-800">
              {newsletter.status === "DRAFT" && (
                <span className="inline-flex items-center gap-1 text-amber-600">
                  <Clock size={14} /> Brouillon
                </span>
              )}
              {newsletter.status === "SENT" && (
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <CheckCircle2 size={14} /> Envoyée
                </span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500">Date de création</p>
            <p className="mt-0.5 text-sm font-semibold text-gray-800">
              {formatDate(newsletter.createdAt)}
            </p>
          </div>
          {newsletter.sentAt && (
            <div>
              <p className="text-xs font-medium text-gray-500">Date d'envoi</p>
              <p className="mt-0.5 text-sm font-semibold text-gray-800">
                {formatDate(newsletter.sentAt)}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-gray-500">Destinataires</p>
            <p className="mt-0.5 text-sm font-semibold text-gray-800">
              {newsletter.recipientCount ?? 0}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-gray-500">Contenu</p>
          <div className="max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap">
              {newsletter.content}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}