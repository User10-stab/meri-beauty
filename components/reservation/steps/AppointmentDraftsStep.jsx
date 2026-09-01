"use client";

import { Clock, Euro, Tag, User, Plus, CalendarCheck, Trash2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";

export default function AppointmentDraftsStep({ data, onAddAnother, onContinue, onRemoveDraft }) {
  const t = useTranslations("reservationSteps");
  const drafts = data.appointmentDrafts ?? [];
  const totalDuration = drafts.reduce((sum, d) => sum + (d.duration ?? 0), 0);
  const totalPrice = drafts.reduce((sum, d) => sum + (d.price ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h2 className="font-display text-[1.7rem] font-semibold leading-tight tracking-tight text-[#2F3A2E]">{t("drafts.title")}</h2>
        <p className="mt-2 text-sm text-[#6f6a64]">{drafts.length === 0 ? t("drafts.empty") : t("drafts.count", { count: drafts.length })}</p>
        <div className="mt-3 h-px w-10 bg-[#b89664]/20" />
      </div>

      {drafts.length > 0 && (
        <div className="mb-6 space-y-5">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {drafts.map((draft, index) => (
              <motion.div key={index} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
                <DraftCard draft={draft} index={index} onRemove={() => onRemoveDraft(index)} removable={drafts.length > 1} />
              </motion.div>
            ))}
          </div>

          <div className="rounded-[1.25rem] border border-[#ede5d8]/70 bg-[#fdf8f0]/60 p-5 shadow-sm">
            <div className="flex items-center justify-between text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#9a9590]">{t("drafts.totalDuration")}</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#2F3A2E]"><Clock size={14} className="text-[#b89664]" />{t("minutes", { count: totalDuration })}</span>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-[#ede5d8]/50 pt-3 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#9a9590]">{t("drafts.totalPrice")}</span>
              <span className="inline-flex items-center gap-1 text-[16px] font-bold text-[#2F3A2E]"><Euro size={16} />{totalPrice.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {drafts.length === 0 && (
        <div className="mb-6 flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#ede5d8] bg-[#fdf8f0]/40 px-6 py-8 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white border border-[#ede5d8] text-[#b89664]"><Sparkles size={16} /></div>
          <p className="text-sm font-medium text-[#2F3A2E]">{t("drafts.emptyAdd")}</p>
          <p className="text-xs text-[#6f6a64]">Ajoutez votre première prestation pour continuer.</p>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button onClick={onAddAnother} className="inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-full border border-[#ede5d8] bg-white px-6 py-3.5 text-sm font-medium text-[#2F3A2E] hover:border-[#2F3A2E]/15 hover:bg-[#fdf8f0] transition-colors">
          <Plus size={16} className="text-[#b89664]" />
          {t("drafts.addAnother")}
        </button>
        <button onClick={onContinue} disabled={drafts.length === 0} className={`inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-all ${drafts.length === 0 ? "cursor-not-allowed bg-[#ede5d8] text-white/70" : "bg-[#2F3A2E] hover:bg-[#212a20] hover:shadow-md hover:-translate-y-px"}`}>
          <CalendarCheck size={16} />
          {t("drafts.continue")}
        </button>
      </div>
    </div>
  );
}

function DraftCard({ draft, index, onRemove, removable }) {
  const t = useTranslations("reservationSteps");
  return (
    <div className="flex flex-col overflow-hidden rounded-[1.25rem] border border-[#ede5d8]/70 bg-white shadow-sm transition-all hover:shadow-[0_8px_24px_rgba(47,58,46,0.08)]">
      <div className="flex items-center justify-between bg-[#2F3A2E] px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-white">{t("drafts.appointment", { index: index + 1 })}</h3>
        {removable && (
          <button onClick={onRemove} className="rounded-full p-1.5 text-white/60 hover:bg-white/10 hover:text-white transition-colors" aria-label={t("drafts.removeAria")}><Trash2 size={14} /></button>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#fdf8f0] ring-1 ring-[#ede5d8]"><Tag size={12} className="text-[#b89664]" /></span>
          <h4 className="text-[13.5px] font-semibold leading-tight text-[#2F3A2E]">{draft.service?.name ?? "—"}</h4>
        </div>
        <p className="ml-9 mt-1 text-xs text-[#9a9590]">{draft.category?.name ?? "—"}</p>
        <div className="mt-3 flex items-center gap-2 border-t border-[#f5efe6] pt-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[#ede5d8] bg-white"><User className="h-3 w-3 text-[#b89664]" /></span>
          <div><p className="text-[13px] font-medium leading-none text-[#2F3A2E]">{draft.staff?.user?.fullName ?? "—"}</p><p className="text-[11px] text-[#9a9590]">{t("expert")}</p></div>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-[#f5efe6] pt-3">
          <span className="inline-flex items-center gap-1 text-xs text-[#6f6a64]"><Clock size={12} className="text-[#b89664]" />{draft.duration ?? "—"} min</span>
          <span className="inline-flex items-center gap-1 text-[15px] font-bold text-[#2F3A2E]"><Euro size={14} />{Number(draft.price ?? 0).toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
