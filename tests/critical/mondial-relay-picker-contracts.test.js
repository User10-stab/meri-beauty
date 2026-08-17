import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const picker = readFileSync(`${root}components/boutique/MondialRelayPicker.jsx`, "utf8");

describe("Mondial Relay picker availability", () => {
  test("loads the official dependencies in order and re-arms them after navigation", () => {
    expect(picker).toContain("const LEAFLET_JS");
    expect(picker).toContain("const LEAFLET_CSS");
    expect(picker).toContain("jqueryReady && leafletReady");
    expect(picker).toContain("onReady={() => setJqueryReady(true)}");
    expect(picker).toContain("onReady={() => setLeafletReady(true)}");
    expect(picker).toContain("onReady={() => setWidgetReady(true)}");
  });

  test("does not request the obsolete Mondial Relay stylesheet that returns 404", () => {
    expect(picker).not.toContain("jquery.plugin.mondialrelay.parcelshoppicker.min.css");
  });

  test("falls back to manual point entry instead of blocking checkout", () => {
    expect(picker).toContain("onError={() => setWidgetFailed(true)}");
    expect(picker).toContain("widget rendered no content; using manual fallback");
    expect(picker).toContain("<ManualPickupPointForm value={value} onChange={onChange} t={t} widgetUnavailable />");
  });
});
