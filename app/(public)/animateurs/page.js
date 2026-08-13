import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getPublicAnimators } from "@/actions/workshops/get-public-animators";

export async function generateMetadata() {
  const t = await getTranslations("animateurs");
  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default async function AnimateursPage() {
  const t = await getTranslations("animateurs");
  const result = await getPublicAnimators();
  const animators = result.data ?? [];

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
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">
              {t("heroEyebrow")}
            </span>
            <span className="h-px w-8 bg-gold" />
          </div>
          <h1 className="text-[2.6rem] font-bold leading-[1.1] tracking-tight text-white sm:text-[3.2rem] lg:text-[3.8rem]">
            {t("heroTitle")}{" "}
            <em className="font-light text-gold/80 not-italic">{t("heroTitleEm")}</em>
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-[17px] leading-relaxed text-white/60">
            {t("heroSubtitle")}
          </p>
        </div>
      </section>

      {/* Grid */}
      <section className="w-full bg-cream">
        <div className="mx-auto max-w-[1400px] px-6 py-16 md:px-10 lg:px-14 lg:py-20">
          {animators.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 text-5xl">🎭</div>
              <h2 className="text-xl font-bold text-ink">{t("emptyTitle")}</h2>
              <p className="mt-2 text-ink/50">
                {t("emptyDesc")}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {animators.map((animator) => (
                <Link
                  key={animator.id}
                  href={`/animateurs/${animator.id}`}
                  className="group flex flex-col items-center rounded-2xl bg-white p-6 text-center shadow-sm shadow-black/5 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-gold/10"
                >
                  <div className="mb-4 h-20 w-20 overflow-hidden rounded-full bg-cream ring-2 ring-gold/10 transition-all duration-300 group-hover:ring-gold/30">
                    {animator.avatar ? (
                      <img
                        src={animator.avatar}
                        alt={animator.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-gold">
                        {animator.name.charAt(0)}
                      </div>
                    )}
                  </div>

                  <h3 className="text-base font-bold text-ink">{animator.name}</h3>

                  {animator.bio && (
                    <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-ink/50">
                      {animator.bio}
                    </p>
                  )}

                  {animator._count?.activities > 0 && (
                    <span className="mt-3 inline-flex items-center gap-1 text-xs text-gold">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="18" rx="2" />
                        <path d="M3 10h18M8 2v4M16 2v4" strokeLinecap="round" />
                      </svg>
                      {animator._count.activities} {t("activitiesCount", { count: animator._count.activities })}
                    </span>
                  )}

                  {/* Social links */}
                  {(animator.website || animator.instagram) && (
                    <div className="mt-4 flex items-center gap-3 border-t border-cream/80 pt-4">
                      {animator.website && (
                        <span className="text-xs text-ink/40 hover:text-gold transition-colors">
                          {t("website")}
                        </span>
                      )}
                      {animator.instagram && (
                        <span className="text-xs text-ink/40 hover:text-gold transition-colors">
                          {t("instagram")}
                        </span>
                      )}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
