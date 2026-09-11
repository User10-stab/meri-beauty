/**
 * Print-only header for the Livre de caisse: company name + logo, the
 * selected date range, and a generated-on timestamp — invisible on screen
 * (hidden via Tailwind's print: utilities elsewhere on the page pattern;
 * this component itself only ever renders inside a `print:block hidden`
 * wrapper), so it only appears on the printed page.
 *
 * Page-number pagination is CSS-only (@page margin box), not this
 * component's job — see the <style> block in CaisseClient.jsx.
 */
export function CaissePrintHeader({ salonName, logoUrl, from, to }) {
  const generatedAt = new Date().toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Brussels" });

  return (
    <div className="mb-4 flex items-center justify-between border-b border-black pb-3">
      <div className="flex items-center gap-3">
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- print output, not the app's runtime image pipeline
          <img src={logoUrl} alt="" className="h-12 w-auto object-contain" />
        )}
        <div>
          <p className="text-base font-bold text-black">{salonName}</p>
          <p className="text-xs text-black">Livre de caisse</p>
        </div>
      </div>
      <div className="text-right text-xs text-black">
        <p>
          Période : {from} — {to}
        </p>
        <p>Généré le {generatedAt}</p>
      </div>
    </div>
  );
}
