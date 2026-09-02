"use client";

import { useEffect, useState } from "react";
import { getBookableServices } from "@/actions/reservation/get-bookable-services";
import { Clock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import CardBotanicalSprigs from "@/components/reservation/CardBotanicalSprigs";

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
        <p className="text-sm text-[#6f6a64]">{t("service.loading")}</p>
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
        <h2 className="font-display text-[1.7rem] font-semibold leading-tight tracking-tight text-[#2F3A2E]">{t("service.choose")}</h2>
        <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-[#6f6a64]">
          {t("service.subtitle", { name: data.category?.name ?? "", count: availableServices.length })} {t("service.chooseHint")}
        </p>
        <div className="mt-3 h-px w-10 bg-[#b89664]/20" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
        {availableServices.map((service, idx) => {
          const selected = data.service?.id === service.id;
          return (
            <motion.button
              key={service.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.06, duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
              onClick={() => handleSelectService(service)}
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

              <h3 className="mb-2 text-[15px] font-bold uppercase text-[#b89664]">{service.name}</h3>
              <div className="mt-4 h-px w-10 bg-[#b89664]/20" />

              {/* Description with tooltip */}
              {service.description ? (
                <div className="group/desc relative mt-2 w-full">
                  <p className="line-clamp-2 min-h-[2.6em] text-left text-[14px] leading-relaxed text-[#232a21]">
                    {service.description}
                  </p>
                  <div className="pointer-events-none invisible absolute left-1/2 top-full z-20 mt-3 w-[min(280px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-[#ede5d8] bg-[#2F3A2E] px-4 py-3 text-[12.5px] leading-relaxed text-white shadow-xl opacity-0 transition-all duration-200 group-hover/desc:visible group-hover/desc:opacity-100">
                    {service.description}
                    <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-[#2F3A2E] border-l border-t border-[#ede5d8]/20" />
                  </div>
                </div>
              ) : (
                <p className="mt-2 min-h-[2.6em] text-left text-[14px] italic text-[#9a9590]">{t("service.signature")}</p>
              )}

              {/* Duration and Price */}
              <div className="mt-8 flex items-center gap-4 text-[12px] text-[#b89664]">
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  {service.durationRange}
                </span>
                <span className="h-1 w-1 rounded-full bg-[#b89664]" />
                <span className="font-medium">{service.priceRange}</span>
              </div>

              <span className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-[#b89664] bg-[#b89664] px-4 py-2 text-[12px] font-medium text-white transition-all hover:shadow-md">
                {t("service.select")}
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
