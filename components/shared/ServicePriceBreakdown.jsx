"use client";

import { roundMoney } from "@/lib/tax-policy";

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

/**
 * HT / TVA / TTC breakdown for a booked service — atelier, événement or
 * formation.
 *
 * Catalogue prices are stored TTC. `unitPriceInclVat` is the actual unit price
 * after the buyer's VAT policy has been applied (stored TTC for a Belgian
 * customer, extracted HT for a 0% reverse-charge customer). The HT line is
 * derived from that charged amount.
 *
 * VAT is then whatever separates that net base from the total actually
 * charged, never a fourth independently rounded number — computed this way
 * the printed lines always reconcile to the cent, which is the entire reason
 * for showing them.
 *
 * Shared by the two reservation pages so an atelier and a formation cannot
 * drift into describing the same tax the same customer pays differently.
 *
 * @param {{
 *   unitPriceInclVat: number, // actual unit price charged at the buyer's rate
 *   seats: number,
 *   vatRate: number,
 *   discountAmount?: number, // promo discount, VAT-inclusive
 *   totalInclVat: number,    // what is actually charged, after discount
 *   unitLabel?: string, // optional suffix such as "formation privée"
 * }} props
 */
export function ServicePriceBreakdown({
  unitPriceInclVat,
  seats,
  vatRate,
  discountAmount = 0,
  totalInclVat,
  unitLabel = null,
}) {
  const unitPrice = Number(unitPriceInclVat) || 0;
  if (unitPrice <= 0) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span className="text-ink/60">Gratuit</span>
        <span className="font-medium text-ink">{eur.format(0)}</span>
      </div>
    );
  }

  const netUnitPrice = unitPrice / (1 + Number(vatRate) / 100);
  const goodsNet = roundMoney(netUnitPrice * seats);
  const discountNet = roundMoney(Number(discountAmount) / (1 + Number(vatRate) / 100));
  const subtotalNet = roundMoney(goodsNet - discountNet);
  const vatAmount = roundMoney(Number(totalInclVat) - subtotalNet);

  return (
    <>
      <div className="flex items-center justify-between text-sm">
        <span className="text-ink/60">
          {unitLabel
            ? `${eur.format(netUnitPrice)} HT — ${unitLabel}`
            : `${eur.format(netUnitPrice)} HT × ${seats} place${seats > 1 ? "s" : ""}`}
        </span>
        <span className="font-medium text-ink">{eur.format(goodsNet)}</span>
      </div>

      {discountNet > 0 && (
        <div className="flex items-center justify-between text-sm text-emerald-600">
          <span>Réduction</span>
          <span>-{eur.format(discountNet)}</span>
        </div>
      )}

      <div className="flex items-center justify-between text-sm">
        <span className="text-ink/60">TVA ({Number(vatRate)}%)</span>
        <span className="text-ink">{eur.format(vatAmount)}</span>
      </div>

      <div className="flex items-center justify-between border-t border-ink/8 pt-2 text-sm font-semibold text-ink">
        <span>Total TTC</span>
        <span>{eur.format(Number(totalInclVat))}</span>
      </div>
    </>
  );
}
