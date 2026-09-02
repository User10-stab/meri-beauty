"use client";

import { Clock, Euro, Plus, CalendarCheck, Trash2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import CardBotanicalSprigs from "@/components/reservation/CardBotanicalSprigs";

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

          <div className="relative overflow-hidden rounded-xl border-2 border-[#ede5d8]/70 bg-[#fdf8f0]/80 pl-11 pr-14 pt-8 pb-10 shadow-[0_2px_16px_rgba(47,58,46,0.04)]">
            <CardBotanicalSprigs index={drafts.length} />
            <div className="flex items-center justify-between text-sm">
              <span className="text-xs font-bold uppercase tracking-wide text-[#b89664]">{t("drafts.totalDuration")}</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#2F3A2E]"><Clock size={14} className="text-[#b89664]" />{t("minutes", { count: totalDuration })}</span>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-[#b89664]/20 pt-4 text-sm">
              <span className="text-xs font-bold uppercase tracking-wide text-[#b89664]">{t("drafts.totalPrice")}</span>
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
        <button onClick={onAddAnother} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[#b89664] bg-white px-5 py-2.5 text-[13px] font-medium text-[#b89664] transition-all hover:bg-[#f5ece0] sm:flex-none">
          <Plus size={16} className="text-[#b89664]" />
          {t("drafts.addAnother")}
        </button>
        <button onClick={onContinue} disabled={drafts.length === 0} className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-5 py-2.5 text-[13px] font-medium text-white transition-all sm:flex-none ${drafts.length === 0 ? "cursor-not-allowed bg-[#ede5d8] text-white/70" : "bg-[#b89664] hover:bg-[#a38353] hover:shadow-md hover:-translate-y-px"}`}>
          <CalendarCheck size={16} />
          {t("drafts.continue")}
        </button>
      </div>
      <div className="pointer-events-none mt-3 flex justify-end pr-3 text-[#c9b99a]/50">
        <BottomSprig />
      </div>
    </div>
  );
}

function DraftCard({ draft, index, onRemove, removable }) {
  const t = useTranslations("reservationSteps");
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border-2 border-[#ede5d8]/70 bg-[#fdf8f0]/80 pl-11 pr-5 pt-8 pb-10 shadow-[0_2px_16px_rgba(47,58,46,0.04)] transition-all duration-300 hover:-translate-y-1 hover:border-[#b89664] hover:bg-[#f5ece0] hover:shadow-[0_10px_28px_rgba(47,58,46,0.08)]">
      <CardBotanicalSprigs index={index} />
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-bold uppercase text-[#b89664]">{t("drafts.appointment", { index: index + 1 })}</h3>
        {removable && (
          <button onClick={onRemove} className="relative z-10 rounded-full p-1.5 text-[#b89664] transition-colors hover:bg-white hover:text-[#2F3A2E]" aria-label={t("drafts.removeAria")}><Trash2 size={14} /></button>
        )}
      </div>
      <div className="mt-4 h-px w-10 bg-[#b89664]/20" />
      <div className="flex flex-1 flex-col">
        <h4 className="mt-2 text-[14px] font-semibold leading-tight text-[#232a21]">{draft.service?.name ?? "—"}</h4>
        <p className="mt-1 text-[13px] text-[#6f6a64]">{draft.category?.name ?? "—"}</p>
        <div className="mt-3 border-t border-[#b89664]/20 pt-3">
          <p className="text-[14px] font-medium text-[#232a21]">{draft.staff?.user?.fullName ?? "—"}</p>
          <p className="mt-1 text-[12px] text-[#b89664]">{t("expert")}</p>
        </div>
        <div className="mt-8 flex items-center justify-between border-t border-[#b89664]/20 pt-3">
          <span className="inline-flex items-center gap-1 text-xs text-[#6f6a64]"><Clock size={12} className="text-[#b89664]" />{draft.duration ?? "—"} min</span>
          <span className="inline-flex items-center gap-1 text-[15px] font-bold text-[#2F3A2E]"><Euro size={14} />{Number(draft.price ?? 0).toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

function BottomSprig() {
  return (
    <svg viewBox="0 0 60 80" fill="none" className="h-20 w-14" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="0.85" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M30 76 C 30 60, 31 44, 34 28 C 36 18, 38 10, 40 4" />
        <path d="M34 28 C 30 24, 26 20, 22 14 C 26 12, 30 16, 34 28" />
        <path d="M33 36 C 29 32, 25 28, 21 22 C 25 20, 29 24, 33 36" />
        <path d="M32 44 C 28 40, 24 36, 20 30 C 24 28, 28 32, 32 44" />
        <path d="M31 52 C 27 48, 23 44, 19 38 C 23 36, 27 40, 31 52" />
        <path d="M35 30 C 39 26, 43 22, 47 16 C 43 14, 39 18, 35 30" />
        <path d="M34 38 C 38 34, 42 30, 46 24 C 42 22, 38 26, 34 38" />
      </g>
    </svg>
  );
}
