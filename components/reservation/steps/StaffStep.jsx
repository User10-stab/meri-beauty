"use client";

import { useEffect, useState } from "react";
import { getStaffByService } from "@/actions/reservation/get-staff-by-service";
import { Star, Clock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";

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
        <p className="text-sm text-[#6f6a64]">Recherche des expertes disponibles…</p>
      </div>
    );
  }

  if (staffList.length === 0) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#ede5d8] bg-[#fdf8f0]/40 px-6 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white border border-[#ede5d8] text-[#b89664]"><Sparkles size={16} /></div>
        <p className="mt-4 text-sm font-medium text-[#2F3A2E]">{t("staff.noStaff")}</p>
        <p className="mt-1 text-xs text-[#6f6a64]">Cette prestation sera bientôt disponible avec d&apos;autres expertes.</p>
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

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {staffList.map((staffService, idx) => {
          const selected = data.staffService?.id === staffService.id;
          return (
            <motion.button
              key={staffService.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05, duration: 0.32 }}
              onClick={() => handleSelectStaff(staffService)}
              className={`group relative flex flex-col overflow-hidden rounded-[1.4rem] border bg-white text-left transition-all duration-300 ${
                selected
                  ? "border-[#2F3A2E] shadow-[0_10px_30px_rgba(47,58,46,0.12)]"
                  : "border-[#ede5d8]/70 shadow-[0_2px_16px_rgba(47,58,46,0.05)] hover:-translate-y-1 hover:border-[#2F3A2E]/15 hover:shadow-[0_12px_32px_rgba(47,58,46,0.10)]"
              }`}
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#b89664]/20 to-transparent" />
              {selected && <span className="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-[#2F3A2E] text-white"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" /></svg></span>}

              <div className="p-6">
                <div className="mb-4 flex justify-center">
                  <div className={`relative h-[96px] w-[96px] overflow-hidden rounded-full border-4 border-white shadow-[0_6px_18px_rgba(47,58,46,0.12)] ring-1 ${selected ? "ring-[#2F3A2E]/20" : "ring-[#ede5d8]"}`}>
                    {staffService.staff.photo ? (
                      <Image src={staffService.staff.photo} alt={staffService.staff.user.fullName} fill className="object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#2F3A2E] to-[#3d4e3b] text-xl font-semibold text-white">{staffService.staff.user.fullName.charAt(0)}</div>
                    )}
                  </div>
                </div>

                <div className="text-center">
                  <h3 className="text-[15px] font-semibold tracking-tight text-[#2F3A2E]">{staffService.staff.user.fullName}</h3>

                  {staffService.avgRating > 0 && (
                    <div className="mt-1.5 flex items-center justify-center gap-1">
                      <Star size={13} className="fill-[#b89664] text-[#b89664]" />
                      <span className="text-xs font-semibold text-[#2F3A2E]">{staffService.avgRating.toFixed(1)}</span>
                      <span className="text-[11px] text-[#9a9590]">{t("staff.reviews", { count: staffService.reviewCount })}</span>
                    </div>
                  )}

                  {staffService.staff.languages?.length > 0 && (
                    <p className="mt-1 text-[11px] tracking-wide text-[#9a9590]">{staffService.staff.languages.join(" · ")}</p>
                  )}

                  {staffService.staff.bio && (
                    <p className="mx-auto mt-2 line-clamp-2 max-w-[260px] text-[12.5px] leading-relaxed text-[#232a21]">{staffService.staff.bio}</p>
                  )}

                  <div className="mt-4 flex items-center justify-center gap-2 border-t border-[#f0e8d8] pt-3">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#fdf8f0] px-2.5 py-1 text-[11px] font-medium text-[#6f6a64] ring-1 ring-[#ede5d8]">
                      <Clock size={12} className="text-[#b89664]" />
                      {staffService.duration} min
                    </span>
                    <span className="text-[15px] font-bold tracking-tight text-[#2F3A2E]">€{Number(staffService.price).toFixed(2)}</span>
                  </div>

                  <span className="mt-3 inline-flex items-center gap-1 text-[11.5px] font-medium text-[#9a9590] transition-all group-hover:gap-1.5 group-hover:text-[#2F3A2E]">Choisir <span aria-hidden="true">→</span></span>
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
