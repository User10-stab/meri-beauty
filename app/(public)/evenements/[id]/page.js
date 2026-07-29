import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicActivityById } from "@/actions/workshops/get-public-activities";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const result = await getPublicActivityById(id);
  const activity = result.data;

  if (!activity) {
    return { title: "Activité introuvable — Meri Beauty" };
  }

  return {
    title: `${activity.title} — Meri Beauty`,
    description: activity.description,
  };
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18M8 2v4M16 2v4" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function EuroIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
      <path d="M19 5c-3-3-8-3-11 0s-3 8 0 11 8 3 11 0" />
      <path d="M6.5 9H15M6.5 13H13" strokeLinecap="round" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  );
}

export default async function EvenementDetailPage({ params }) {
  const { id } = await params;
  const result = await getPublicActivityById(id);
  const activity = result.data;

  if (!activity) {
    notFound();
  }

  const priceFormatted = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(activity.price);

  const isWorkshop = activity.type === "WORKSHOP";

  return (
    <>
      {/* Hero / Cover */}
      <section className="relative w-full overflow-hidden bg-primary" style={{ minHeight: "50vh" }}>
        {activity.cover ? (
          <>
            <img
              src={activity.cover}
              alt={activity.title}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/60 to-primary/30" />
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary to-primary/80" />
        )}

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg,#b89664 0px,#b89664 1px,transparent 1px,transparent 80px)",
          }}
        />

        <div className="relative mx-auto flex h-full max-w-[1400px] flex-col justify-end px-6 pb-12 pt-32 md:px-10 lg:px-14 lg:pb-16 text-center">
          <div className="mb-4 inline-flex items-center gap-3 self-center">
            <span className="h-px w-8 bg-gold" />
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${isWorkshop
                  ? "bg-amber-100 text-amber-900"
                  : "bg-sky-100 text-sky-900"
                }`}
            >
              {isWorkshop ? "Atelier" : "Événement"}
            </span>
            <span className="h-px w-8 bg-gold" />
          </div>

          <h1 className="mx-auto text-[2.4rem] font-bold leading-[1.1] tracking-tight text-white sm:text-[3rem] lg:text-[3.6rem]">
            {activity.title}
          </h1>

          {/* {activity.description && (
            <p className="mx-auto mt-4 max-w-3xl text-[16px] leading-relaxed text-white/70">
              {activity.description}
            </p>
          )} */}
        </div>
      </section>

      {/* Details */}
      <section className="w-full bg-cream">
        <div className="mx-auto max-w-[1400px] px-6 py-12 md:px-10 lg:px-14 lg:py-16">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
            {/* Main content */}
            <div className="lg:col-span-2 space-y-10">
              {/* About */}
              {activity.description && (
                <div>
                  <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-gold">
                    À propos
                  </h2>
                  <p className="text-[15px] leading-[1.9] text-ink/70">
                    {activity.description}
                  </p>
                </div>
              )}

              {/* Sessions */}
              {activity.sessions?.length > 0 && (
                <div>
                  <h2 className="mb-5 text-sm font-semibold uppercase tracking-[0.18em] text-gold">
                    {activity.sessions.length > 1
                      ? `Sessions disponibles (${activity.sessions.length})`
                      : "Date et horaire"}
                  </h2>
                  <div className="space-y-4">
                    {activity.sessions.map((session, index) => (
                      <div
                        key={session.id}
                        className="rounded-xl border border-ink/8 bg-white p-5 shadow-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-2">
                            {activity.sessions.length > 1 && (
                              <span className="text-xs font-semibold uppercase tracking-wide text-gold">
                                Session #{index + 1}
                              </span>
                            )}
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink/65">
                              <span className="flex items-center gap-1.5">
                                <CalendarIcon />
                                {formatDate(session.startDate)}
                              </span>
                              <span className="flex items-center gap-1.5">
                                <ClockIcon />
                                {formatTime(session.startDate)}
                                {session.endDate && ` – ${formatTime(session.endDate)}`}
                              </span>
                            </div>
                            {session.capacity > 0 && (
                              <span className="flex items-center gap-1.5 text-sm text-ink/50">
                                <UsersIcon className="h-4 w-4" />
                                {session.capacity} places disponibles
                              </span>
                            )}
                          </div>

                          <Link
                            href={`/reservation?activity=${activity.id}&session=${session.id}`}
                            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition-all duration-200 hover:bg-gold/90 hover:shadow-md"
                          >
                            Réserver
                          </Link>
                        </div>

                        {session.registrationDeadline && (
                          <p className="mt-3 text-xs text-ink/40">
                            Inscription avant le {formatDate(session.registrationDeadline)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(!activity.sessions || activity.sessions.length === 0) && (
                <div className="rounded-xl border border-ink/8 bg-white p-6 text-center">
                  <p className="text-ink/50">Aucune session programmée pour le moment.</p>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              <div className="rounded-xl border border-ink/8 bg-white p-6 shadow-sm">
                <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.15em] text-gold">
                  Informations
                </h3>
                <ul className="space-y-4">
                  <li className="flex items-center gap-3">
                    <EuroIcon />
                    <div>
                      <p className="text-sm font-semibold text-ink">{priceFormatted}</p>
                      <p className="text-xs text-ink/45">Tarif</p>
                    </div>
                  </li>
                  <li className="flex items-center gap-3">
                    <ClockIcon />
                    <div>
                      <p className="text-sm font-semibold text-ink">{activity.duration} min</p>
                      <p className="text-xs text-ink/45">Durée</p>
                    </div>
                  </li>
                  <li className="flex items-center gap-3">
                    <UsersIcon />
                    <div>
                      <p className="text-sm font-semibold text-ink">{activity.capacity} personnes</p>
                      <p className="text-xs text-ink/45">Capacité</p>
                    </div>
                  </li>
                  {activity.language && (
                    <li className="flex items-center gap-3">
                      <GlobeIcon />
                      <div>
                        <p className="text-sm font-semibold text-ink">{activity.language}</p>
                        <p className="text-xs text-ink/45">Langue</p>
                      </div>
                    </li>
                  )}
                </ul>
              </div>

              {/* Animator */}
              {activity.animator && (
                <div className="rounded-xl border border-ink/8 bg-white p-6 shadow-sm">
                  <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.15em] text-gold">
                    Animé par
                  </h3>
                  <Link
                    href={`/animateurs/${activity.animator.id}`}
                    className="group flex items-center gap-4"
                  >
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-cream">
                      {activity.animator.avatar ? (
                        <img
                          src={activity.animator.avatar}
                          alt={activity.animator.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-lg font-bold text-gold">
                          {activity.animator.name.charAt(0)}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-ink group-hover:text-gold transition-colors">
                        {activity.animator.name}
                      </p>
                      {activity.animator.bio && (
                        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink/50">
                          {activity.animator.bio}
                        </p>
                      )}
                    </div>
                  </Link>
                </div>
              )}

              {/* Back link */}
              <Link
                href="/evenements"
                className="inline-flex items-center gap-2 text-sm font-medium text-ink/50 transition-colors hover:text-gold"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4" aria-hidden="true">
                  <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Retour aux activités
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
