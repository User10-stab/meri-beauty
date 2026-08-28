import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicAnimatorById } from "@/actions/workshops/get-public-animators";
import { ActivityPriceTag } from "@/components/activities/ActivityPrice";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const result = await getPublicAnimatorById(id);
  const animator = result.data;

  if (!animator) {
    return { title: "Animateur introuvable — Meri Beauty" };
  }

  return {
    title: `${animator.name} — Meri Beauty`,
    description: animator.bio,
  };
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

export default async function AnimatorDetailPage({ params }) {
  const { id } = await params;
  const result = await getPublicAnimatorById(id);
  const animator = result.data;

  if (!animator) {
    notFound();
  }

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
        <div className="mx-auto max-w-[1400px] px-6 md:px-10 lg:px-14">
          <div className="flex flex-col items-center text-center sm:flex-row sm:text-left sm:items-start sm:gap-8">
            <div className="mb-6 h-28 w-28 shrink-0 overflow-hidden rounded-full bg-cream ring-4 ring-gold/20 sm:mb-0">
              {animator.avatar ? (
                <img
                  src={animator.avatar}
                  alt={animator.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-4xl font-bold text-gold">
                  {animator.name.charAt(0)}
                </div>
              )}
            </div>

            <div>
              <div className="mb-4 inline-flex items-center gap-3">
                <span className="h-px w-8 bg-gold" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">
                  Animateur
                </span>
              </div>
              <h1 className="text-[2.4rem] font-bold leading-[1.1] tracking-tight text-white sm:text-[3rem] lg:text-[3.6rem]">
                {animator.name}
              </h1>
              {animator.bio && (
                <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-white/60">
                  {animator.bio}
                </p>
              )}

              {/* Contact / Social */}
              <div className="mt-6 flex flex-wrap items-center gap-4">
                {animator.email && (
                  <a
                    href={`mailto:${animator.email}`}
                    className="flex items-center gap-2 text-sm text-white/50 transition-colors hover:text-gold"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="m2 7 10 7 10-7" />
                    </svg>
                    {animator.email}
                  </a>
                )}
                {animator.website && (
                  <a
                    href={animator.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-white/50 transition-colors hover:text-gold"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                    </svg>
                    Site web
                  </a>
                )}
                {animator.instagram && (
                  <a
                    href={animator.instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-white/50 transition-colors hover:text-gold"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
                    </svg>
                    Instagram
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Activities */}
      <section className="w-full bg-cream">
        <div className="mx-auto max-w-[1400px] px-6 py-16 md:px-10 lg:px-14 lg:py-20">
          {animator.activities?.length > 0 ? (
            <div>
              <div className="mb-8 inline-flex items-center gap-3">
                <span className="h-px w-6 bg-gold" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-gold">
                  Ses activités ({animator.activities.length})
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {animator.activities.map((activity) => {
                  const session = activity.sessions?.[0];
                  return (
                    <Link
                      key={activity.id}
                      href={`/evenements/${activity.id}`}
                      className="group flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm shadow-black/5 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-gold/10"
                    >
                      <div className="relative aspect-[16/10] w-full overflow-hidden bg-cream">
                        {activity.cover ? (
                          <img
                            src={activity.cover}
                            alt={activity.title}
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <span className="text-4xl font-bold text-gold/30">
                              {activity.type === "WORKSHOP" ? "W" : "É"}
                            </span>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
                        <span
                          className={`absolute right-3 top-3 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide shadow-sm ${
                            activity.type === "WORKSHOP"
                              ? "bg-amber-100 text-amber-900"
                              : "bg-sky-100 text-sky-900"
                          }`}
                        >
                          {activity.type === "WORKSHOP" ? "Atelier" : "Événement"}
                        </span>
                      </div>

                      <div className="flex flex-col gap-2 p-5">
                        <h3 className="text-base font-bold leading-snug text-ink">
                          {activity.title}
                        </h3>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink/50">
                          {session?.startDate && (
                            <span>
                              {formatDate(session.startDate)}
                            </span>
                          )}
                          {Number(activity.price) > 0 && (
                            <ActivityPriceTag priceTtc={activity.price} className="font-semibold text-gold" />
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <h2 className="text-xl font-bold text-ink">Aucune activité publiée</h2>
              <p className="mt-2 text-ink/50">
                Cet animateur n&apos;a pas encore d&apos;activité programmée.
              </p>
            </div>
          )}

          {/* Back link */}
          <div className="mt-12">
            <Link
              href="/animateurs"
              className="inline-flex items-center gap-2 text-sm font-medium text-ink/50 transition-colors hover:text-gold"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4" aria-hidden="true">
                <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Tous les animateurs
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
