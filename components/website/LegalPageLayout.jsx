/** Shared header + reading-width wrapper for the legal pages (mentions
 * légales, politique de confidentialité, CGV) — kept visually consistent
 * with the rest of the marketing site (same eyebrow/gold-rule pattern as
 * ContactPage) but without the big image hero, since these are dense text
 * pages meant to be read, not sold. */
export default function LegalPageLayout({ eyebrow, title, updated, children }) {
  return (
    <>
      <section className="bg-primary">
        <div className="mx-auto max-w-[1400px] px-6 py-14 lg:px-14 lg:py-16 xl:px-20">
          <div className="mb-4 flex items-center gap-3">
            <span className="h-px w-12 bg-gold" />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-gold">
              {eyebrow}
            </span>
          </div>
          <h1 className="font-display text-[2rem] font-bold leading-tight text-cream sm:text-[2.4rem] lg:text-[2.8rem]">
            {title}
          </h1>
          {updated && (
            <p className="mt-4 text-sm text-cream/60">Dernière mise à jour : {updated}</p>
          )}
        </div>
      </section>

      <section className="bg-cream">
        <div className="mx-auto max-w-3xl px-6 py-14 lg:py-20">
          <article>{children}</article>
        </div>
      </section>
    </>
  );
}

export function H2({ children }) {
  return (
    <h2 className="mb-3 mt-10 font-display text-xl font-bold text-ink first:mt-0 sm:text-2xl">
      {children}
    </h2>
  );
}

export function H3({ children }) {
  return <h3 className="mb-2 mt-6 text-base font-semibold text-ink">{children}</h3>;
}

export function P({ children }) {
  return <p className="mb-4 leading-relaxed text-ink/80">{children}</p>;
}

export function Ul({ children }) {
  return <ul className="mb-4 list-disc space-y-2 pl-6 text-ink/80">{children}</ul>;
}

export function Note({ children }) {
  return (
    <div className="mb-4 rounded-xl border border-gold-soft bg-gold-soft/10 p-4 text-sm text-ink/80">
      {children}
    </div>
  );
}
