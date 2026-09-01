import Link from "next/link";
import PageHero from "@/components/website/PageHero";
import ReservationForm from "@/components/reservation/ReservationForm";
import { auth } from "@/auth";
import { getTranslations } from "next-intl/server";

export default async function Page() {
  const session = await auth();
  const t = await getTranslations();

  const customerSession = session?.user?.role === "CUSTOMER" ? session.user : null;

  return (
    <div className="w-full bg-[#fdf8f0]">
      <PageHero
        title={t("reservation.title")}
        description={t("reservation.subtitle")}
        buttonText={t("reservation.button")}
        buttonLink="#prestations"
        backgroundImage="/Images/heroImage.webp"
        label={t("reservation.label")}
      />

      {/* Intro — heading band */}
      <div id="prestations" className="relative overflow-hidden bg-[#fdf8f0]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.035]" style={{ backgroundImage: "repeating-linear-gradient(90deg,#b89664 0px,#b89664 1px,transparent 1px,transparent 80px)" }} />
        <div className="relative flex flex-col items-center justify-center px-4 py-12 text-center sm:px-6 sm:py-14">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.32em] text-[#b89664]">{t("reservation.servicesEyebrow")}</p>
          <h2 className="font-display text-[1.7rem] font-semibold leading-tight tracking-tight text-[#2F3A2E] sm:text-[2rem] md:text-[2.5rem]">{t("reservation.heading")}</h2>
          <div className="mt-4 h-px w-10 bg-[#b89664]/20" />
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[#6f6a64] sm:text-[15px]">{t("reservation.subtitle2")}</p>
        </div>
      </div>

      {/* Booking flow — premium shell */}
      <div id="booking" className="bg-[#fdf8f0] pb-8 sm:pb-10">
        <div className="mx-auto max-w-[1280px] px-0 sm:px-4 lg:px-6">
          <ReservationForm customerSession={customerSession} />
        </div>
      </div>

      {/* Help — premium card */}
      <div className="w-full mt-20 bg-[#fdf8f0] px-4 pb-10 sm:px-6 sm:pb-12">
        <div className="mx-auto max-w-3xl rounded-[1.5rem] border border-[#ede5d8]/60 bg-[#fdf8f0] px-6 py-8 text-center shadow-[0_8px_28px_rgba(47,58,46,0.06)] sm:px-8 sm:py-9">
          <div className="mx-auto mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-[#2F3A2E] text-white">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2a7 7 0 0 0-7 7c0 3.5 2.5 6.5 7 9 4.5-2.5 7-5.5 7-9a7 7 0 0 0-7-7Z" /><path d="M9 12h6" /></svg>
          </div>
          <h3 className="font-display text-[17px] font-semibold text-[#2F3A2E] sm:text-lg">{t("reservation.helpTitle")}</h3>
          <p className="mx-auto mt-2.5 max-w-xl text-[13px] leading-relaxed text-[#6f6a64] sm:text-sm">{t("reservation.helpText")}</p>
          <Link href="/contact" className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-[#2F3A2E] px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#212a20] hover:shadow-md">
            {t("reservation.helpCta")}
          </Link>
        </div>
      </div>
    </div>
  );
}
