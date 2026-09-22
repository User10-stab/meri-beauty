import { afterEach, describe, expect, test, vi } from "vitest";
import { createHash } from "crypto";
import { fetchShipmentTracing, getTracingCredentials } from "../../lib/mondial-relay-tracking.js";

// Contract taken from the live WSDL (api.mondialrelay.com/Web_Services.asmx?WSDL):
// WSI2_TracingColisDetaille takes Enseigne/Expedition/Langue/Security and
// returns STAT plus a Tracing array of ret_WSI2_sub_TracingColisDetaille.
const ENV = { MONDIAL_RELAY_WSI2_ENSEIGNE: "CC229KZ2", MONDIAL_RELAY_WSI2_PRIVATE_KEY: "PrivateKey1" };

function soapResponse(inner) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<WSI2_TracingColisDetailleResponse xmlns="http://www.mondialrelay.fr/webservice/">
<WSI2_TracingColisDetailleResult>${inner}</WSI2_TracingColisDetailleResult>
</WSI2_TracingColisDetailleResponse></soap:Body></soap:Envelope>`;
}

const TWO_EVENTS = soapResponse(`<STAT>0</STAT><Libelle01>Colis</Libelle01><Tracing>
<ret_WSI2_sub_TracingColisDetaille><Libelle>Annonce expedition</Libelle><Date>20/09/2026</Date><Heure>09:12</Heure><Emplacement>JETTE</Emplacement><Relais_Num></Relais_Num><Relais_Pays>BE</Relais_Pays></ret_WSI2_sub_TracingColisDetaille>
<ret_WSI2_sub_TracingColisDetaille><Libelle>Disponible au Point Relais</Libelle><Date>22/09/2026</Date><Heure>14:03</Heure><Emplacement>JETTE</Emplacement><Relais_Num>041285</Relais_Num><Relais_Pays>BE</Relais_Pays></ret_WSI2_sub_TracingColisDetaille>
</Tracing>`);

function mockFetch(impl) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Mondial Relay tracing — configuration gate", () => {
  test("no credentials means no network call at all", async () => {
    const spy = mockFetch(() => {
      throw new Error("must not be called");
    });

    const result = await fetchShipmentTracing("12345678", { environment: {} });

    expect(spy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.notConfigured).toBe(true);
    expect(result.events).toEqual([]);
  });

  test("a blank shipment number never reaches the network", async () => {
    const spy = mockFetch(() => {
      throw new Error("must not be called");
    });

    const result = await fetchShipmentTracing("   ", { environment: ENV });

    expect(spy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  test("getTracingCredentials returns null unless both halves are present", () => {
    expect(getTracingCredentials({ MONDIAL_RELAY_WSI2_ENSEIGNE: "CC229KZ2" })).toBeNull();
    expect(getTracingCredentials({ MONDIAL_RELAY_WSI2_PRIVATE_KEY: "k" })).toBeNull();
    expect(getTracingCredentials(ENV)).toEqual({ enseigne: "CC229KZ2", privateKey: "PrivateKey1" });
  });
});

describe("Mondial Relay tracing — request shape", () => {
  test("signs with uppercase MD5 of Enseigne+Expedition+Langue+PrivateKey, and never sends the key", async () => {
    const spy = mockFetch(async () => new Response(TWO_EVENTS, { status: 200 }));

    await fetchShipmentTracing("12345678", { environment: ENV });

    const body = spy.mock.calls[0][1].body;
    const expected = createHash("md5").update("CC229KZ212345678FRPrivateKey1", "utf8").digest("hex").toUpperCase();

    expect(body).toContain(`<Security>${expected}</Security>`);
    expect(body).toContain("<Enseigne>CC229KZ2</Enseigne>");
    expect(body).toContain("<Expedition>12345678</Expedition>");
    expect(body).not.toContain("PrivateKey1");
    expect(spy.mock.calls[0][1].headers.SOAPAction).toBe(
      "http://www.mondialrelay.fr/webservice/WSI2_TracingColisDetaille"
    );
  });
});

describe("Mondial Relay tracing — response handling", () => {
  test("parses each tracing event from a successful response", async () => {
    mockFetch(async () => new Response(TWO_EVENTS, { status: 200 }));

    const result = await fetchShipmentTracing("12345678", { environment: ENV });

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events[1]).toMatchObject({
      label: "Disponible au Point Relais",
      date: "22/09/2026",
      time: "14:03",
      pickupPointId: "041285",
      countryCode: "BE",
    });
  });

  test("a non-zero STAT is a rejection, not a success with empty events", async () => {
    mockFetch(async () => new Response(soapResponse("<STAT>80</STAT>"), { status: 200 }));

    const result = await fetchShipmentTracing("12345678", { environment: ENV });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe("80");
    expect(result.rawResponse).toContain("<STAT>80</STAT>");
  });

  // Confirmed against the live production webservice (see
  // tests/fixtures/mondial-relay/README.md): a bad signature answers 97 and a
  // bad Enseigne answers 1, which is what makes 99 readable as "unknown
  // shipment" rather than an auth failure.
  test.each([
    ["1", "Enseigne"],
    ["97", "Clé privée"],
    ["99", "numéro d'expédition"],
  ])("STAT %s is reported with a message naming the actual cause", async (code, expected) => {
    mockFetch(async () => new Response(soapResponse(`<STAT>${code}</STAT>`), { status: 200 }));

    const result = await fetchShipmentTracing("00000000", { environment: ENV });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(code);
    expect(result.message).toContain(expected);
  });

  test("a successful call with no events yet still succeeds", async () => {
    mockFetch(async () => new Response(soapResponse("<STAT>0</STAT><Tracing></Tracing>"), { status: 200 }));

    const result = await fetchShipmentTracing("12345678", { environment: ENV });

    expect(result.success).toBe(true);
    expect(result.events).toEqual([]);
  });
});

describe("Mondial Relay tracing — never throws", () => {
  test("an HTTP error resolves instead of throwing", async () => {
    mockFetch(async () => new Response("boom", { status: 500 }));

    await expect(fetchShipmentTracing("12345678", { environment: ENV })).resolves.toMatchObject({
      success: false,
      events: [],
    });
  });

  test("a network failure resolves instead of throwing", async () => {
    mockFetch(async () => {
      throw new Error("ECONNRESET");
    });

    await expect(fetchShipmentTracing("12345678", { environment: ENV })).resolves.toMatchObject({
      success: false,
      events: [],
    });
  });

  test("a garbage body resolves instead of throwing", async () => {
    mockFetch(async () => new Response("<html>nope</html>", { status: 200 }));

    await expect(fetchShipmentTracing("12345678", { environment: ENV })).resolves.toMatchObject({
      success: true,
      events: [],
    });
  });
});
