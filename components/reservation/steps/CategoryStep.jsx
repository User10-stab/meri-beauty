"use client";

import { useEffect, useState } from "react";
import { getBookableCategories } from "@/actions/reservation/get-bookable-categories";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Sparkles, Hand, Flower2, Gem, Leaf, Heart, Star } from "lucide-react";
import { motion } from "framer-motion";
import CardBotanicalSprigs from "@/components/reservation/CardBotanicalSprigs";

const ICONS = [Hand, Flower2, Gem, Leaf, Heart, Star, Sparkles];

function pickIcon(id, index) {
  const hash = String(id).split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return ICONS[(hash + index) % ICONS.length];
}

export default function CategoryStep({ data, updateData, nextStep }) {
  const t = useTranslations("reservationSteps");
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    setLoading(true);
    const result = await getBookableCategories();
    if (result.success) {
      setCategories(result.data);
    } else {
      toast.error(result.message || t("errorLoad"));
    }
    setLoading(false);
  };

  const handleSelectCategory = (category) => {
    updateData({ category, service: null, staff: null, staffService: null });
    nextStep();
  };

  if (loading) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#ede5d8] border-t-[#2F3A2E]" />
        <p className="text-sm text-[#6f6a64]">{t("category.loading")}</p>
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#ede5d8] bg-[#fdf8f0]/50 px-6 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white border border-[#ede5d8] text-[#b89664]"><Sparkles size={18} /></div>
        <p className="mt-4 text-sm font-medium text-[#2F3A2E]">{t("category.empty")}</p>
        <p className="mt-1 text-xs text-[#6f6a64]">{t("category.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
        {categories.map((category, idx) => {
          const selected = data.category?.id === category.id;
          return (
            <motion.button
              key={category.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.06, duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
              onClick={() => handleSelectCategory(category)}
              className={`group relative flex flex-col items-start overflow-hidden rounded-xl border-2 bg-[#fdf8f0]/80 pl-11 pr-7 pt-10 pb-9 text-left transition-all duration-300 ${
                selected
                  ? "border-[#b89664] bg-white shadow-[0_8px_28px_rgba(47,58,46,0.12)]"
                  : "border-[#ede5d8]/70 shadow-[0_2px_16px_rgba(47,58,46,0.04)] hover:-translate-y-1 hover:border-[#b89664] hover:bg-[#f5ece0] hover:shadow-[0_10px_28px_rgba(47,58,46,0.08)]"
              }`}
            >
              {selected && (
                <span className="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-[#2F3A2E] text-white"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" /></svg></span>
              )}

              <CardBotanicalSprigs index={idx} />

              <h2 className="mb-2 text-[18px] font-bold uppercase leading-snug text-[#b89664] sm:text-[19px]">{category.name}</h2>
              <div className="mt-4 h-[2px] w-10 bg-[#b89664]/20" />

              {/* Description area - always present, grows to fill space */}
              <div className="group/desc relative mt-2 w-full flex-1 flex items-start">
                {category.description ? (
                  <>
                    <p className="line-clamp-3 text-left text-[15px] leading-relaxed text-[#232a21]">
                      {category.description}
                    </p>
                    {/* Full description tooltip */}
                    <div className="pointer-events-none invisible absolute left-1/2 top-full z-20 mt-3 w-[min(280px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-[#ede5d8] bg-[#2F3A2E] px-4 py-3 text-[12.5px] leading-relaxed text-white shadow-xl opacity-0 transition-all duration-200 group-hover/desc:visible group-hover/desc:opacity-100">
                      {category.description}
                      <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-[#2F3A2E] border-l border-t border-[#ede5d8]/20" />
                    </div>
                  </>
                ) : (
                  <p className="text-[15px] italic leading-relaxed text-[#9a9590]">
                    Découvrez nos prestations
                  </p>
                )}
              </div>

              {/* Bottom section - always at the same position using mt-auto */}
              <div className="mt-auto pt-6 w-full">
                <div className="flex items-center gap-1.5 text-[13px] text-[#b89664]">
                  <span className="h-1 w-1 rounded-full bg-[#b89664]" />
                  <span className="font-medium tracking-wide">{t("category.servicesCount", { count: category.servicesCount })}</span>
                </div>

                <span className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-[#b89664] bg-[#b89664] px-4 py-2 text-[13px] font-medium text-white transition-all hover:bg-[#a38353] hover:shadow-md">
                  {t("category.chooseServices")}
                  <svg className="h-3 w-3 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </span>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
