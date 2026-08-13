"use client";

import { Clock, Euro, Tag, User, Plus, CalendarCheck, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * AppointmentDraftsStep
 *
 * Shown after the customer selects a staff member.
 * Displays the list of appointment drafts accumulated so far and lets the
 * customer either add another appointment (back to Category) or proceed to
 * Date & Time selection.
 *
 * Props:
 *  - data               : full reservationData object
 *  - onAddAnother       : () => void  — called when "Ajouter un autre rendez-vous" is clicked
 *  - onContinue         : () => void  — called when "Continuer vers Date & Heure" is clicked
 *  - onRemoveDraft      : (index: number) => void  — removes a draft by index
 */
export default function AppointmentDraftsStep({
  data,
  onAddAnother,
  onContinue,
  onRemoveDraft,
}) {
  const t = useTranslations("reservationSteps");
  const drafts = data.appointmentDrafts ?? [];

  const totalDuration = drafts.reduce((sum, d) => sum + (d.duration ?? 0), 0);
  const totalPrice    = drafts.reduce((sum, d) => sum + (d.price    ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold text-[#2F3A2E]">
          {t("drafts.title")}
        </h2>
        <p className="mt-2 text-gray-600">
          {drafts.length === 0
            ? t("drafts.empty")
            : t("drafts.count", { count: drafts.length })}
        </p>
      </div>

      {/* ── Draft list ───────────────────────────────────────────── */}
      {drafts.length > 0 && (
        <div className="mb-6 flex flex-col gap-15 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {drafts.map((draft, index) => (
              <DraftCard
                key={index}
                draft={draft}
                index={index}
                onRemove={() => onRemoveDraft(index)}
                removable={drafts.length > 1}
              />
            ))}
          </div>
         

          {/* Totals */}
          <div className="rounded-2xl border border-[#C8A46A] bg-[#C8A46A]/7 p-5">
            <div className="flex items-center justify-between text-sm font-medium text-gray-600">
              <span>{t("drafts.totalDuration")}</span>
              <span className="flex items-center gap-1 font-semibold text-[#2F3A2E]">
                <Clock size={15} />
                {t("minutes", { count: totalDuration })}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm font-medium text-gray-600">
              <span>{t("drafts.totalPrice")}</span>
              <span className="flex items-center gap-1 font-bold text-[#C8A46A]">
                <Euro size={15} />
                {totalPrice.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────────── */}
      {drafts.length === 0 && (
        <div className="mb-6 flex min-h-[120px] items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 text-gray-400">
          <p className="text-sm">{t("drafts.emptyAdd")}</p>
        </div>
      )}

      {/* ── Actions ──────────────────────────────────────────────── */}
      <div className="flex justify-end w-full">
        <div className="flex flex-col gap-4 sm:flex-row w-2/4">
          <button
          onClick={onAddAnother}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-[#2F3A2E] p-4 text-sm font-semibold text-[#2F3A2E] transition-all hover:bg-[#2F3A2E] hover:text-white"
        >
          <Plus size={18} />
          {t("drafts.addAnother")}
        </button>

        <button
          onClick={onContinue}
          disabled={drafts.length === 0}
          className={`flex flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white py-4 transition-all ${
            drafts.length === 0
              ? "cursor-not-allowed bg-gray-300"
              : "bg-[#C8A46A] hover:bg-[#B8945A]"
          }`}
        >
          <CalendarCheck size={18} />
          {t("drafts.continue")}
        </button>
        </div>
      </div>
    </div>
  );
}

// ─── DraftCard ────────────────────────────────────────────────────────────────

function DraftCard({ draft, index, onRemove, removable }) {
  const t = useTranslations("reservationSteps");
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
  {/* Header */}
  <div className="mb-5 flex items-center justify-between bg-gradient-to-r from-[#2F3A2E] to-[#3d4e3b] p-5 rounded-t-2xl">
    <h3 className=" text-lg font-semibold text-white">
      {t("drafts.appointment", { index: index + 1 })}
    </h3>

    {removable && (
      <button
        onClick={onRemove}
        className="rounded-lg p-2 text-gray-400 transition-colors  hover:text-red-500"
        aria-label={t("drafts.removeAria")}
      >
        <Trash2 size={18} />
      </button>
    )}
  </div>

  {/* Service */}
  <div className="mb-5 px-4">
    <div className="flex items-center gap-2">
      <Tag size={16} className="text-[#C8A46A]" />

      <h4 className=" font-semibold text-[#2F3A2E]">
        {draft.service?.name ?? "—"}
      </h4>
    </div>

    <p className="mt-1 ml-6 text-sm text-gray-500">
      {draft.category?.name ?? "—"}
    </p>
  </div>

  <div className="mb-5 border-t border-gray-100" />

  {/* Staff */}
  <div className="mb-5 flex items-center gap-3 px-4 ">
    <div className="flex h-5 w-5 items-center justify-center rounded-full border border-[#C8A46A] ">
      <User className="h-3 w-3 text-[#C8A46A]" />
    </div>

    <div>
      <p className="font-medium text-[#2F3A2E]">
        {draft.staff?.user?.fullName ?? "—"}
      </p>

      <p className="text-sm text-gray-500">
        {t("expert")}
      </p>
    </div>
  </div>

  <div className="border-t border-gray-100 p-5">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-gray-500">
        <Clock size={16} />
        <span className="text-sm">
          {t("minutes", { count: draft.duration ?? "—" })}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Euro size={18} className="text-[#C8A46A]" />

        <span className="text-xl font-bold text-[#C8A46A]">
          {Number(draft.price ?? 0).toFixed(2)}
        </span>
      </div>
    </div>
  </div>
</div>
  );
}

function Row({ icon, label, value }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-[#C8A46A]">{icon}</span>
      <div>
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <p className="mt-0.5 text-sm font-semibold text-[#2F3A2E]">{value}</p>
      </div>
    </div>
  );
}
