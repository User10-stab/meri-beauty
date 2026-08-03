import Link from "next/link";
import { getPublicFormations } from "@/actions/formations/get-public-formations";
import { AnimatedCard } from "@/components/website/AnimatedCard";

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

function FormationCard({ formation }) {
  const session = formation.sessions?.[0];
  const dateStr = session?.startDate
    ? new Date(session.startDate).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  const isPrivate = formation.type === "PRIVATE";
  const takenSeats = session?.reservations?.reduce((sum, res) => sum + res.seatsCount, 0) ?? 0;
  const capacity = session?.capacity ?? formation.capacity;
  const available = Math.max(0, capacity - takenSeats);

  return (
    <Link
      href={`/formations/${formation.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl bg-white shadow-sm shadow-black/5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-gold/10"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-cream">
        {formation.cover ? (
          <img
            src={formation.cover}
            alt={formation.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-3xl font-bold text-gold/30">{isPrivate ? "P" : "G"}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
        <span
          className={`absolute right-2 top-2 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide shadow-sm ${
            isPrivate ? "bg-violet-100 text-violet-900" : "bg-teal-100 text-teal-900"
          }`}
        >
          {isPrivate ? "Formation privée" : "Formation groupe"}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="text-sm font-bold leading-snug text-ink">{formation.title}</h3>

        {formation.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-ink/55">{formation.description}</p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-ink/50">
          {dateStr && (
            <span className="flex items-center gap-1">
              <CalendarIcon /> {dateStr}
            </span>
          )}
          {formation.price > 0 && (
            <span className="font-semibold text-gold">
              {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(formation.price)}
            </span>
          )}
          {formation.duration && <span>{formation.duration} min</span>}
        </div>

        {session && (
          <div className="mt-2 flex items-center justify-between text-[11px] border-t border-ink/5 pt-2 text-ink/50">
            <span className="flex items-center gap-1">
              <UsersIcon />
              <span>{isPrivate ? "1 personne" : `${takenSeats} / ${capacity} places`}</span>
            </span>
            {available === 0 ? (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-800">Complet</span>
            ) : isPrivate ? (
              <span className="font-medium text-emerald-600 text-[9px] uppercase tracking-wide">Disponible</span>
            ) : (
              <span className="font-medium text-emerald-600 text-[9px] uppercase tracking-wide">{available} libre{available > 1 ? "s" : ""}</span>
            )}
          </div>
        )}

        {formation.animator && (
          <div className="flex items-center gap-1.5 border-t border-cream/80 pt-2 mt-0.5">
            {formation.animator.avatar ? (
              <img
                src={formation.animator.avatar}
                alt={formation.animator.name}
                className="h-5 w-5 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gold/10 text-[9px] font-bold text-gold uppercase">
                {formation.animator.name.charAt(0)}
              </div>
            )}
            <span className="text-[10px] text-ink/50">Animée par</span>
            <span className="text-xs text-ink/60 font-medium truncate">{formation.animator.name}</span>
          </div>
        )}
      </div>
    </Link>
  );
}

export default async function FormationsPage() {
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
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">Formations</span>
            <span className="h-px w-8 bg-gold" />
          </div>
          <h1 className="text-[2.6rem] font-bold leading-[1.1] tracking-tight text-white sm:text-[3.2rem] lg:text-[3.8rem]">
            Développez votre expertise <em className="font-light text-gold/80 not-italic">avec nous.</em>
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-[17px] leading-relaxed text-white/60">
            Des formations professionnelles en petit comité ou en tête-à-tête, animées par nos expertes.
            Un acompte réserve votre place, le solde se règle directement au comptoir le jour de la formation.
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="w-full bg-cream">
        <div className="mx-auto max-w-[1400px] px-6 py-16 md:px-10 lg:px-14 lg:py-20">
          {formations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 text-5xl">🎓</div>
              <h2 className="text-xl font-bold text-ink">Aucune formation pour le moment</h2>
              <p className="mt-2 text-ink/50">Nos prochaines formations arrivent bientôt. Revenez nous voir !</p>
            </div>
          ) : (
            <div className="space-y-16">
              {privateFormations.length > 0 && (
                <section>
                  <div className="mb-6 inline-flex items-center gap-3">
                    <span className="h-px w-6 bg-gold" />
                    <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-gold">
                      Formations privées ({privateFormations.length})
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {privateFormations.map((formation, i) => (
                      <AnimatedCard key={formation.id} index={i}>
                        <FormationCard formation={formation} />
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
                      Formations groupe ({publicFormations.length})
                    </h2>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {publicFormations.map((formation, i) => (
                      <AnimatedCard key={formation.id} index={i}>
                        <FormationCard formation={formation} />
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
