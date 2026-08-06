// Shown by Next.js while a public page's server component is fetching data
// (e.g. from the DB) during navigation — replaces the previous blank-screen
// gap with a lightweight, brand-toned skeleton instead of a dead white page.
export default function PublicLoading() {
  return (
    <div className="flex min-h-[70vh] w-full flex-col items-center justify-center gap-4 bg-cream px-6 py-24">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-gold/25 border-t-gold" />
      <div className="h-3 w-32 animate-pulse rounded-full bg-ink/10" />
    </div>
  );
}
