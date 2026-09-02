import Link from "next/link";
import PageHero from "@/components/website/PageHero";
import ReservationForm from "@/components/reservation/ReservationForm";
import { auth } from "@/auth";
import { getTranslations } from "next-intl/server";
import { Headset } from "lucide-react";

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
          <h2 className="font-display text-[1.8rem] font-semibold leading-tight tracking-tight text-[#2F3A2E] sm:text-[2rem] md:text-[3rem]">{t("reservation.heading")}</h2>
          <div className="mt-4 h-px w-10 bg-[#b89664]/20" />
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-[#6f6a64] sm:text-[15px]">{t("reservation.subtitle2")}</p>
        </div>
      </div>

      {/* Divider — always between #prestations and #booking */}
      <div aria-hidden="true" className="pointer-events-none flex items-center justify-center gap-3 py-3 text-[#b89664]/50">
        <span className="h-px w-16 bg-current" />
        <span className="h-2 w-2 rotate-45 border border-current" />
        <span className="h-px w-16 bg-current" />
      </div>

      {/* Booking flow — premium shell */}
      <div id="booking" className="mt-12 relative overflow-hidden bg-[#fdf8f0] pb-12 sm:pb-30">
        <div aria-hidden="true" className="pointer-events-none absolute left-[-82px] top-20 hidden h-56 w-56 rounded-full border border-[#b89664]/40 lg:block">
          <div className="absolute inset-5 rounded-full border border-[#b89664]/30" />
          <div className="absolute inset-11 rounded-full border border-[#b89664]/20" />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute right-8 top-28 hidden h-12 w-12 rotate-45 border border-[#b89664]/45 lg:block">
          <div className="absolute inset-2 border border-[#b89664]/30" />
        </div>
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
          <ReservationForm customerSession={customerSession} />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-1/2 hidden -translate-x-1/2 items-center gap-3 text-[#b89664]/50 sm:flex">
          <span className="h-px w-16 bg-current" />
          <span className="h-2 w-2 rotate-45 border border-current" />
          <span className="h-px w-16 bg-current" />
        </div>
      </div>

      {/* Help — premium card */}
      <div className="relative mt-20 w-full overflow-hidden bg-[#fdf8f0] px-4 pb-10 sm:px-6 sm:pb-12">
        <div aria-hidden="true" className="pointer-events-none absolute bottom-3 left-8 hidden h-20 w-20 border border-[#b89664]/28 lg:block" />
        <div aria-hidden="true" className="pointer-events-none absolute bottom-[-42px] right-12 hidden h-32 w-32 rounded-full border border-[#b89664]/35 lg:block" />
        <div className="relative mx-auto max-w-3xl rounded-[1.5rem] border border-[#ede5d8]/60 bg-[#fdf8f0] px-6 py-8 text-center shadow-[0_8px_28px_rgba(47,58,46,0.06)] sm:px-8 sm:py-9">
          <div className="mx-auto mb-3 flex  items-center justify-center rounded-full text-[#2F3A2E]">
            <Headset size={25} strokeWidth={1.8} aria-hidden="true" />
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
