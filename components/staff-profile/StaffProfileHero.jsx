"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Calendar, Clock, MapPin, Star, Heart } from "lucide-react";
import { BotanicalBranch, BotanicalSprig, Botanical, LeftBotanical } from "@/components/botanical-decorations";

function useInView(threshold = 0.15) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, inView];
}

const LANG_FLAGS = {
  FRENCH: { flag: "\u{1F1EB}\u{1F1F7}", label: "Fran\u00e7ais" },
  ENGLISH: { flag: "\u{1F1EC}\u{1F1E7}", label: "English" },
  ARABIC: { flag: "\u{1F1F8}\u{1F1E6}", label: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629" },
  SPANISH: { flag: "\u{1F1EA}\u{1F1F8}", label: "Espa\u00f1ol" },
  DUTCH: { flag: "\u{1F1F3}\u{1F1F1}", label: "Nederlands" },
  GERMAN: { flag: "\u{1F1E9}\u{1F1EA}", label: "Deutsch" },
  PORTUGUESE: { flag: "\u{1F1F5}\u{1F1F9}", label: "Portugu\u00eas" },
  ITALIAN: { flag: "\u{1F1EE}\u{1F1F9}", label: "Italiano" },
};

const RYTHME_LABELS = {
  ONE_DAY_PER_WEEK: "1 jour / semaine",
  TWO_DAYS_PER_WEEK: "2 jours / semaine",
  THREE_DAYS_PER_WEEK: "3 jours / semaine",
  FULL_WEEK: "Toute la semaine",
};

const SOCIAL_ICONS = {
  instagram: { component: InstagramIcon, label: "Instagram", color: "hover:text-pink-500" },
  facebook: { component: FacebookIcon, label: "Facebook", color: "hover:text-blue-600" },
  tiktok: { component: TiktokIcon, label: "TikTok", color: "hover:text-black" },
  pinterest: { component: PinterestIcon, label: "Pinterest", color: "hover:text-red-600" },
};

function TiktokIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1 0-5.78 2.92 2.92 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 3 15.57 6.33 6.33 0 0 0 9.37 22a6.33 6.33 0 0 0 6.38-6.22V9.4a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-.93-.83z" />
    </svg>
  );
}

function PinterestIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z" />
    </svg>
  );
}

function FacebookIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function InstagramIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );
}



