"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { toggleNewsletterSubscription } from "@/actions/newsletter/toggle-subscription";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

function InstagramIcon({ className = "w-5 h-5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );
}

function TiktokIcon({ className = "w-5 h-5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.19 8.19 0 004.8 1.54V6.79a4.86 4.86 0 01-1.03-.1z" />
    </svg>
  );
}

function FacebookIcon({ className = "w-5 h-5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M13.5 21v-7h2.3l.35-2.7h-2.65v-1.7c0-.78.22-1.31 1.34-1.31h1.42V5.85c-.25-.03-1.1-.11-2.09-.11-2.07 0-3.49 1.26-3.49 3.58v2h-2.34V14h2.34v7h2.77z" />
    </svg>
  );
}

function LeafBulletIcon({ className = "w-2.5 h-3" }) {
  return (
    <svg viewBox="0 0 12 16" fill="none" className={className} aria-hidden="true">
      <path d="M6 1.5C6 1.5 3.5 4 3.5 7.5c0 2 1.1 3.7 2.5 4.8 1.4-1.1 2.5-2.8 2.5-4.8C8.5 4 6 1.5 6 1.5Z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M6 12.3V15" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
      <path d="M4.6 5.5c.4.3.9.5 1.4.6M7.4 7.2c-.4.2-.9.3-1.4.3M4.6 9c.4.2.9.3 1.4.4" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" />
    </svg>
  );
}

function ArrowRightIcon({ className = "w-4 h-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MapPinIcon({ className = "w-4 h-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} className={className} aria-hidden="true">
      <path d="M12 2C8.686 2 6 4.686 6 8c0 4.418 6 13 6 13s6-8.582 6-13c0-3.314-2.686-6-6-6Z" strokeLinejoin="round" />
      <circle cx="12" cy="8" r="1.7" />
    </svg>
  );
}

function PhoneIcon({ className = "w-4 h-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} className={className} aria-hidden="true">
      <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z" />
    </svg>
  );
}

function MailIcon({ className = "w-4 h-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} className={className} aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="1.8" />
      <path d="m2 7 10 7 10-7" />
    </svg>
  );
}

function BookIcon({ className = "w-4 h-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} className={className} aria-hidden="true">
      <path d="M4 6.5A2.5 2.5 0 016.5 4H12v15H6.5A2.5 2.5 0 004 16.5v-10Z" />
      <path d="M12 4h5.5A2.5 2.5 0 0120 6.5v10A2.5 2.5 0 0017.5 19H12V4Z" />
    </svg>
  );
}

