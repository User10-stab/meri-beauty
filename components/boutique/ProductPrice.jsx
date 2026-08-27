"use client";

import { useEffect, useState } from "react";
import { getViewerGoodsVatPolicy } from "@/actions/vat/viewer-policy";

const DEFAULT_POLICY = { vatRate: 21, isB2B: false, taxNote: null };

// Shared across every mounted price on the page: without this, a listing
// with 24 product cards would fire 24 identical session lookups on load.
let cachedPolicyPromise = null;

function fetchViewerVatPolicy() {
  if (!cachedPolicyPromise) {
    cachedPolicyPromise = getViewerGoodsVatPolicy()
      .then((result) => (result.success ? result.data : DEFAULT_POLICY))
      .catch(() => DEFAULT_POLICY);
  }
  return cachedPolicyPromise;
}

/**
 * Resolves once per page load. Starts at the VAT-inclusive default so the
 * first paint is always the legally correct one for an anonymous visitor —
 * a validated B2B viewer's prices switch to net a moment later, they never
 * start there.
 */
export function useViewerVatPolicy() {
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

const SIZE_CLASSES = {
  sm: { price: "text-sm font-semibold", compare: "text-xs text-gray-400 line-through" },
  lg: { price: "text-2xl font-semibold", compare: "text-base text-gray-400 line-through" },
  compact: { price: "text-sm font-semibold", compare: "text-xs text-gray-400 line-through" },
};

/**
 * priceExcl/compareExcl are optional: callers that only have the VAT-inclusive
 * figure (a spot that predates the net twin) simply never render the B2B
 * variant.
 */
export function ProductPrice({ priceIncl, priceExcl = null, compareIncl = null, compareExcl = null, size = "sm" }) {
  const { isB2B } = useViewerVatPolicy();
  const classes = SIZE_CLASSES[size] ?? SIZE_CLASSES.sm;

  if (isB2B && priceExcl != null) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={`${classes.price} text-[#2F3A2E]`}>€{priceExcl.toFixed(2)} HT</span>
        {compareExcl != null && <span className={classes.compare}>€{compareExcl.toFixed(2)}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className={`${classes.price} text-[#2F3A2E]`}>€{priceIncl.toFixed(2)}</span>
      {compareIncl != null && <span className={classes.compare}>€{compareIncl.toFixed(2)}</span>}
    </div>
  );
}