export default function StaffProfileHero({
  name,
  firstName,
  bio,
  yearsOfExperience,
  languages,
  rythme,
  rythmeDays,
  workingSchedule,
  image,
  staffId,
  socialLinks,
}) {
  const [heroRef, heroInView] = useInView();
  const [imageLoaded, setImageLoaded] = useState(false);

  const shortBio =
    bio ||
    `Passionn\u00e9e par la beaut\u00e9 et les d\u00e9tails qui font toute la diff\u00e9rence, ${firstName} accompagne chaque cliente avec une approche personnalis\u00e9e pour r\u00e9v\u00e9ler la meilleure version d\u2019elle-m\u00eame.`;


  const daysLabel = rythmeDays && rythmeDays.length > 0
    ? rythmeDays.join(", ")
    : null;

  return (
    <section className="relative w-full overflow-hidden bg-gradient-to-br from-[#fdf8f0] via-[#faf6ef] to-[#f8f4ed] pt-24 sm:pt-28 md:pt-32">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Top right botanical branch */}
        <BotanicalBranch className="absolute -top-8 -right-12 w-40 h-56 text-[#b89664]/15 transform rotate-12" />
        
        {/* Bottom left botanical sprig */}
        <BotanicalSprig className="absolute -bottom-16 -left-8 w-24 h-40 text-[#b89664]/12 transform -rotate-12" />
        
        {/* Left side large botanical */}
        <Botanical className="absolute top-1/4 -left-20 w-48 h-64 text-[#b89664]/8 transform -rotate-6" />
        
        {/* Floating golden dots */}
        <div className="absolute top-32 left-1/4" aria-hidden="true">
          <div className="flex items-center gap-2 text-[#b89664]/40 animate-pulse-soft">
            <div className="h-1 w-1 rounded-full bg-current opacity-60"></div>
            <div className="h-1.5 w-1.5 rounded-full bg-current opacity-80"></div>
            <div className="h-1 w-1 rounded-full bg-current opacity-60"></div>
          </div>
        </div>
        
        {/* Subtle gradient orbs */}
        <div className="absolute top-20 right-1/4 w-64 h-64 bg-gradient-to-br from-[#b89664]/5 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-1/4 w-80 h-80 bg-gradient-to-tr from-[#2F3A2E]/3 to-transparent rounded-full blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-[1200px] px-4 pb-16 sm:px-6 sm:pb-20 md:px-10 md:pb-24 lg:px-14">
        <div
          ref={heroRef}
          className={`transition-all duration-1000 ease-out ${
            heroInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
          }`}
        >
          {/* Main content grid */}
          <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[1fr_1.4fr] lg:gap-16 xl:gap-24">
            {/* Left - Portrait Section */}
            <div className="relative flex justify-center lg:justify-start">
              <div className="relative w-full max-w-[440px]">
                {/* Layered background shapes */}
                <div
                  aria-hidden="true"
                  className="absolute -left-6 -top-6 h-[108%] w-[106%] rounded-[3rem] bg-gradient-to-br from-[#f0e6d6] to-[#ede0d0] transform rotate-1"
                />
                <div
                  aria-hidden="true"
                  className="absolute -left-3 -top-3 h-[104%] w-[103%] rounded-[2.5rem] bg-white/60 backdrop-blur-sm transform -rotate-0.5"
                />

                {/* Portrait container */}
                <div className="relative aspect-[3/4] w-full overflow-hidden rounded-t-[3rem] rounded-br-[2rem] rounded-bl-[2rem] shadow-[0_20px_60px_rgba(47,58,46,0.15)] group">
                  <Image
                    src={image}
                    alt={name}
                    fill
                    priority
                    sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 440px"
                    className={`object-cover object-top transition-all duration-700 ${
                      imageLoaded ? "scale-100 opacity-100" : "scale-105 opacity-0"
                    }`}
                    onLoad={() => setImageLoaded(true)}
                    unoptimized
                  />
                  
                  {/* Subtle overlay for better text contrast */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-transparent" />
                </div>

                {/* Floating elements */}
                {yearsOfExperience > 0 && (
                  <div className={`absolute -bottom-6 left-6 flex items-center gap-3 rounded-2xl border border-white/50 bg-white/95 backdrop-blur-sm px-5 py-4 shadow-[0_8px_32px_rgba(47,58,46,0.12)] sm:left-8 transition-all duration-700 ${
                    heroInView ? 'animate-in slide-in-from-bottom-2' : ''
                  }`} style={{ animationDelay: '1200ms' }}>
                    <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#b89664] to-[#a08654] overflow-hidden">
                      <Star size={16} className="text-white fill-current relative z-10" />
                      <div className={`absolute inset-0 animate-shimmer ${heroInView ? 'opacity-100' : 'opacity-0'}`} style={{ animationDelay: '1500ms' }} />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-lg font-bold leading-tight text-[#2F3A2E]">{yearsOfExperience} ans</span>
                      <span className="text-xs leading-tight text-[#9a9590]">d'expérience</span>
                    </div>
                  </div>
                )}

                {/* Rating badge (could be dynamic in the future) */}
               
              </div>
            </div>

            {/* Right - Information Section */}
            <div className="flex flex-col space-y-8 lg:pt-4">
             

              {/* Name with staggered animation */}
              <div className={`transition-all duration-700 delay-300 ${
                heroInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}>
                <h1 className="font-display text-[2.8rem] font-bold leading-[1.05] tracking-tight text-[#2F3A2E] sm:text-[3.4rem] md:text-[4rem] lg:text-[3.8rem] xl:text-[4.2rem]">
                  {name}
                </h1>
              </div>

              {/* Bio with fade in */}
              <div className={`transition-all duration-700 delay-400 ${
                heroInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}>
                <p className="max-w-xl text-[16px] leading-relaxed text-[#6f6a64] sm:text-[17px]">
                  {shortBio}
                </p>
              </div>

              {/* Languages - Enhanced cards */}
              {languages && languages.length > 0 && (
                <div className={`transition-all duration-700 delay-500 ${
                  heroInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
                }`}>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#9a9590]">Langues parlées</h3>
                  <div className="flex flex-wrap gap-3">
                    {languages.map((lang, index) => {
                      const langData = LANG_FLAGS[lang] || { flag: "", label: lang };
                      return (
                        <div
                          key={lang}
                          className={`group flex items-center gap-2.5 rounded-full border border-[#ede5d8] bg-white/80 px-4 py-2.5 shadow-sm transition-all duration-300 hover:border-[#b89664] hover:shadow-md hover:-translate-y-0.5 ${
                            heroInView ? "animate-in slide-in-from-bottom-2" : ""
                          }`}
                          style={{ animationDelay: `${600 + index * 100}ms` }}
                        >
                          <span className="text-lg">{langData.flag}</span>
                          <span className="text-sm font-medium text-[#2F3A2E] group-hover:text-[#b89664] transition-colors">
                            {langData.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Work Rhythm */}
              {rythme && (
                <div className={`transition-all duration-700 delay-600 ${
                  heroInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
                }`}>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#9a9590]">Rythme de travail</h3>
                  <div className="flex items-center gap-3 rounded-xl border border-[#ede5d8] bg-white/60 px-4 py-3 backdrop-blur-sm">
                    <Clock size={18} className="text-[#b89664]" />
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-[#2F3A2E]">
                        {RYTHME_LABELS[rythme] || rythme}
                      </span>
                      {daysLabel && (
                        <span className="text-xs text-[#6f6a64]">{daysLabel}</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Social Media - Always visible */}
              <div className={`transition-all duration-700 delay-700 ${
                heroInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#9a9590]">Suivez {firstName}</h3>
                <div className="flex items-center gap-3">
                  {Object.entries(SOCIAL_ICONS).map(([platform, { component: Icon, label, color }], index) => (
                    <div
                      key={platform}
                      className={`social-icon-hover group flex h-11 w-11 items-center justify-center rounded-full border border-[#ede5d8] bg-white/80 backdrop-blur-sm text-[#6f6a64] transition-all duration-300 hover:border-[#b89664] hover:shadow-lg hover:-translate-y-1 ${
                        socialLinks?.[platform] 
                          ? `cursor-pointer ${color}` 
                          : 'cursor-not-allowed opacity-60'
                      } ${heroInView ? 'animate-in slide-in-from-bottom-2' : ''}`}
                      style={{ animationDelay: `${800 + index * 100}ms` }}
                      title={socialLinks?.[platform] ? `Suivre sur ${label}` : `${label} non configuré`}
                      onClick={socialLinks?.[platform] ? () => window.open(socialLinks[platform], '_blank') : undefined}
                    >
                      <Icon size={18} />
                    </div>
                  ))}
                </div>
              </div>

              {/* CTA Button */}
              <div className={`pt-4 transition-all duration-700 delay-800 ${
                heroInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}>
                <Link
                  href={`/reservation?staff=${staffId}`}
                  className="group inline-flex items-center gap-3 rounded-full bg-gradient-to-r from-[#2F3A2E] to-[#1a2419] px-8 py-4 text-base font-semibold text-white shadow-lg transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:from-[#212a20] hover:to-[#151c14]"
                >
                  <Calendar size={20} />
                  Prendre rendez-vous
                  <span className="ml-1 text-white/70 transition-transform group-hover:translate-x-1">→</span>
                </Link>
              </div>

        
            </div>
          </div>

          {/* Disponibilités Section - Compact Design */}
          {workingSchedule && workingSchedule.length > 0 && (
            <div className={`mt-16 transition-all duration-700 delay-900 ${
              heroInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}>
              <div className="text-center mb-6">
                <h3 className="text-lg font-semibold text-[#2F3A2E] mb-2 flex items-center justify-center gap-2">
                  <Clock size={18} className="text-[#b89664]" />
                  Horaires de {firstName}
                </h3>
              </div>
              
              {/* Compact Horizontal Schedule */}
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-[#ede5d8] shadow-lg overflow-hidden">
                <div className="flex flex-wrap justify-center divide-y divide-[#ede5d8]/50 md:divide-y-0 md:divide-x">
                  {workingSchedule.map((schedule, index) => (
                    <div
                      key={schedule.dayFull}
                      className={`group flex-1 min-w-[140px] px-4 py-5 text-center hover:bg-[#faf8f5] transition-all duration-300 ${
                        heroInView ? "animate-in slide-in-from-bottom-2" : ""
                      }`}
                      style={{ animationDelay: `${1100 + index * 100}ms` }}
                    >
                      {/* Day */}
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-[#b89664] to-[#a08654] rounded-full flex items-center justify-center text-white font-bold text-sm group-hover:scale-110 transition-transform">
                          {schedule.day.substring(0, 1)}
                        </div>
                        <h5 className="font-medium text-[#2F3A2E] text-xs">{schedule.day}</h5>
                        
                        {/* Time Range - Compact */}
                        <div className="flex items-center gap-1 text-xs text-[#6f6a64]">
                          <span className="font-semibold">{schedule.startTime}</span>
                          <span className="text-[#9a9590]">-</span>
                          <span className="font-semibold">{schedule.endTime}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Compact Bottom Note */}
                <div className="bg-[#f8f4ed] px-6 py-3 text-center border-t border-[#ede5d8]/50">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                    <span className="text-xs text-[#6f6a64]">
                      Disponible pour rendez-vous
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Enhanced bottom divider */}
      <div
        aria-hidden="true"
        className="flex items-center justify-center gap-4 pb-12 pt-8"
      >
        <div className="flex items-center gap-3 text-[#b89664]/40">
          <span className="h-px w-20 bg-current" />
          <Heart size={16} className="fill-current" />
          <span className="h-px w-20 bg-current" />
        </div>
      </div>
    </section>
  );
}
