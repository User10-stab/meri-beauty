"use client";

import { useEffect, useState } from "react";
import { getBookableServices } from "@/actions/reservation/get-bookable-services";
import { Clock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";

export default function ServiceStep({ data, updateData, nextStep }) {
  const t = useTranslations("reservationSteps");
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);

  const draftedServiceIds = new Set((data.appointmentDrafts ?? []).map((d) => d.service?.id).filter(Boolean));

  useEffect(() => {
    if (data.category) loadServices();
  }, [data.category]);

  const loadServices = async () => {
    setLoading(true);
    const result = await getBookableServices(data.category.id);
    if (result.success) setServices(result.data);
    else toast.error(result.message || t("errorLoad"));
    setLoading(false);
  };

  const handleSelectService = (service) => {
    updateData({ service, staff: null, staffService: null });
    nextStep();
  };

  if (loading) {
    return (
      <div className="flex min-h-[380px] flex-col items-center justify-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#ede5d8] border-t-[#2F3A2E]" />
        <p className="text-sm text-[#6f6a64]">Chargement des prestations…</p>
      </div>
    );
  }

  const availableServices = services.filter((s) => !draftedServiceIds.has(s.id));

  if (availableServices.length === 0) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-center rounded-2xl border border-dashed border-[#ede5d8] bg-[#fdf8f0]/40 px-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white border border-[#ede5d8] text-[#b89664]"><Sparkles size={16} /></div>
        <p className="text-sm font-medium text-[#2F3A2E]">{t("service.noServices")}</p>
        {draftedServiceIds.size > 0 && <p className="text-xs text-[#6f6a64]">{t("service.allAdded")}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#b89664]">{data.category?.name ?? t("category.title")}</p>
        <h2 className="font-display text-[1.7rem] font-semibold leading-tight tracking-tight text-[#2F3A2E]">Choisissez votre prestation</h2>
        <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-[#6f6a64]">
          {availableServices.length === 1 ? `${availableServices.length} service disponible` : `${availableServices.length} services disponibles`} — sélectionnez celle qui vous correspond.
        </p>
        <div className="mt-3 h-px w-10 bg-[#b89664]/20" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
        {availableServices.map((service, idx) => {
          const selected = data.service?.id === service.id;
          return (
            <motion.button
              key={service.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04, duration: 0.32 }}
              onClick={() => handleSelectService(service)}
              className={`group relative flex flex-col rounded-[1.25rem] border bg-white p-5 text-left transition-all duration-300 ${
                selected
                  ? "border-[#2F3A2E] shadow-[0_8px_28px_rgba(47,58,46,0.12)]"
                  : "border-[#ede5d8]/70 shadow-[0_2px_14px_rgba(47,58,46,0.05)] hover:-translate-y-1 hover:border-[#2F3A2E]/15 hover:shadow-[0_10px_28px_rgba(47,58,46,0.08)]"
              }`}
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#b89664]/20 to-transparent opacity-60" />
              {selected && <span className="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-[#2F3A2E] text-white"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" /></svg></span>}

              {/* Service name — strongest hierarchy */}
              <h3 className="pr-7 text-[14px] font-semibold leading-tight tracking-tight text-[#2F3A2E] group-hover:text-[#2F3A2E]">{service.name}</h3>

              {/* Description — truncated, tooltip on hover */}
              {service.description ? (
                <div className="group/desc relative mt-1.5">
                  <p className="line-clamp-2 text-[12.5px] leading-relaxed text-[#232a21]">{service.description}</p>
                  <div className="pointer-events-none invisible absolute left-0 top-full z-20 mt-2 w-[300px] max-w-[90vw] rounded-xl border border-[#ede5d8] bg-[#2F3A2E] px-3.5 py-2.5 text-xs leading-relaxed text-white shadow-xl opacity-0 transition-all group-hover/desc:visible group-hover/desc:opacity-100">
                    {service.description}
                  </div>
                </div>
              ) : (
                <p className="mt-1.5 text-[12px] italic text-[#9a9590]">Prestation signature MeriBeauty</p>
              )}

              {/* Duration + Price row — immediate scan */}
              <div className="mt-4 flex items-center justify-between border-t border-[#f0e8d8] pt-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fdf8f0] px-2.5 py-1 text-[11px] font-medium text-[#6f6a64] ring-1 ring-[#ede5d8]">
                  <Clock size={12} className="text-[#b89664]" />
                  {service.durationRange}
                </span>
                <span className="text-[15px] font-bold tracking-tight text-[#2F3A2E]">{service.priceRange}</span>
              </div>

              <span className="mt-3 inline-flex items-center gap-1 text-[11.5px] font-medium text-[#9a9590] transition-all group-hover:gap-1.5 group-hover:text-[#2F3A2E]">
                Choisir <span aria-hidden="true">→</span>
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