function DividerLeafIcon({ className = "w-8 h-3" }) {
  return (
    <svg viewBox="0 0 32 10" fill="none" className={className} aria-hidden="true">
      <path d="M16 5c-1.5-1.2-3.2-1.8-5-1.8 1.2 1 2.1 2.3 2.6 3.8-.5-1.5-1.4-2.8-2.6-3.8 1.8 0 3.5.6 5 1.8 1.5-1.2 3.2-1.8 5-1.8-1.2 1-2.1 2.3-2.6 3.8.5-1.5 1.4-2.8 2.6-3.8-1.8 0-3.5.6-5 1.8Z" stroke="currentColor" strokeWidth="0.7" strokeLinejoin="round" />
      <path d="M4 5h6M22 5h6" stroke="currentColor" strokeWidth="0.6" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

/* ── Botanical side decorations ── */
function BotanicalLeft() {
  return (
    <svg viewBox="0 0 180 420" fill="none" className="h-[420px] w-[160px] text-gold/35" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* main stem */}
        <path d="M38 400 C 42 310, 34 230, 48 150 C 56 90, 62 45, 66 18" opacity="0.9" />
        {/* branches / leaves - left side */}
        <path d="M48 150 C 32 138, 18 128, 10 118 C 18 112, 30 118, 48 150" />
        <path d="M46 175 C 28 166, 14 158, 7 148 C 16 142, 30 150, 46 175" />
        <path d="M44 200 C 26 192, 12 183, 5 173 C 15 168, 29 176, 44 200" />
        <path d="M42 230 C 24 222, 10 213, 4 203 C 14 198, 28 206, 42 230" />
        <path d="M40 260 C 24 252, 11 243, 5 233 C 15 228, 28 236, 40 260" />
        <path d="M39 290 C 23 283, 11 275, 6 265 C 16 260, 28 268, 39 290" />
        <path d="M38 320 C 22 313, 10 305, 5 295 C 15 290, 27 298, 38 320" />
        {/* right side of main stem */}
        <path d="M50 140 C 62 130, 74 122, 82 112 C 74 108, 62 116, 50 140" />
        <path d="M52 165 C 66 155, 78 147, 86 137 C 78 133, 64 141, 52 165" />
        <path d="M51 190 C 65 180, 77 172, 85 162 C 77 158, 63 166, 51 190" />
        <path d="M49 215 C 63 205, 75 197, 83 187 C 75 183, 61 191, 49 215" />
        <path d="M66 18 C 58 10, 50 6, 42 4 C 48 14, 58 18, 66 18" />
        <path d="M66 18 C 74 12, 82 8, 90 6 C 84 14, 74 18, 66 18" />
        {/* small fern-like leaves along bottom */}
        <path d="M38 400 C 30 390, 22 385, 16 382" />
        <path d="M38 400 C 46 390, 54 385, 60 382" />
      </g>
      {/* leaf fills very subtle */}
      <g fill="currentColor" opacity="0.07">
        <ellipse cx="14" cy="118" rx="10" ry="5" transform="rotate(-22 14 118)" />
        <ellipse cx="12" cy="148" rx="10" ry="5" transform="rotate(-18 12 148)" />
        <ellipse cx="11" cy="178" rx="10" ry="5" transform="rotate(-16 11 178)" />
      </g>
    </svg>
  );
}

function BotanicalRight() {
  return (
    <svg viewBox="0 0 170 420" fill="none" className="h-[420px] w-[150px] text-gold/28" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M120 400 C 118 320, 124 240, 118 160 C 114 100, 110 50, 106 16" opacity="0.85" />
        {/* left side branches */}
        <path d="M118 165 C 104 157, 90 149, 82 139 C 90 135, 104 143, 118 165" />
        <path d="M118 190 C 104 182, 90 174, 82 164 C 90 160, 104 168, 118 190" />
        <path d="M119 215 C 105 207, 91 199, 83 189 C 91 185, 105 193, 119 215" />
        <path d="M119 242 C 105 234, 91 226, 83 216 C 91 212, 105 220, 119 242" />
        <path d="M120 270 C 106 262, 92 254, 84 244 C 92 240, 106 248, 120 270" />
        <path d="M120 298 C 108 290, 96 282, 88 272 C 96 268, 108 276, 120 298" />
        {/* right side branches */}
        <path d="M118 155 C 132 147, 146 139, 154 129 C 146 125, 132 133, 118 155" />
        <path d="M119 182 C 133 174, 147 166, 155 156 C 147 152, 133 160, 119 182" />
        <path d="M119 210 C 133 202, 147 194, 155 184 C 147 180, 133 188, 119 210" />
        <path d="M120 235 C 134 227, 148 219, 156 209 C 148 205, 134 213, 120 235" />
        <path d="M120 262 C 134 254, 148 246, 156 236 C 148 232, 134 240, 120 262" />
        <path d="M106 16 C 98 10, 90 6, 82 4 C 88 12, 98 16, 106 16" />
        <path d="M106 16 C 114 10, 122 6, 130 4 C 124 12, 114 16, 106 16" />
      </g>
    </svg>
  );
}

export default function Footer({ salon }) {
  const t = useTranslations("footer");
  const { status } = useSession();
  const isPending = status === "loading";
  const isAuthed = status === "authenticated";
  const [email, setEmail] = useState("");
  const [subscribing, setSubscribing] = useState(false);
  const [feedback, setFeedback] = useState({ type: null, message: "" });

  const handleSubscribe = async (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setFeedback({ type: "error", message: t("invalidEmail") });
      return;
    }
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
    if (!valid) {
      setFeedback({ type: "error", message: t("invalidEmail") });
      return;
    }
    if (!isAuthed) {
      signIn(undefined, { callbackUrl: "/" });
      return;
    }
    setFeedback({ type: null, message: "" });
    setSubscribing(true);
    const result = await toggleNewsletterSubscription();
    setSubscribing(false);
    if (result.success) setFeedback({ type: "success", message: result.message });
    else setFeedback({ type: "error", message: result.message });
  };

  const dayLabels = {
    MONDAY: t("monday"), TUESDAY: t("tuesday"), WEDNESDAY: t("wednesday"),
    THURSDAY: t("thursday"), FRIDAY: t("friday"), SATURDAY: t("saturday"), SUNDAY: t("sunday"),
  };

  const navigation = [
    { label: t("home"), href: "/" },
    { label: t("concept"), href: "/#concept" },
    { label: t("prestations"), href: "/#concept" },
    { label: t("team"), href: "/#equipe" },
    { label: t("shop"), href: "/boutique" },
    { label: t("events"), href: "/evenements" },
    { label: t("courses"), href: "/formations" },
    { label: t("contact"), href: "/contact" },
  ];

  const addressText = salon?.address?.trim() || "Rue Bonaventure 113, 1090 Jette";
  const addressParts = addressText.split(",").map((p) => p.trim());
  const phoneText = salon?.phone?.trim() || "+32 489 69 70 47";
  const emailText = salon?.email?.trim() || "contact@meribeautystudio.com";
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText)}`;
  const instagramHref = salon?.instagram || "https://www.instagram.com/";

  /* ── Group working days like the picture: Mon–Fri / Sat / Sun ── */
  const WORKING_ORDER = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"];
  function getGroupedDays() {
    const wd = salon?.workingDays ?? [];
    if (!wd.length) return null;
    const sorted = [...wd].sort((a,b) => WORKING_ORDER.indexOf(a.day) - WORKING_ORDER.indexOf(b.day));
    const groups = [];
    for (const cur of sorted) {
      const hours = cur.isOpen ? `${cur.openingTime?.slice(0,5)} – ${cur.closingTime?.slice(0,5)}` : "__CLOSED__";
      const last = groups[groups.length-1];
      if (last && last.hours === hours) last.days.push(cur.day);
      else groups.push({ days:[cur.day], hours });
    }
    return groups.map((g) => {
      const first = g.days[0], last = g.days[g.days.length-1];
      const label = g.days.length === 1 ? dayLabels[first] : `${dayLabels[first]} – ${dayLabels[last]}`;
      const isClosed = g.hours === "__CLOSED__";
      return { label, hours: isClosed ? t("closed") : g.hours, isClosed };
    });
  }
  const groupedHours = getGroupedDays();
  const fallbackGrouped = [
    { label: `${t("monday")} – ${t("friday")}`, hours: "10:00 – 18:00", isClosed: false },
    { label: t("saturday"), hours: "10:00 – 16:00", isClosed: false },
    { label: t("sunday"), hours: t("closed"), isClosed: true },
  ];
  const displayHours = groupedHours ?? fallbackGrouped;

  return (
    <footer className="relative w-full overflow-hidden bg-primary">
      {/* Botanical decorations */}
      <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 hidden lg:block">
        <BotanicalLeft />
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute bottom-0 right-0 hidden lg:block">
        <BotanicalRight />
      </div>

      {/* top hairline */}
      <div className="h-px w-full bg-gold/15" />

      <div className="relative mx-auto max-w-[1400px] px-6 pt-12 pb-0 md:px-8 lg:px-10 xl:px-12 lg:pt-14">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8 xl:gap-10">

          {/* ── Col 1: Brand ── */}
          <div>
            <Link href="/" aria-label={`${t("siteName")} — ${t("home")}`} className="inline-block">
              <Image
                src="/Images/Logo.webp"
                alt="MeriBeauty Studio"
                width={160}
                height={52}
                className="mb-6 h-[42px] w-auto brightness-0 invert"
              />
            </Link>

            <p className="max-w-[260px] text-[12.5px] leading-[1.75] text-white/55">
              {t("description")}
            </p>

            <div className="mt-7 flex gap-3">
              <a
                href={instagramHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-gold/30 text-white/70 transition-all duration-200 hover:border-gold/60 hover:bg-gold/10 hover:text-gold"
              >
                <InstagramIcon className="h-[15px] w-[15px]" />
              </a>
              <a
                href={salon?.tiktok || "https://www.tiktok.com/"}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="TikTok"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-gold/30 text-white/70 transition-all duration-200 hover:border-gold/60 hover:bg-gold/10 hover:text-gold"
              >
                <TiktokIcon className="h-[15px] w-[15px]" />
              </a>
              <a
                href={salon?.facebook || "https://www.facebook.com/"}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Facebook"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-gold/30 text-white/70 transition-all duration-200 hover:border-gold/60 hover:bg-gold/10 hover:text-gold"
              >
                <FacebookIcon className="h-[15px] w-[15px]" />
              </a>
            </div>
          </div>

          {/* ── Col 2: Découvrir ── */}
          <div>
            <h4 className="mb-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
              {t("discover")}
            </h4>
            <ul className="flex flex-col gap-[11px]">
              {navigation.map((link) => (
                <li key={link.label} className="flex items-center gap-2.5">
                  <LeafBulletIcon className="h-3.5 w-2.5 shrink-0 text-gold/70" />
                  <Link
                    href={link.href}
                    className="text-[13px] leading-none text-white/60 transition-colors duration-200 hover:text-white"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Col 3: Venir chez MeriBeauty + Horaires ── */}
          <div>
            <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
              {t("comeTitle")}
            </h4>

            <ul className="flex flex-col gap-3.5">
              <li className="flex items-start gap-2.5">
                <MapPinIcon className="mt-0.5 h-[15px] w-[15px] shrink-0 text-gold/80" />
                <span className="text-[12.5px] leading-[1.6] text-white/60">
                  {addressParts.map((part, i) => (
                    <span key={i}>{i > 0 && <br />}{part}</span>
                  ))}
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <PhoneIcon className="h-[15px] w-[15px] shrink-0 text-gold/80" />
                <a href={`tel:${phoneText.replace(/\s+/g, "")}`} className="text-[12.5px] text-white/60 transition-colors hover:text-white">
                  {phoneText}
                </a>
              </li>
              <li className="flex items-center gap-2.5">
                <MailIcon className="h-[15px] w-[15px] shrink-0 text-gold/80" />
                <a href={`mailto:${emailText}`} className="text-[12.5px] text-white/60 transition-colors hover:text-white">
                  {emailText}
                </a>
              </li>
              <li className="flex items-center gap-2.5">
                <BookIcon className="h-[15px] w-[15px] shrink-0 text-gold/80" />
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12.5px] font-medium text-gold transition-colors hover:text-gold-soft"
                >
                  {t("directions")} <span aria-hidden="true">→</span>
                </a>
              </li>
            </ul>

            <div className="my-5 h-px bg-gold/20" />

            <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
              {t("hoursTitle")}
            </h4>

            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/85">
              {t("boutiqueHours")}
            </p>
            <ul className="flex flex-col gap-1.5">
              {displayHours.map((row) => (
                <li key={row.label} className="flex items-center justify-between gap-4">
                  <span className="text-[12.5px] leading-none text-white/50">{row.label}</span>
                  <span className={`text-[12.5px] leading-none ${row.isClosed ? "text-white/50" : "font-medium text-white/75"}`}>
                    {row.hours}
                  </span>
                </li>
              ))}
            </ul>

            <div className="my-5 h-px bg-gold/20" />

            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/85">
              {t("salonHours")}
            </p>
            <p className="text-[12.5px] font-medium leading-none text-white/70">{t("byAppointment")}</p>
            <p className="mt-1.5 text-[11.5px] italic leading-[1.6] text-white/45">{t("hoursByProvider")}</p>
          </div>

          {/* ── Col 4: Newsletter ── */}
          <div>
            <h4 className="text-[11px] font-semibold uppercase leading-[1.5] tracking-[0.14em] text-gold">
              {t("newsletterTitle")}
            </h4>
            <p className="mt-3 max-w-[300px] text-[12.5px] leading-[1.7] text-white/55">
              {t("newsletterDescription")}
            </p>

            <form onSubmit={handleSubscribe} className="mt-6 w-full max-w-[320px]">
              {feedback.message && (
                <div className={`mb-3 rounded-lg px-3 py-2 text-[12px] font-medium ${feedback.type === "success" ? "bg-green-900/30 text-green-300" : "bg-red-900/30 text-red-300"}`}>
                  {feedback.message}
                </div>
              )}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                className="w-full rounded-xl border border-white/20 bg-white/[0.04] px-4 py-[11px] text-[12.5px] text-white placeholder:text-white/40 outline-none transition-colors focus:border-gold/50 focus:bg-white/[0.07]"
                aria-label={t("emailPlaceholder")}
              />
              <button
                type="submit"
                disabled={subscribing || isPending}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gold px-6 py-[11px] text-[13px] font-semibold text-white shadow-md shadow-black/20 transition-all duration-200 hover:bg-[#c4a070] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {subscribing ? (
                  <><Loader2 size={16} className="animate-spin" /> {t("subscribing")}</>
                ) : (
                  <>{t("subscribe")} <span aria-hidden="true">→</span></>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* ── Bottom bar ── */}
        <div className="mt-10 flex flex-col items-center gap-3 border-t border-white/10 py-5 lg:mt-12 lg:flex-row lg:justify-between">
          <p className="text-center text-[11.5px] text-white/35 lg:text-left">
            © {new Date().getFullYear()} MeriBeauty. {t("rightsReserved")}
          </p>

          <div aria-hidden="true" className="hidden items-center text-gold/50 lg:flex">
            <DividerLeafIcon className="h-3 w-8" />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-y-1 text-[11.5px] text-white/35">
            <Link href="/cgv" className="px-2.5 py-1 transition-colors hover:text-white/70">{t("terms")}</Link>
            <span aria-hidden="true" className="text-gold/30">|</span>
            <Link href="/boutique/returns" className="px-2.5 py-1 transition-colors hover:text-white/70">{t("returns")}</Link>
            <span aria-hidden="true" className="text-gold/30">|</span>
            <Link href="/mentions-legales" className="px-2.5 py-1 transition-colors hover:text-white/70">{t("legalNotice")}</Link>
            <span aria-hidden="true" className="text-gold/30">|</span>
            <Link href="/politique-de-confidentialite" className="px-2.5 py-1 transition-colors hover:text-white/70">{t("privacyPolicy")}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
