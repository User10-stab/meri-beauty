"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { MapPin, Search } from "lucide-react";
import { useTranslations } from "next-intl";

const BRAND_ID = process.env.NEXT_PUBLIC_MONDIAL_RELAY_BRAND_ID || "";

const WIDGET_JS = "https://widget.mondialrelay.com/parcelshop-picker/jquery.plugin.mondialrelay.parcelshoppicker.min.js";
const WIDGET_CSS = "https://widget.mondialrelay.com/parcelshop-picker/jquery.plugin.mondialrelay.parcelshoppicker.min.css";
const JQUERY_SRC = "https://code.jquery.com/jquery-3.7.1.min.js";

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
  return <WidgetPickupPointPicker value={value} onChange={onChange} />;
}

function WidgetPickupPointPicker({ value, onChange }) {
  const containerRef = useRef(null);
  const targetRef = useRef(null);
  const [jqueryReady, setJqueryReady] = useState(false);
  const [widgetReady, setWidgetReady] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!jqueryReady || !widgetReady || initializedRef.current || !containerRef.current) return;
    initializedRef.current = true;

    const $ = window.jQuery;
    $(containerRef.current).MR_ParcelShopPicker({
      Target: targetRef.current,
      Brand: BRAND_ID,
      Country: "BE",
      NbResults: 10,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jqueryReady, widgetReady]);

  return (
    <div className="space-y-3">
      {/* The widget script assumes a global `jQuery` at parse time — loading both
          scripts in parallel let the widget sometimes execute first and throw
          "jQuery is not defined", silently leaving MR_ParcelShopPicker
          unregistered. Gating the second Script behind jqueryReady forces
          them to run strictly in order. */}
      <Script src={JQUERY_SRC} strategy="afterInteractive" onLoad={() => setJqueryReady(true)} />
      {jqueryReady && (
        <Script src={WIDGET_JS} strategy="afterInteractive" onLoad={() => setWidgetReady(true)} />
      )}
      <link rel="stylesheet" href={WIDGET_CSS} />

      <div ref={containerRef} id="mr-parcel-shop-zone" />
      <input ref={targetRef} type="hidden" />

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

function ManualPickupPointForm({ value, onChange, t }) {
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
          {t("autoSearchComing")}
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
