"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import SiteHeader from "@/components/website/SiteHeader";
import Footer from "@/components/website/Footer";

/*
 * Page 404 (rendue par app/not-found.js).
 *
 * Le not-found racine est rendu dans le seul layout racine : ni l'en-tête ni
 * le pied de page du site (app/(public)/layout.js) n'y apparaissaient — un
 * visiteur arrivé sur une URL morte n'avait ni logo, ni menu, ni lien de
 * réservation (audit MB-013). On les rend donc ici.
 *
 * Le même not-found sert aussi aux notFound() du tableau de bord et aux URL
 * /dashboard/... inconnues : là, on garde l'ancienne page sobre, sans le
 * chrome du site public.
 */
export default function PublicNotFound({ salon = null }) {
  const pathname = usePathname() ?? "";
  const t = useTranslations("notFoundPage");
  const isDashboard = pathname === "/dashboard" || pathname.startsWith("/dashboard/");

  const content = (
    <div
      className={`flex w-full flex-col items-center justify-center bg-cream px-6 text-center ${
        isDashboard ? "min-h-screen" : "min-h-[70vh] py-24"
      }`}
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">{t("eyebrow")}</span>
      <h1 className="mt-4 font-display text-[2.4rem] font-bold leading-[1.1] tracking-tight text-ink sm:text-[3rem]">
        {t("title")}
      </h1>
      <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink/55">{t("body")}</p>
      <div className="mt-8 flex w-full max-w-xs flex-col items-center gap-3 sm:w-auto sm:max-w-none sm:flex-row">
        {/* Même destination que le bouton « Prendre un rendez-vous » de l'accueil (Hero). */}
        {!isDashboard && (
          <Link
            href="/reservation#booking"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold px-8 py-3.5 text-[15px] font-semibold text-white shadow-lg transition-all duration-300 hover:bg-gold/90 hover:shadow-xl hover:shadow-gold/20 sm:w-auto"
          >
            {t("book")}
          </Link>
        )}
        <Link
          href="/"
          className={
            isDashboard
              ? "inline-flex items-center gap-2 rounded-full bg-gold px-8 py-3.5 text-[15px] font-semibold text-white shadow-lg transition-all duration-300 hover:bg-gold/90 hover:shadow-xl hover:shadow-gold/20"
              : "inline-flex w-full items-center justify-center gap-2 rounded-full border border-gold/50 bg-white px-8 py-3.5 text-[15px] font-semibold text-gold transition-all duration-300 hover:border-gold hover:bg-gold hover:text-white sm:w-auto"
          }
        >
          {t("home")}
        </Link>
      </div>
    </div>
  );

  if (isDashboard) return content;

  return (
    <>
      <SiteHeader />
      <main className="w-full bg-white [&_h1]:font-display [&_h2]:font-display [&_h3]:font-display">
        {content}
      </main>
      <Footer salon={salon} />
    </>
  );
}
