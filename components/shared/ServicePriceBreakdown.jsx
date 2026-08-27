"use client";

import { roundMoney } from "@/lib/tax-policy";

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

/**
 * HT / TVA / TTC breakdown for a booked service — atelier, événement or
 * formation.
 *
 * These prices are stored net exactly like the boutique catalogue (see
 * prisma/migrations/20260824180000_catalogue_prices_net_of_vat), so the net
 * figure is READ from the catalogue rather than back-calculated from the
 * gross. Only the promo discount has to be netted down, because a promo code
 * applies to the VAT-inclusive price the customer was quoted.
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
 *   netUnitPrice: number,   // catalogue price, hors TVA
 *   seats: number,
 *   vatRate: number,
 *   discountAmount?: number, // promo discount, VAT-inclusive
 *   totalInclVat: number,    // what is actually charged, after discount
 *   unitLabel?: string,
 * }} props
 */
export function ServicePriceBreakdown({
  netUnitPrice,
  seats,
  vatRate,
  discountAmount = 0,
  totalInclVat,
  unitLabel = null,
}) {
  const net = Number(netUnitPrice) || 0;
  if (net <= 0) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span className="text-ink/60">Gratuit</span>
        <span className="font-medium text-ink">{eur.format(0)}</span>
      </div>
    );
  }

  const goodsNet = roundMoney(net * seats);
  const discountNet = roundMoney(Number(discountAmount) / (1 + Number(vatRate) / 100));
  const subtotalNet = roundMoney(goodsNet - discountNet);
  const vatAmount = roundMoney(Number(totalInclVat) - subtotalNet);

  return (
    <>
      <div className="flex items-center justify-between text-sm">
        <span className="text-ink/60">
          {unitLabel ?? `${eur.format(net)} HT × ${seats} place${seats > 1 ? "s" : ""}`}
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
