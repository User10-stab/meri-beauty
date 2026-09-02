"use client";

import { useEffect, useState } from "react";
import { getStaffByService } from "@/actions/reservation/get-staff-by-service";
import { Star, Clock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import CardBotanicalSprigs from "@/components/reservation/CardBotanicalSprigs";

export default function StaffStep({ data, updateData, nextStep }) {
  const t = useTranslations("reservationSteps");
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (data.service) loadStaff();
  }, [data.service]);

  const loadStaff = async () => {
    setLoading(true);
    const result = await getStaffByService(data.service.id);
    if (result.success) setStaffList(result.data);
    else toast.error(result.message || t("errorLoad"));
    setLoading(false);
  };

  const handleSelectStaff = (staffService) => {
    updateData({ staff: staffService.staff, staffService, date: null, time: null });
    nextStep(staffService);
  };

  if (loading) {
    return (
      <div className="flex min-h-[380px] flex-col items-center justify-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#ede5d8] border-t-[#2F3A2E]" />
        <p className="text-sm text-[#6f6a64]">{t("staff.loading")}</p>
      </div>
    );
  }

  if (staffList.length === 0) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#ede5d8] bg-[#fdf8f0]/40 px-6 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white border border-[#ede5d8] text-[#b89664]"><Sparkles size={16} /></div>
        <p className="mt-4 text-sm font-medium text-[#2F3A2E]">{t("staff.noStaff")}</p>
        <p className="mt-1 text-xs text-[#6f6a64]">{t("staff.unavailableSoon")}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#b89664]">{data.service?.name ?? t("staff.title")}</p>
        <h2 className="font-display text-[1.7rem] font-semibold leading-tight tracking-tight text-[#2F3A2E]">Choisissez votre experte</h2>
        <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-[#6f6a64]">{t("staff.subtitle", { name: data.service?.name, count: staffList.length })}</p>
        <div className="mt-3 h-px w-10 bg-[#b89664]/20" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
        {staffList.map((staffService, idx) => {
          const selected = data.staffService?.id === staffService.id;
          return (
            <motion.button
              key={staffService.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.06, duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
              onClick={() => handleSelectStaff(staffService)}
              className={`group relative flex flex-col items-start overflow-hidden rounded-xl border-2 bg-[#fdf8f0]/80 pl-11 pr-5 pt-8 pb-10 text-left transition-all duration-300 ${
                selected
                  ? "border-[#b89664] bg-white shadow-[0_8px_28px_rgba(47,58,46,0.12)]"
                  : "border-[#ede5d8]/70 shadow-[0_2px_16px_rgba(47,58,46,0.04)] hover:-translate-y-1 hover:border-[#b89664] hover:bg-[#f5ece0] hover:shadow-[0_10px_28px_rgba(47,58,46,0.08)]"
              }`}
            >
              {selected && (
                <span className="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-[#2F3A2E] text-white">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </span>
              )}

              <CardBotanicalSprigs index={idx} />

              <h3 className="mb-2 w-full truncate text-[15px] font-bold uppercase text-[#b89664]">{staffService.staff.user.fullName}</h3>
              <div className="mt-4 h-px w-10 bg-[#b89664]/20" />

              {/* Rating */}
              {staffService.avgRating > 0 && (
                <div className="mt-2 flex items-center gap-1.5">
                  <Star size={13} className="fill-[#b89664] text-[#b89664]" />
                  <span className="text-xs font-semibold text-[#2F3A2E]">{staffService.avgRating.toFixed(1)}</span>
                  <span className="text-[11px] text-[#9a9590]">({staffService.reviewCount})</span>
                </div>
              )}

              {/* Languages */}
              {staffService.staff.languages?.length > 0 && (
                <p className="mt-1 text-[11px] text-[#b89664]">{staffService.staff.languages.join(" · ")}</p>
              )}

              {/* Bio */}
              {staffService.staff.bio && (
                <p className="mt-2 line-clamp-2 min-h-[2.6em] text-[14px] leading-relaxed text-[#232a21]">
                  {staffService.staff.bio}
                </p>
              )}

              {/* Duration and Price */}
              <div className="mt-8 flex items-center gap-4 text-[12px] text-[#b89664]">
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  {staffService.duration} min
                </span>
                <span className="h-1 w-1 rounded-full bg-[#b89664]" />
                <span className="font-medium">€{Number(staffService.price).toFixed(2)}</span>
              </div>

              <span className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-[#b89664] bg-[#b89664] px-4 py-2 text-[12px] font-medium text-white transition-all hover:shadow-md">
                {t("staff.select")}
                <svg className="h-3 w-3 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
