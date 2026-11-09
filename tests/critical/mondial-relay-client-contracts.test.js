import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createShipmentLabel, redactCredentials } from "../../lib/mondial-relay.js";

const validArgs = {
  credentials: { login: "L", password: "P", customerId: "C" },
  sender: { name: "Meri Beauty", street: "Rue X", houseNo: "1", countryCode: "BE", postCode: "1090", city: "Jette", phone: "+32470000000", email: "" },
  recipient: { name: "Client", street: "Point Relais X", houseNo: "", countryCode: "BE", postCode: "1000", city: "Bruxelles", phone: "+32470000001", email: "client@example.com" },
  deliveryMode: { mode: "24R", location: "123456" },
  collectionMode: { mode: "CCC", location: "Auto" },
  weightGrams: 500,
  orderNo: "42",
};

function xmlResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

const SUCCESS_XML = `<?xml version="1.0"?><ShipmentCreationResponse>
<ShipmentsList><Shipment ShipmentNumber="12345678"><Status Code="0" Level="Warning" Message="OK" /></Shipment></ShipmentsList>
<OutputData><Output>https://connect-api.mondialrelay.com/label/12345678.pdf</Output></OutputData>
</ShipmentCreationResponse>`;

const REJECTION_XML = `<?xml version="1.0"?><ShipmentCreationResponse>
<ShipmentsList><Shipment><Status Code="70" Level="Error" Message="Point relais inconnu" /></Shipment></ShipmentsList>
</ShipmentCreationResponse>`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createShipmentLabel", () => {
  test("a real success is parsed and the full raw body is returned", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(xmlResponse(SUCCESS_XML)));
    const result = await createShipmentLabel(validArgs);
    expect(result).toEqual({
      success: true,
      shipmentNumber: "12345678",
      labelUrl: "https://connect-api.mondialrelay.com/label/12345678.pdf",
      rawResponse: SUCCESS_XML,
    });
  });

  test("a clear rejection (no ShipmentNumber, blocking status) is a confirmed, non-uncertain failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(xmlResponse(REJECTION_XML)));
    const result = await createShipmentLabel(validArgs);
    expect(result.success).toBe(false);
    expect(result.uncertain).toBeFalsy();
    expect(result.message).toBe("Point relais inconnu");
    expect(result.rawResponse).toBe(REJECTION_XML);
  });

  test("an HTTP error response is a confirmed failure, not uncertain — we did get an answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(xmlResponse("Unauthorized", { status: 401 })));
    const result = await createShipmentLabel(validArgs);
    expect(result.success).toBe(false);
    expect(result.uncertain).toBeFalsy();
    expect(result.message).toContain("401");
    expect(result.rawResponse).toBe("Unauthorized");
  });

  test("a network error (fetch throws) is uncertain — we never got a response back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const result = await createShipmentLabel(validArgs);
    expect(result.success).toBe(false);
    expect(result.uncertain).toBe(true);
    expect(result.rawResponse).toBeNull();
    expect(result.message).toContain("Vérifiez le portail Mondial Relay");
  });

  test("an aborted request (our own timeout) is also uncertain, not a clean failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }))
    );
    const promise = createShipmentLabel(validArgs);
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.uncertain).toBe(true);
  });

  test("special characters in names are XML-escaped, not left to break the request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(xmlResponse(REJECTION_XML));
    vi.stubGlobal("fetch", fetchMock);
    await createShipmentLabel({
      ...validArgs,
      recipient: { ...validArgs.recipient, name: `Léa <Dupont> & "Co" 'x'` },
    });
    const body = fetchMock.mock.calls[0][1].body;
    expect(body).toContain("Léa &lt;Dupont&gt; &amp; &quot;Co&quot; &apos;x&apos;");
    expect(body).not.toContain("<Dupont>");
  });

  test("a successful body still missing a ShipmentNumber or a label URL is treated as a rejection", async () => {
    const noNumber = `<Shipment><Status Level="Warning" Code="0" Message="" /></Shipment>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(xmlResponse(noNumber)));
    const result = await createShipmentLabel(validArgs);
    expect(result.success).toBe(false);
    expect(result.uncertain).toBeFalsy();
  });
});

describe("password echoed back by Mondial Relay", () => {
  const ECHO = (inner) => `<ShipmentCreationResponse><Context><Login>L@x</Login><Password>s3cr$t;+!&amp;x</Password><CustomerId>C</CustomerId></Context>${inner}</ShipmentCreationResponse>`;

  test("redactCredentials masks the password and nothing else", () => {
    expect(redactCredentials(ECHO(""))).toBe(
      "<ShipmentCreationResponse><Context><Login>L@x</Login><Password>***</Password><CustomerId>C</CustomerId></Context></ShipmentCreationResponse>"
    );
    expect(redactCredentials(null)).toBe(null);
  });

  test("success: rawResponse never contains the password, label still parsed", async () => {
    const body = ECHO(`<ShipmentsList><Shipment ShipmentNumber="03452431"><Status Code="0" Level="Warning" Message="OK" /></Shipment></ShipmentsList><OutputData><Output>https://x/label.pdf</Output></OutputData>`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(xmlResponse(body)));
    const result = await createShipmentLabel(validArgs);
    expect(result.success).toBe(true);
    expect(result.shipmentNumber).toBe("03452431");
    expect(result.labelUrl).toBe("https://x/label.pdf");
    expect(result.rawResponse).not.toContain("s3cr");
    expect(result.rawResponse).toContain("<Password>***</Password>");
  });

  test("rejection and HTTP error: rawResponse and logs never contain the password", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rejected = ECHO(`<StatusList><Status Code="99999" Level="Error" Message="No price" /></StatusList>`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(xmlResponse(rejected)));
    const r1 = await createShipmentLabel(validArgs);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(xmlResponse(ECHO(""), { status: 500 })));
    const r2 = await createShipmentLabel(validArgs);
    expect(r1.message).toBe("No price");
    for (const r of [r1, r2]) expect(r.rawResponse).not.toContain("s3cr");
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain("s3cr");
    errSpy.mockRestore();
  });
});
