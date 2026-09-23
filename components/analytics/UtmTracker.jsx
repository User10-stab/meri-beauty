"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { getUtmParams, stashUtmParams } from "@/lib/utm";
import { trackPageView } from "@/lib/analytics";

/**
 * Monté une fois dans le layout racine : mémorise les UTM d'arrivée et
 * émet un page_view à chaque navigation (gtag + dataLayer, no-op si absent).
 */
export function UtmTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams?.toString() ? `?${searchParams.toString()}` : "";
    const utm = getUtmParams(query);
    if (Object.keys(utm).length > 0) stashUtmParams(utm);
    trackPageView(`${pathname || "/"}${query}`, { utm });
  }, [pathname, searchParams]);

  return null;
}
