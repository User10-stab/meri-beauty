import Link from "next/link";
import Image from "next/image";
import { getPublicActivities } from "@/actions/workshops/get-public-activities";
import { AnimatedCard } from "@/components/website/AnimatedCard";
import { AnimatedBlock } from "@/components/website/AnimatedBlock";

export const metadata = {
  title: "Évènements & Ateliers — Meri Beauty",
  description: "Découvrez nos ateliers et événements beauté animés par des professionnels.",
};

async function ActivityCard({ activity }) {
  const session = activity.sessions?.[0];
  const dateStr = session?.startDate
    ? new Date(session.startDate).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Brussels",
    })
    : null;

  const isWorkshop = activity.type === "WORKSHOP";
  const takenSeats = session?.reservations?.reduce((sum, res) => sum + res.seatsCount, 0) ?? 0;
  const capacity = session?.capacity ?? activity.capacity;
  const available = Math.max(0, capacity - takenSeats);
  const priceFormatted = activity.price > 0
    ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(activity.price)
    : null;

  return (
    <Link
      href={`/evenements/${activity.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-ink/[0.06] shadow-sm shadow-black/5 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-gold/15"
    >
      <div className="relative aspect-5/4 w-full overflow-hidden bg-cream">
        {activity.cover ? (
          <img
            src={activity.cover}
            alt={activity.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-4xl font-bold text-gold/30">
              {isWorkshop ? "W" : "É"}
            </span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/5 to-transparent" />

        <span
          className={`absolute right-3 top-3 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wide shadow-sm ${isWorkshop
            ? "bg-amber-100 text-amber-900"
            : "bg-sky-100 text-sky-900"
            }`}
        >
          {isWorkshop ? "Atelier" : "Événement"}
        </span>

        {priceFormatted && (
          <div className="absolute bottom-3 left-3 rounded-lg bg-white/95 px-3 py-1.5 shadow-md backdrop-blur-sm">
            <span className="block text-[9px] font-semibold uppercase leading-none tracking-wide text-ink/45">
              à partir de
            </span>
            <span className="block text-base font-bold leading-tight text-gold">{priceFormatted}</span>
          </div>
        )}

        {session && (
          available === 0 ? (
            <span className="absolute bottom-3 right-3 rounded-full bg-red-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
              Complet
            </span>
          ) : available <= 3 ? (
            <span className="absolute bottom-3 right-3 rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
              {available} place{available > 1 ? "s" : ""} !
            </span>
          ) : null
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-5">
        <h3 className="text-[17px] font-bold leading-snug text-ink transition-colors group-hover:text-gold">
          {activity.title}
        </h3>

        {activity.description && (
          <p className="line-clamp-3 text-[13.5px] leading-relaxed text-ink/60">
            {activity.description}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 text-[13px] text-ink/55">
          {dateStr && (
            <span className="flex items-center gap-1.5">
              <CalendarIcon /> {dateStr}
            </span>
          )}
          {activity.duration && (
            <span className="flex items-center gap-1.5">
              <ClockIcon /> {activity.duration} min
            </span>
          )}
        </div>

        {session && (
          <div className="flex items-center justify-between border-t border-ink/8 pt-3 text-[12px] text-ink/50">
            <span className="flex items-center gap-1.5">
              <UsersIcon />
              <span>{takenSeats} / {capacity} places</span>
            </span>
            {available > 3 && (
              <span className="font-semibold uppercase tracking-wide text-emerald-600">
                {available} libre{available > 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}

        {activity.animator && (
          <div className="flex items-center gap-2 border-t border-cream/80 pt-3">
            {activity.animator.avatar ? (
              <img
                src={activity.animator.avatar}
                alt={activity.animator.name}
                className="h-6 w-6 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gold/10 text-[10px] font-bold text-gold uppercase">
                {activity.animator.name.charAt(0)}
              </div>
            )}
            <span className="text-[11px] text-ink/45">Animé par</span>
            <span className="truncate text-[12px] font-medium text-ink/65">{activity.animator.name}</span>
          </div>
        )}

        <span className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold text-gold opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100">
          Découvrir
          <ArrowRightIcon />
        </span>
      </div>
    </Link>
  );
}

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

export default async function EvenementsPage({ searchParams }) {
  const params = await searchParams;
  const filterType = params?.type;

  const result = await getPublicActivities();
  const activities = result.data ?? [];

  const workshops = activities.filter((a) => a.type === "WORKSHOP");
  const events = activities.filter((a) => a.type === "EVENT");

  const showAllWorkshops = filterType === "workshop";
  const showAllEvents = filterType === "event";

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
              Évènements & Ateliers
            </span>
            <span className="h-px w-8 bg-gold" />
          </div>
          <h1 className="text-[2.6rem] font-bold leading-[1.1] tracking-tight text-white sm:text-[3.2rem] lg:text-[3.8rem]">
            {showAllWorkshops ? "Nos ateliers" : showAllEvents ? "Nos événements" : "Vivez des expériences beauté"}{" "}
            <em className="font-light text-gold/80 not-italic">{showAllWorkshops || showAllEvents ? "" : "uniques."}</em>
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-[17px] leading-relaxed text-white/60">
            Tout au long de l&apos;année, MeriBeauty Studio &amp; Shop s&apos;anime au rythme d&apos;ateliers, de cercles de femmes,
            d&apos;événements et de moments de partage. Chaque événement est imaginé pour créer une parenthèse hors du
            quotidien, dans une atmosphère chaleureuse et inspirante. Que vous veniez apprendre, créer ou simplement
            vous accorder un moment pour vous, vous trouverez toujours une nouvelle expérience à vivre.<br></br>
            Ateliers pratiques, masterclasses et événements exclusifs animés par des professionnels
            passionnés. Réservez votre place dès maintenant.
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="w-full bg-cream">
        <div className="mx-auto max-w-[1400px] px-6 py-16 md:px-10 lg:px-14 lg:py-20">
          {activities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 text-5xl">✨</div>
              <h2 className="text-xl font-bold text-ink">Aucune activité pour le moment</h2>
              <p className="mt-2 text-ink/50">
                Nos ateliers et événements arrivent bientôt. Revenez nous voir !
              </p>
            </div>
          ) : showAllWorkshops ? (
            <div>
              <Link
                href="/evenements"
                className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-ink/50 transition-colors hover:text-gold"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4" aria-hidden="true">
                  <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Retour à la vue d&apos;ensemble
              </Link>
              <div className="mb-6 inline-flex items-center gap-3">
                <span className="h-px w-6 bg-gold" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-gold">
                  Tous les ateliers ({workshops.length})
                </h2>
              </div>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {workshops.map((activity, i) => (
                  <AnimatedCard key={activity.id} index={i}>
                    <ActivityCard activity={activity} />
                  </AnimatedCard>
                ))}
              </div>
            </div>
          ) : showAllEvents ? (
            <div>
              <Link
                href="/evenements"
                className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-ink/50 transition-colors hover:text-gold"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4" aria-hidden="true">
                  <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Retour à la vue d&apos;ensemble
              </Link>
              <div className="mb-6 inline-flex items-center gap-3">
                <span className="h-px w-6 bg-gold" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-gold">
                  Tous les événements ({events.length})
                </h2>
              </div>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {events.map((activity, i) => (
                  <AnimatedCard key={activity.id} index={i}>
                    <ActivityCard activity={activity} />
                  </AnimatedCard>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Workshops */}
              {workshops.length > 0 && (
                <section>
                  <div className="mb-6 inline-flex items-center gap-3">
                    <span className="h-px w-6 bg-gold" />
                    <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-gold">
                      Ateliers ({workshops.length})
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {workshops.slice(0, 4).map((activity, i) => (
                      <AnimatedCard key={activity.id} index={i}>
                        <ActivityCard activity={activity} />
                      </AnimatedCard>
                    ))}
                  </div>
                  {workshops.length > 4 && (
                    <div className="mt-6 text-center">
                      <Link
                        href="/evenements?type=workshop"
                        className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-6 py-2.5 text-[13px] font-semibold text-gold transition-all duration-200 hover:bg-gold hover:text-white hover:shadow-md"
                      >
                        Voir tous les ateliers ({workshops.length})
                      </Link>
                    </div>
                  )}
                </section>
              )}

              {/* Events */}
              {events.length > 0 && (
                <section>
                  <div className="mb-6 inline-flex items-center gap-3">
                    <span className="h-px w-6 bg-gold" />
                    <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-gold">
                      Événements ({events.length})
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {events.slice(0, 4).map((activity, i) => (
                      <AnimatedCard key={activity.id} index={i}>
                        <ActivityCard activity={activity} />
                      </AnimatedCard>
                    ))}
                  </div>
                  {events.length > 4 && (
                    <div className="mt-6 text-center">
                      <Link
                        href="/evenements?type=event"
                        className="inline-flex items-center gap-2 rounded-full border border-gold/30 px-6 py-2.5 text-[13px] font-semibold text-gold transition-all duration-200 hover:bg-gold hover:text-white hover:shadow-md"
                      >
                        Voir tous les événements ({events.length})
                      </Link>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Blocs promotionnels */}
      <section className="w-full bg-white">
        <div className="mx-auto max-w-[1400px] px-6 py-16 md:px-10 lg:px-14 lg:py-24 space-y-20">

          {/* Bloc 1 : La Roue de l'Année — image à droite */}
          <AnimatedBlock
            reverse={false}
            text={
              <div>
                <span className="mb-4 inline-flex items-center gap-3">
                  <span className="h-px w-6 bg-gold" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">Nos Rencontres</span>
                </span>
                <h2 className="text-[2rem] font-bold leading-[1.1] tracking-tight text-ink sm:text-[2.4rem]">
                  La Roue de l&apos;Année
                </h2>
                <div className="mt-5 space-y-4 text-[15px] leading-[1.9] text-ink/65">
                  <p>Pendant longtemps, les saisons rythmaient naturellement la vie. On célébrait le retour du printemps, les premières récoltes, les longues soirées d&apos;été ou le moment où la nature s&apos;endormait.</p>
                  <p>Aujourd&apos;hui, nous avons gardé les anniversaires, Noël ou le Nouvel An, mais nous prenons rarement le temps de célébrer les choses simples que la nature nous offre tout au long de l&apos;année.</p>
                  <p>À travers ces rencontres, j&apos;ai envie de retrouver ce lien avec les saisons et de créer des moments où l&apos;on ralentit, où l&apos;on se retrouve et où l&apos;on prend le temps d&apos;apprécier le moment présent. Chaque cercle s&apos;inspire d&apos;une fête de la Roue de l&apos;Année, mais il est avant tout une invitation à partager, créer, échanger et vivre pleinement chaque saison.</p>
                  <p>Ces rencontres sont ouvertes à toutes, sans prérequis ni croyance particulière. Elles sont proposées dans un esprit de convivialité et de découverte et n&apos;ont pas de vocation thérapeutique.</p>
                </div>
              </div>
            }
            image={
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl">
                <img src="/Images/bloc1.png" alt="La Roue de l'Année" className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-tr from-black/5 via-transparent to-transparent" />
              </div>
            }
          />

          {/* Bloc 2 : Les Cocoon Nights — image à gauche */}
          <AnimatedBlock
            reverse={true}
            text={
              <div>
                <span className="mb-4 inline-flex items-center gap-3">
                  <span className="h-px w-6 bg-gold" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">Nos Soirées</span>
                </span>
                <h2 className="text-[2rem] font-bold leading-[1.1] tracking-tight text-ink sm:text-[2.4rem]">
                  Les Cocoon Nights
                </h2>
                <div className="mt-5 space-y-4 text-[15px] leading-[1.9] text-ink/65">
                  <p>Et si on retrouvait le plaisir des soirées pyjama de notre enfance ?</p>
                  <p>Les Cocoon Nights sont nées de cette envie. Un soir par mois (ou selon la programmation), le salon se transforme en un véritable cocon. Enfilez votre tenue la plus confortable et rejoignez-nous pour une soirée faite de gourmandises, de boissons chaudes, de jeux de société, d&apos;activités créatives et de belles discussions.</p>
                  <p>Que vous veniez avec une amie ou seule, l&apos;idée est simple : vous sentir comme chez vous.</p>
                </div>
              </div>
            }
            image={
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl">
                <img src="/Images/bloc2.png" alt="Les Cocoon Nights" className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-tl from-black/5 via-transparent to-transparent" />
              </div>
            }
          />

          {/* Bloc 3 : Ateliers du Cottage — image à droite */}
          <AnimatedBlock
            reverse={false}
            text={
              <div>
                <span className="mb-4 inline-flex items-center gap-3">
                  <span className="h-px w-6 bg-gold" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">Nos Ateliers</span>
                </span>
                <h2 className="text-[2rem] font-bold leading-[1.1] tracking-tight text-ink sm:text-[2.4rem]">
                  Ateliers du Cottage
                </h2>
                <div className="mt-5 space-y-4 text-[15px] leading-[1.9] text-ink/65">
                  <p>Envie d&apos;apprendre quelque chose de nouveau ?</p>
                  <p>Tout au long de l&apos;année, nous invitons des professionnels passionnés à partager leur savoir-faire lors d&apos;ateliers accessibles à tous. Beauté, artisanat, bien-être, développement de compétences ou découvertes créatives : chaque atelier est animé par un intervenant spécialisé dans son domaine.</p>
                  <p>Notre envie est simple : créer un lieu où l&apos;on découvre, où l&apos;on apprend et où l&apos;on repart avec de nouvelles connaissances ... et souvent de belles rencontres.</p>
                </div>
              </div>
            }
            image={
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl">
                <img src="/Images/bloc3.png" alt="Ateliers du Cottage" className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-tr from-black/5 via-transparent to-transparent" />
              </div>
            }
          />

        </div>
      </section>
    </>
  );
}
