"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { MapPin, Search } from "lucide-react";
import { useTranslations } from "next-intl";

const BRAND_ID = process.env.NEXT_PUBLIC_MONDIAL_RELAY_BRAND_ID || "";

const WIDGET_JS = "https://widget.mondialrelay.com/parcelshop-picker/jquery.plugin.mondialrelay.parcelshoppicker.min.js";
const JQUERY_SRC = "https://code.jquery.com/jquery-3.7.1.min.js";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

/**
 * Mondial Relay pickup-point picker for checkout.
 *
 * Real widget mode (NEXT_PUBLIC_MONDIAL_RELAY_BRAND_ID set): embeds Mondial
 * Relay's own jQuery "ParcelShopPicker" widget — it ships its own map,
 * address search, and a native "use my location" geolocation search
 * (EnableGeolocalisatedSearch) so we don't have to build any of that
 * ourselves. This only needs the lightweight "Brand"/Enseigne code, NOT the
 * full MONDIAL_RELAY_API_LOGIN/API_KEY pair (those are the private WSI2
 * webservice credentials, only needed later for label generation).
 *
 * Fallback mode (no Brand ID yet — current reality, Marie hasn't confirmed
 * she still has Mondial Relay access): plain manual text entry so checkout
 * keeps working end-to-end without any Mondial Relay credentials at all.
 */
export function MondialRelayPicker({ value, onChange }) {
  const t = useTranslations("boutique.mondialRelay");
  if (!BRAND_ID) {
    return <ManualPickupPointForm value={value} onChange={onChange} t={t} />;
  }
  return <WidgetPickupPointPicker value={value} onChange={onChange} t={t} />;
}

function WidgetPickupPointPicker({ value, onChange, t }) {
  const containerRef = useRef(null);
  const [jqueryReady, setJqueryReady] = useState(false);
  const [leafletReady, setLeafletReady] = useState(false);
  const [widgetReady, setWidgetReady] = useState(false);
  const [widgetFailed, setWidgetFailed] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!jqueryReady || !leafletReady || !widgetReady || initializedRef.current || !containerRef.current) return;
    initializedRef.current = true;

    try {
      const $ = window.jQuery;
      if (!$?.fn?.MR_ParcelShopPicker) throw new Error("Mondial Relay widget unavailable");

      $(containerRef.current).MR_ParcelShopPicker({
        Target: "#mr-parcel-shop-target",
        Brand: BRAND_ID,
        Country: "BE",
        NbResults: 10,
        Responsive: true,
        Theme: "mondialrelay",
        ShowResultsOnMap: true,
        EnableGeolocalisatedSearch: true,
        OnParcelShopSelected: function (data) {
          onChange({
            id: data.ID ?? data.Num ?? null,
            name: data.Nom ?? "",
            address: [data.Adresse1, data.Adresse2].filter(Boolean).join(" ").trim(),
            countryCode: data.Pays ?? "BE",
            postalCode: data.CP ?? "",
            city: data.Ville ?? "",
          });
        },
      });
    } catch (error) {
      console.error("[MondialRelayPicker] initialization failed", error);
      setWidgetFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jqueryReady, leafletReady, widgetReady]);

  useEffect(() => {
    if (!widgetReady || widgetFailed || !initializedRef.current) return;
    const timeout = window.setTimeout(() => {
      if (containerRef.current && containerRef.current.childElementCount === 0) {
        console.error("[MondialRelayPicker] widget rendered no content; using manual fallback");
        setWidgetFailed(true);
      }
    }, 10_000);
    return () => window.clearTimeout(timeout);
  }, [widgetReady, widgetFailed]);

  if (widgetFailed) {
    return <ManualPickupPointForm value={value} onChange={onChange} t={t} widgetUnavailable />;
  }

  return (
    <div className="space-y-3">
      {/* Official load order: jQuery, Leaflet, then Mondial Relay. onReady is
          required here because Next.js only fires onLoad the first time a
          script loads; this picker must initialize again after navigation. */}
      <Script
        id="mondial-relay-jquery"
        src={JQUERY_SRC}
        strategy="afterInteractive"
        onReady={() => setJqueryReady(true)}
        onError={() => setWidgetFailed(true)}
      />
      {jqueryReady && (
        <Script
          id="mondial-relay-leaflet"
          src={LEAFLET_JS}
          strategy="afterInteractive"
          onReady={() => setLeafletReady(true)}
          onError={() => setWidgetFailed(true)}
        />
      )}
      {jqueryReady && leafletReady && (
        <Script
          id="mondial-relay-widget"
          src={WIDGET_JS}
          strategy="afterInteractive"
          onReady={() => setWidgetReady(true)}
          onError={() => setWidgetFailed(true)}
        />
      )}
      <link rel="stylesheet" href={LEAFLET_CSS} />

      <div ref={containerRef} id="mr-parcel-shop-zone" />
      <input id="mr-parcel-shop-target" type="hidden" />

      {value?.name && (
        <div className="flex items-start gap-2 border border-[#C8A46A]/40 bg-[#C8A46A]/5 p-3 text-sm">
          <MapPin size={16} className="mt-0.5 flex-shrink-0 text-[#C8A46A]" />
          <div>
            <p className="font-medium text-[#2F3A2E]">{value.name}</p>
            <p className="text-gray-500">{value.address}, {value.postalCode} {value.city}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ManualPickupPointForm({ value, onChange, t, widgetUnavailable = false }) {
  const point = value ?? { name: "", address: "", postalCode: "", city: "" };

  function handleChange(e) {
    const { name, value: fieldValue } = e.target;
    onChange({ ...point, id: null, [name]: fieldValue });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <Search size={14} className="mt-0.5 flex-shrink-0" />
        <p>
          {widgetUnavailable
            ? "La carte Mondial Relay est temporairement indisponible. Saisissez les informations du point relais souhaité pour continuer."
            : t("autoSearchComing")}
        </p>
      </div>
      <input
        name="name"
        value={point.name}
        onChange={handleChange}
        placeholder={t("pointName")}
        className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
        required
      />
      <input
        name="address"
        value={point.address}
        onChange={handleChange}
        placeholder={t("pointAddress")}
        className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
        required
      />
      <div className="grid grid-cols-2 gap-4">
        <input
          name="postalCode"
          value={point.postalCode}
          onChange={handleChange}
          placeholder={t("postalCode")}
          maxLength={4}
          className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
          required
        />
        <input
          name="city"
          value={point.city}
          onChange={handleChange}
          placeholder={t("city")}
          className="w-full border border-neutral-200 px-4 py-3 text-sm focus:border-[#C8A46A] focus:outline-none"
          required
        />
      </div>
      <p className="text-xs text-gray-400">{t("belgiumOnly")}</p>
    </div>
  );
}
