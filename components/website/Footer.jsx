"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { toggleNewsletterSubscription } from "@/actions/newsletter/toggle-subscription";
import { Loader2, LogIn } from "lucide-react";

const DAY_LABELS = {
  MONDAY: "Lundi",
  TUESDAY: "Mardi",
  WEDNESDAY: "Mercredi",
  THURSDAY: "Jeudi",
  FRIDAY: "Vendredi",
  SATURDAY: "Samedi",
  SUNDAY: "Dimanche",
};

const NAVIGATION = [
  { label: "Accueil", href: "/" },
  { label: "Concept", href: "/#concept" },
  { label: "Réservation", href: "/reservation" },
  { label: "Boutique", href: "/boutique" },
  { label: "Évènements & Ateliers", href: "/evenements" },
  { label: "Formations", href: "/formations" },
  { label: "Contact", href: "/contact" },
];

const FALLBACK_SERVICES = [
  "Soins Visage",
  "Coiffure",
  "Manucure",
  "Massage Bien-être",
  "Maquillage",
  "Rituels Corps",
  "Beauty Coaching",
];

function InstagramIcon({ className = "w-5 h-5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );
}

function FacebookIcon({ className = "w-5 h-5" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
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

function ArrowRightIcon({ className = "w-4 h-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MapPinIcon({ className = "w-4 h-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      <path d="M12 2C8.686 2 6 4.686 6 8c0 4.418 6 13 6 13s6-8.582 6-13c0-3.314-2.686-6-6-6Z" strokeLinejoin="round" />
      <circle cx="12" cy="8" r="2" />
    </svg>
  );
}

function PhoneIcon({ className = "w-4 h-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z" />
    </svg>
  );
}

function MailIcon({ className = "w-4 h-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 7 10 7 10-7" />
    </svg>
  );
}

export default function Footer({ salon, services = [] }) {
  const { data: session, status } = useSession();
  const isAuthed = status === "authenticated";
  const isPending = status === "loading";
  const [subscribing, setSubscribing] = useState(false);
  const [feedback, setFeedback] = useState({ type: null, message: "" });

  const handleSubscribe = async (e) => {
    e.preventDefault();

    if (!isAuthed) {
      signIn(undefined, { callbackUrl: "/" });
      return;
    }

    setFeedback({ type: null, message: "" });
    setSubscribing(true);

    const result = await toggleNewsletterSubscription();
    setSubscribing(false);

    if (result.success) {
      setFeedback({ type: "success", message: result.message });
    } else {
      setFeedback({ type: "error", message: result.message });
    }
  };

  const openDays = (salon?.workingDays ?? []).filter((d) => d.isOpen);
  const closedDays = (salon?.workingDays ?? []).filter((d) => !d.isOpen);

  const socialLinks = [
    { icon: InstagramIcon, href: salon?.instagram || "#", label: "Instagram" },
    { icon: FacebookIcon, href: salon?.facebook || "#", label: "Facebook" },
    { icon: TiktokIcon, href: salon?.tiktok || "#", label: "TikTok" },
  ];

  return (
    <footer className="relative w-full overflow-hidden bg-primary">
      <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-gold/40 to-transparent" />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg,#b89664 0px,#b89664 1px,transparent 1px,transparent 80px)",
        }}
      />

      <div className="relative mx-auto max-w-[1400px] px-6 pt-16 pb-8 md:px-10 lg:px-14 lg:pt-20">
        <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 lg:grid-cols-5 lg:gap-10 xl:gap-16">

          {/* ── Col 1: Brand ── */}
          <div className="lg:col-span-1">
            <Link href="#accueil" aria-label="MeriBeauty — Accueil">
              <Image
                src="/Images/Logo.webp"
                alt="MeriBeauty Studio"
                width={140}
                height={60}
                className="mb-5 h-[50px] w-auto"
              />
            </Link>

            <p className="mb-6 text-[13px] leading-[1.8] text-white/50">
              {salon?.description || "Salon de beauté & bien-être à Jette. Un espace pensé pour révéler votre beauté avec justesse."}
            </p>

            <div className="flex gap-3">
              {socialLinks.map(({ icon: Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-white/50 transition-all duration-200 hover:border-gold/50 hover:bg-gold/10 hover:text-gold"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          {/* ── Col 2: Navigation ── */}
          <div>
            <h4 className="mb-5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold">
              Navigation
            </h4>
            <ul className="flex flex-col gap-3">
              {NAVIGATION.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-[13px] text-white/50 transition-colors duration-200 hover:text-white"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Col 3: Services ── */}
          <div>
            <h4 className="mb-5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold">
              Nos Services
            </h4>
            <ul className="flex flex-col gap-3">
              {(services.length > 0 ? services : FALLBACK_SERVICES).slice(0, 7).map((service) => (
                <li key={typeof service === "string" ? service : service.id}>
                  <a
                    href="#services"
                    className="text-[13px] text-white/50 transition-colors duration-200 hover:text-white"
                  >
                    {typeof service === "string" ? service : service.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Col 4: Contact + Hours ── */}
          <div>
            <h4 className="mb-5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold">
              Informations
            </h4>

            <ul className="mb-7 flex flex-col gap-3">
              {salon?.address && (
                <li className="flex items-start gap-2.5">
                  <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-gold/60" />
                  <span className="text-[13px] leading-snug text-white/50">
                    {salon.address.split(",").map((part, i) => (
                      <span key={i}>{i > 0 && <br />}{part.trim()}</span>
                    ))}
                  </span>
                </li>
              )}
              {salon?.phone && (
                <li className="flex items-center gap-2.5">
                  <PhoneIcon className="h-4 w-4 shrink-0 text-gold/60" />
                  <a
                    href={`tel:${salon.phone.replace(/\s+/g, "")}`}
                    className="text-[13px] text-white/50 transition-colors hover:text-white"
                  >
                    {salon.phone}
                  </a>
                </li>
              )}
              {salon?.email && (
                <li className="flex items-center gap-2.5">
                  <MailIcon className="h-4 w-4 shrink-0 text-gold/60" />
                  <a
                    href={`mailto:${salon.email}`}
                    className="text-[13px] text-white/50 transition-colors hover:text-white"
                  >
                    {salon.email}
                  </a>
                </li>
              )}
            </ul>

            <h4 className="mb-4 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold">
              Horaires
            </h4>
            <ul className="flex flex-col gap-2">
              {(salon?.workingDays ?? []).map(({ day, isOpen, openingTime, closingTime }) => (
                <li key={day} className="flex items-center justify-between gap-4">
                  <span className="text-[12px] text-white/40">{DAY_LABELS[day]}</span>
                  <span className="text-[12px] font-medium text-white/65">
                    {isOpen
                      ? `${openingTime?.slice(0, 5)} – ${closingTime?.slice(0, 5)}`
                      : "Fermé"}
                  </span>
                </li>
              ))}
              {(!salon?.workingDays || salon.workingDays.length === 0) && (
                <li>
                  <span className="text-[12px] text-white/30">Non définis</span>
                </li>
              )}
            </ul>
          </div>

          {/* ── Col 5: Newsletter ── */}
          <div>
            <h4 className="mb-5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold">
              Newsletter
            </h4>
            <p className="mb-5 text-[13px] leading-[1.7] text-white/50">
              Recevez nos actualités & offres exclusives.
            </p>

            {feedback.message && (
              <div className={`mb-3 rounded-lg px-3 py-2 text-[12px] font-medium ${
                feedback.type === "success"
                  ? "bg-green-900/30 text-green-300"
                  : "bg-red-900/30 text-red-300"
              }`}>
                {feedback.message}
              </div>
            )}

            <form onSubmit={handleSubscribe} className="flex flex-col gap-3">
              {isAuthed ? (
                <p className="text-[13px] text-white/50">
                  Vous êtes connecté en tant que <span className="text-white/70">{session.user.email}</span>.
                </p>
              ) : isPending ? (
                <p className="flex items-center gap-2 text-[13px] text-white/50">
                  <Loader2 size={14} className="animate-spin" />
                  Chargement…
                </p>
              ) : null}

              <button
                type="submit"
                disabled={subscribing || isPending}
                className="group flex items-center justify-center gap-2 rounded-xl bg-gold px-5 py-3 text-[13px] font-semibold text-white shadow-lg shadow-gold/20 transition-all duration-200 hover:bg-gold/90 hover:shadow-gold/30 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {subscribing ? (
                  <><Loader2 size={16} className="animate-spin" /> Inscription…</>
                ) : !isAuthed ? (
                  <><LogIn size={16} /> Se connecter pour s'inscrire</>
                ) : (
                  <>
                    S'inscrire
                    <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-white/8 pt-7 sm:flex-row">
          <p className="text-[12px] text-white/30">
            &copy; {new Date().getFullYear()} {salon?.name || "MeriBeauty"}. Tous droits réservés.
          </p>
          <div className="flex gap-5">
            <Link
              href="/boutique/returns"
              className="text-[12px] text-white/30 transition-colors hover:text-white/60"
            >
              Retourner un article
            </Link>
            <Link
              href="/cgv"
              className="text-[12px] text-white/30 transition-colors hover:text-white/60"
            >
              CGV
            </Link>
            <Link
              href="/mentions-legales"
              className="text-[12px] text-white/30 transition-colors hover:text-white/60"
            >
              Mentions légales
            </Link>
            <Link
              href="/politique-de-confidentialite"
              className="text-[12px] text-white/30 transition-colors hover:text-white/60"
            >
              Politique de confidentialité
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
