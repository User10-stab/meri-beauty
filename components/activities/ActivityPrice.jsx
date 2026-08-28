"use client";

import { useEffect, useState } from "react";
import { repriceTtcCataloguePrice } from "@/lib/tax-policy";
import { getViewerServiceVatPolicy } from "@/actions/vat/viewer-policy";

const DEFAULT_POLICY = { vatRate: 21, isB2B: false, taxNote: null };

// Shared across every mounted price on the page: a listing with a dozen
// activity cards fires one session lookup on load, not one per card.
let cachedPolicyPromise = null;

function fetchViewerVatPolicy() {
  if (!cachedPolicyPromise) {
    cachedPolicyPromise = getViewerServiceVatPolicy()
      .then((result) => (result.success ? result.data : DEFAULT_POLICY))
      .catch(() => DEFAULT_POLICY);
  }
  return cachedPolicyPromise;
}

/**
 * Resolves once per page load, starting at the VAT-inclusive default so the
 * first paint is always correct for an anonymous visitor.
 */
export function useViewerServiceVatPolicy() {
  const [policy, setPolicy] = useState(DEFAULT_POLICY);

  useEffect(() => {
    let cancelled = false;
    fetchViewerVatPolicy().then((data) => {
      if (!cancelled) setPolicy(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return policy;
}

function formatEur(value, locale = "fr-FR") {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(value);
}

/**
 * priceTtc is the raw Activity/Formation.price (TTC, as stored). Renders the
 * stored price for a consumer, or its HT base for a validated
 * foreign-EU B2B viewer — same rule as the boutique's ProductPrice, applied
 * here via resolveServiceVatPolicy instead of resolveGoodsVatPolicy.
 */
export function ActivityPriceTag({ priceTtc, locale = "fr-FR", className = "" }) {
  const { vatRate, isB2B } = useViewerServiceVatPolicy();
  const price = repriceTtcCataloguePrice(Number(priceTtc), vatRate);

  return (
    <span className={className}>
      {formatEur(price, locale)}
      {isB2B ? " HT" : ""}
    </span>
  );
}

/**
 * The "you only pay the deposit today" line under a session/date row.
 * Mirrors the `depositPct > 0 && shelfPrice > 0` guard every page already
 * had, just resolved against the viewer's own price instead of a fixed 21%.
 */
export function ActivityDepositNote({ priceTtc, depositPct }) {
  const { vatRate, isB2B } = useViewerServiceVatPolicy();

  if (!(depositPct > 0) || !(Number(priceTtc) > 0)) return null;

  const price = repriceTtcCataloguePrice(Number(priceTtc), vatRate);
  const depositAmount = (price * depositPct) / 100;
  const balanceAmount = price - depositAmount;
  const suffix = isB2B ? " HT" : "";

  return (
    <p className="text-right text-xs leading-snug text-ink/50">
      Vous ne réglez aujourd&apos;hui que{" "}
      <strong className="text-gold">
        {formatEur(depositAmount)}
        {suffix}
      </strong>
      .
      <br />
      Le solde de{" "}
      <strong className="text-ink/70">
        {formatEur(balanceAmount)}
        {suffix}
      </strong>{" "}
      sera à payer sur place.
    </p>
  );
}
