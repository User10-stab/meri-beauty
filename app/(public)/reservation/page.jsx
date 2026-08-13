import PageHero from "@/components/website/PageHero";
import ReservationForm from "@/components/reservation/ReservationForm";
import { auth } from "@/auth";
import { getTranslations } from "next-intl/server";

export default async function Page() {
  const session = await auth();
  const t = await getTranslations();

  // Only pass customer session data — staff/admin sessions are irrelevant here
  const customerSession =
    session?.user?.role === "CUSTOMER" ? session.user : null;

  return (
    <div className="w-full bg-white">
      {/* Hero Section */}
      <div className="relative">
        <PageHero
          title={t("reservation.title")}
          description={t("reservation.subtitle")}
          buttonText={t("reservation.title").toUpperCase()}
          buttonLink="#booking"
          backgroundImage="/Images/heroImage.webp"
          label={t("reservation.label")}
        />

        {/* Floating card */}
        <div className="absolute bottom-10 right-10 w-72 rounded-3xl bg-white/95 p-7 shadow-2xl backdrop-blur z-20 hidden lg:block">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#C8A46A]">
            {t("nav.booking")}
          </p>
          <h3 className="mt-3 text-2xl font-semibold text-[#2F3A2E]">{t("reservation.quickSimple")}</h3>
          <p className="mt-4 leading-7 text-gray-500">
            {t("reservation.description")}
          </p>
        </div>
      </div>

      {/* Reservation Form */}
      <div className=" flex flex-col items-center justify-center pt-20 pb-10">
        <h2 className="mb-3 font-display text-[2rem] font-bold leading-[1.08] tracking-tight text-primary sm:text-[2.4rem] lg:text-[3rem]">{t("reservation.heading")}</h2>
        <p>{t("reservation.subtitle2")}</p>
      </div>
      <div id="booking" className="bg-gradient-to-b from-white to-gray-50">
        <ReservationForm customerSession={customerSession} />
      </div>
    </div>
  );
}
