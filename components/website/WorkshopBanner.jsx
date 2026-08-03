import Link from "next/link";
import { Sparkles, Flame, ArrowRight } from "lucide-react";
import { getHomepageBannerData } from "@/actions/workshops/get-homepage-banner-data";

function formatSessionDate(date) {
  if (!date) return null;
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default async function WorkshopBanner() {
  const result = await getHomepageBannerData();
  const data = result?.data;

  if (!data || !data.activity) return null;

  const isLowSeats = data.mode === "low_seats";
  const sessionDate = formatSessionDate(data.session?.startDate);

  const href = isLowSeats
    ? `/reservation-atelier?activity=${data.activity.id}&session=${data.session.id}`
    : `/evenements/${data.activity.id}`;

  return (
    <section className="bg-cream px-6 py-6 md:px-10">
      <div className="mx-auto max-w-[1200px] flex justify-end">
        <Link
          href={href}
          className="group flex w-full max-w-md items-center gap-4 rounded-2xl border border-ink/8 bg-white p-4 shadow-lg shadow-black/5 transition-all hover:-translate-y-0.5 hover:shadow-xl"
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
                ? `Il reste juste ${data.available} place${data.available > 1 ? "s" : ""} !`
                : "Nouveau"}
            </p>
            <p className="truncate text-sm font-semibold text-ink">{data.activity.title}</p>
            {sessionDate && <p className="truncate text-xs text-ink/50">{sessionDate}</p>}
          </div>

          <ArrowRight size={18} className="shrink-0 text-ink/30 transition-transform group-hover:translate-x-0.5 group-hover:text-gold" />
        </Link>
      </div>
    </section>
  );
}
