import Link from "next/link";
import { getPublicFormations } from "@/actions/formations/get-public-formations";
import { AnimatedCard } from "@/components/website/AnimatedCard";
import { getLocale, getTranslations } from "next-intl/server";

export const metadata = {
  title: "Formations — Meri Beauty",
  description: "Formations professionnelles privées et de groupe animées par nos expertes.",
};

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18M8 2v4M16 2v4" strokeLinecap="round" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FormationCard({ formation, t, locale }) {
  const session = formation.sessions?.[0];
  const dateStr = session?.startDate
    ? new Date(session.startDate).toLocaleDateString(locale, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  const isPrivate = formation.type === "PRIVATE";
  const takenSeats = session?.reservations?.reduce((sum, res) => sum + res.seatsCount, 0) ?? 0;
  const capacity = session?.capacity ?? formation.capacity;
  const available = Math.max(0, capacity - takenSeats);
  const priceFormatted = formation.price > 0
    ? new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(formation.price)
    : null;

  return (
    <Link
      href={`/formations/${formation.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-ink/[0.06] shadow-sm shadow-black/5 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-gold/15"
    >
      <div className="relative aspect-5/4 w-full overflow-hidden bg-cream">
        {formation.cover ? (
          <img
            src={formation.cover}
            alt={formation.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-4xl font-bold text-gold/30">{isPrivate ? "P" : "G"}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/5 to-transparent" />

        <span
          className={`absolute right-3 top-3 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wide shadow-sm ${
            isPrivate ? "bg-violet-100 text-violet-900" : "bg-teal-100 text-teal-900"
          }`}
        >
          {isPrivate ? t("privateType") : t("groupType")}
        </span>

        {priceFormatted && (
          <div className="absolute bottom-3 left-3 rounded-lg bg-white/95 px-3 py-1.5 shadow-md backdrop-blur-sm">
            <span className="block text-[9px] font-semibold uppercase leading-none tracking-wide text-ink/45">
              {t("from")}
            </span>
            <span className="block text-base font-bold leading-tight text-gold">{priceFormatted}</span>
          </div>
        )}

        {session && (
          available === 0 ? (
            <span className="absolute bottom-3 right-3 rounded-full bg-red-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
              {t("full")}
            </span>
          ) : !isPrivate && available <= 3 ? (
            <span className="absolute bottom-3 right-3 rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
              {t("placesRemaining", { count: available })}
            </span>
          ) : null
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-5">
        <h3 className="text-[17px] font-bold leading-snug text-ink transition-colors group-hover:text-gold">
          {formation.title}
        </h3>

        {formation.description && (
          <p className="line-clamp-3 text-[13.5px] leading-relaxed text-ink/60">{formation.description}</p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 text-[13px] text-ink/55">
          {dateStr && (
            <span className="flex items-center gap-1.5">
              <CalendarIcon /> {dateStr}
            </span>
          )}
          {formation.duration && (
            <span className="flex items-center gap-1.5">
              <ClockIcon /> {formation.duration} min
            </span>
          )}
        </div>

        {session && (
          <div className="flex items-center justify-between border-t border-ink/8 pt-3 text-[12px] text-ink/50">
            <span className="flex items-center gap-1.5">
              <UsersIcon />
              <span>{isPrivate ? t("onePerson") : t("placesTaken", { taken: takenSeats, capacity })}</span>
            </span>
            {isPrivate ? (
              <span className="font-semibold uppercase tracking-wide text-emerald-600">{t("available")}</span>
            ) : available > 3 ? (
              <span className="font-semibold uppercase tracking-wide text-emerald-600">
                {t("placesAvailable", { count: available })}
              </span>
            ) : null}
          </div>
        )}

        {formation.animator && (
          <div className="flex items-center gap-2 border-t border-cream/80 pt-3">
            {formation.animator.avatar ? (
              <img
                src={formation.animator.avatar}
                alt={formation.animator.name}
                className="h-6 w-6 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gold/10 text-[10px] font-bold text-gold uppercase">
                {formation.animator.name.charAt(0)}
              </div>
            )}
            <span className="text-[11px] text-ink/45">{t("ledBy")}</span>
            <span className="truncate text-[12px] font-medium text-ink/65">{formation.animator.name}</span>
          </div>
        )}

        <span className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold text-gold opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100">
          {t("discover")}
          <ArrowRightIcon />
        </span>
      </div>
    </Link>
  );
}

export default async function FormationsPage() {
  const [t, locale] = await Promise.all([getTranslations("publicFormations"), getLocale()]);
  const result = await getPublicFormations();
  const formations = result.data ?? [];

  const privateFormations = formations.filter((f) => f.type === "PRIVATE");
  const publicFormations = formations.filter((f) => f.type === "PUBLIC");

  return (
    <>
      {/* Hero */}
      <section className="relative w-full bg-primary py-20 lg:py-28">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg,#b89664 0px,#b89664 1px,transparent 1px,transparent 80px)",
          }}
        />
        <div className="mx-auto max-w-[1400px] px-6 md:px-10 lg:px-14 text-center">
          <div className="mb-5 inline-flex items-center gap-3">
            <span className="h-px w-8 bg-gold" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">{t("eyebrow")}</span>
            <span className="h-px w-8 bg-gold" />
          </div>
          <h1 className="text-[2.6rem] font-bold leading-[1.1] tracking-tight text-white sm:text-[3.2rem] lg:text-[3.8rem]">
            {t.rich("title", { accent: (chunks) => <em className="font-light text-gold/80 not-italic">{chunks}</em> })}
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-[17px] leading-relaxed text-white/60">
            {t("description")}
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="w-full bg-cream">
        <div className="mx-auto max-w-[1400px] px-6 py-16 md:px-10 lg:px-14 lg:py-20">
          {formations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 text-5xl">🎓</div>
              <h2 className="text-xl font-bold text-ink">{t("emptyTitle")}</h2>
              <p className="mt-2 text-ink/50">{t("emptyDescription")}</p>
            </div>
          ) : (
            <div className="space-y-16">
              {privateFormations.length > 0 && (
                <section>
                  <div className="mb-6 inline-flex items-center gap-3">
                    <span className="h-px w-6 bg-gold" />
                    <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-gold">
                      {t("privateList", { count: privateFormations.length })}
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {privateFormations.map((formation, i) => (
                      <AnimatedCard key={formation.id} index={i}>
                        <FormationCard formation={formation} t={t} locale={locale} />
                      </AnimatedCard>
                    ))}
                  </div>
                </section>
              )}

              {publicFormations.length > 0 && (
                <section>
                  <div className="mb-6 inline-flex items-center gap-3">
                    <span className="h-px w-6 bg-gold" />
                    <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-gold">
                      {t("groupList", { count: publicFormations.length })}
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {publicFormations.map((formation, i) => (
                      <AnimatedCard key={formation.id} index={i}>
                        <FormationCard formation={formation} t={t} locale={locale} />
                      </AnimatedCard>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
