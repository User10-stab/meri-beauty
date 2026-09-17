"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Check, ChevronDown, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { getBookableCategoriesWithStaff } from "@/actions/reservation/get-bookable-categories-with-staff";

function StaffAvatar({ member, size = 56 }) {
  const initials = member.fullName.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div style={{ width: size, height: size }} className="relative shrink-0 overflow-hidden rounded-full border-2 border-[#fffaf2] bg-[#e8ddcf] shadow-[0_3px_10px_rgba(47,58,46,0.12)]">
      {member.photo ? <Image src={member.photo} alt={member.fullName} fill sizes={`${size}px`} className="object-cover" unoptimized /> : <div className="flex h-full w-full items-center justify-center bg-[#2F3A2E] text-[11px] font-semibold tracking-[0.08em] text-white">{initials}</div>}
    </div>
  );
}

function StaffMemberRow({ member, categoryName, index }) {
  return (
    <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.08, duration: 0.4 }}>
      <Link href={`/staff/${member.id}?category=${encodeURIComponent(categoryName)}`} className="group relative flex items-center gap-3.5 rounded-full border border-[#eadfce]/50 bg-[#d9c9a8]/20 px-3.5 py-2 mt-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-[#b89664]/60 hover:shadow-[0_8px_20px_rgba(47,58,46,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b89664] focus-visible:ring-offset-2">
        <StaffAvatar member={member} />
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-[14px] font-semibold leading-tight text-[#2F3A2E] transition-colors group-hover:text-[#9a8054]">{member.fullName}</h4>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[#8b8178]">{member.availability?.label}</p>
        </div>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#e5d8c6] text-[#b89664] transition-all group-hover:border-[#b89664] group-hover:bg-[#b89664] group-hover:text-white"><ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></div>
      </Link>
    </motion.div>
  );
}

function CategoryCard({ category, index }) {
  const [expanded, setExpanded] = useState(false);
  const maxPreviewStaff = 2;
  const hasMoreStaff = category.staff.length > maxPreviewStaff;
  const displayedStaff = expanded ? category.staff : category.staff.slice(0, maxPreviewStaff);

  return (
    <motion.article initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.1, duration: 0.5, ease: [0.4, 0, 0.2, 1] }} className="group relative flex h-full flex-col overflow-hidden rounded-[1.75rem] border border-[#e7dccb] bg-[#fffaf2] shadow-[0_4px_22px_rgba(47,58,46,0.055)] transition-all duration-500 hover:-translate-y-1 hover:border-[#b89664]/45 hover:shadow-[0_16px_36px_rgba(47,58,46,0.12)]">
      <header className="relative overflow-hidden  px-5 pt-5 bg-primary text-white sm:px-6">
        <div className="pointer-events-none absolute -right-8 -top-12 h-32 w-32 rounded-full border border-[#d9c9a8]/20" /><div className="pointer-events-none absolute -right-2 -top-6 h-20 w-20 rounded-full border border-[#d9c9a8]/15" />
        <div className="relative mb-4 flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#d9c9a8]"><Sparkles size={13} /> MeriBeauty Studio</span><span className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] text-white/75">{category.servicesCount} service{category.servicesCount > 1 ? "s" : ""}</span></div> 
      </header>

      <section className="flex flex-1 flex-col px-4 pb-4 pt-3 sm:px-5">
        <div className="">
              <h2 className="mt-2 text-primary relative font-display text-[1.55rem] font-bold leading-tight tracking-[-0.02em] sm:text-[1.7rem]">{category.name}</h2>
              <p className="relative mb-6 mt-2 h-[40px] max-w-[32rem] text-sm leading-5 line-clamp-2">
                {category.description || "Découvrez nos prestations"}
              </p>
          </div>
          <div className="">
              <div className="mb-3 flex items-end justify-between gap-3 px-1"><div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b89664]">Notre experte</p><p className="mt-1 text-[12px] text-[#8b8178]">Choisissez avec qui prendre rendez-vous</p></div><span className="flex items-center gap-1.5 text-[11px] text-[#8b8178]"><Users size={13} /> {category.staff.length}</span></div>
              <div className="space-y-2.5">{displayedStaff.map((member, staffIndex) => <StaffMemberRow key={member.id} member={member} categoryName={category.name} index={staffIndex} />)}</div>
              {hasMoreStaff && <motion.button onClick={() => setExpanded(!expanded)} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} className="group/expand mt-2.5 flex w-full items-center justify-center gap-2 rounded-[1.15rem] border border-dashed border-[#cdbb9f] bg-transparent px-4 py-3 text-[12px] font-medium text-[#9a8054] transition-all hover:border-[#b89664] hover:bg-white">{expanded ? "Masquer" : `Voir ${category.staff.length - maxPreviewStaff} autre${category.staff.length - maxPreviewStaff > 1 ? "s" : ""} experte${category.staff.length - maxPreviewStaff > 1 ? "s" : ""}`}<ChevronDown size={14} className={expanded ? "rotate-180" : ""} /></motion.button>}
          </div>
      </section>
      <div className="mx-5 mb-5 mt-auto flex items-center gap-2 border-t border-[#eadfce] pt-4 text-[10px] uppercase tracking-[0.16em] text-[#b89664]"><Check size={13} /> Sélection personnalisée</div>
    </motion.article>
  );
}

export default function ReservationCategoryPicker() {
  const t = useTranslations("reservationSteps");
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadCategories(); }, []);

  const loadCategories = async () => { setLoading(true); const result = await getBookableCategoriesWithStaff(); if (result.success) setCategories(result.data); else toast.error(result.message || t("errorLoad")); setLoading(false); };

  if (loading) return <div className="flex min-h-[320px] flex-col items-center justify-center gap-4"><div className="h-12 w-12 animate-spin rounded-full border-2 border-[#ede5d8] border-t-[#2F3A2E]" /><p className="text-sm text-[#6f6a64]">{t("category.loading")}</p></div>;
  if (categories.length === 0) return <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#ede5d8] bg-[#fdf8f0]/50 px-6 py-12 text-center"><div className="flex h-16 w-16 items-center justify-center rounded-full border border-[#ede5d8] bg-white text-[#b89664]"><Sparkles size={20} /></div><p className="mt-4 text-[15px] font-medium text-[#2F3A2E]">{t("category.empty")}</p><p className="mt-1 text-[12px] text-[#6f6a64]">{t("category.emptyHint")}</p></div>;
  return <div className="grid items-stretch gap-6 md:grid-cols-2 xl:grid-cols-3">{categories.map((category, index) => <CategoryCard key={category.id} category={category} index={index} />)}</div>;
}