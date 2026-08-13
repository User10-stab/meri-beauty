import Link from "next/link";
import { Sparkles, Flame, ArrowRight } from "lucide-react";
import { getTranslations, getLocale } from "next-intl/server";
import { getHomepageBannerData } from "@/actions/workshops/get-homepage-banner-data";
import { toIntlLocale } from "@/lib/intl-locale";

async function formatSessionDate(date, locale) {
  if (!date) return null;
  return new Date(date).toLocaleDateString(toIntlLocale(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Brussels",
  });
}

async function BannerCard({ href, isLowSeats, data, sessionDate }) {
  const t = await getTranslations("workshopBanner");
  return (
    <Link
      href={href}
      className="group flex w-full items-center gap-4 rounded-2xl border border-ink/8 bg-white p-4 shadow-lg shadow-black/5 transition-all hover:-translate-y-0.5 hover:shadow-xl"
    >
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
          isLowSeats ? "bg-amber-50 text-amber-600" : "bg-gold/10 text-gold"
        }`}
      >
        {isLowSeats ? <Flame size={20} /> : <Sparkles size={20} />}
      </div>

      <div className="min-w-0 flex-1">
        <p className={`text-xs font-semibold uppercase tracking-wide ${isLowSeats ? "text-amber-600" : "text-gold"}`}>
          {isLowSeats
            ? t("lowSeats", { count: data.available })
            : t("new")}
        </p>
        <p className="truncate text-sm font-semibold text-ink">{data.activity.title}</p>
        {sessionDate && <p className="truncate text-xs text-ink/50">{sessionDate}</p>}
      </div>

      <ArrowRight size={18} className="shrink-0 text-ink/30 transition-transform group-hover:translate-x-0.5 group-hover:text-gold" />
    </Link>
  );
}

/**
 * Rendered from inside Hero's positioned wrapper so it can float over the
 * hero image on desktop (top-right corner, above the opening-hours card).
 * Below `lg`, the overlay is hidden in favor of a plain strip under the
 * hero — there's no room to float a card over the image on small screens.
 */
export default async function WorkshopBanner() {
  const result = await getHomepageBannerData();
  const data = result?.data;

  if (!data || !data.activity) return null;

  const isLowSeats = data.mode === "low_seats";
  const isFormation = data.kind === "formation";
  const sessionDate = await formatSessionDate(data.session?.startDate, await getLocale());

  const href = isLowSeats
    ? isFormation
      ? `/reservation-formation?formation=${data.activity.id}&session=${data.session.id}`
      : `/reservation-atelier?activity=${data.activity.id}&session=${data.session.id}`
    : `/evenements/${data.activity.id}`;

  return (
    <>
      {/* Mobile / tablet — plain strip below the hero */}
      <section className="bg-cream px-6 py-6 md:px-10 lg:hidden">
        <div className="mx-auto flex max-w-[1200px] justify-end">
          <div className="w-full max-w-md">
            <BannerCard href={href} isLowSeats={isLowSeats} data={data} sessionDate={sessionDate} />
          </div>
        </div>
      </section>

      {/* Desktop — floating overlay at the top-right of the hero image */}
      <div className="absolute right-6 top-8 z-20 hidden w-[320px] sm:right-10 lg:right-14 lg:block xl:right-20">
        <BannerCard href={href} isLowSeats={isLowSeats} data={data} sessionDate={sessionDate} />
      </div>
    </>
  );
}
