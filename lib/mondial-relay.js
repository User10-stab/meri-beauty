/**
 * Mondial Relay "Connect" shipment API (REST/XML, Dual Carrier spec V-2.7.1).
 *
 * NOT the old WSI2 SOAP webservice (WSI2_CreationEtiquette) — that method
 * was retired for new integrations in April 2024, with accounts created
 * after 2024-12-23 hard-blocked from using it at all. This is the current
 * replacement: single REST endpoint, XML request/response bodies, and
 * Login/Password/CustomerId credentials instead of an Enseigne + MD5-signed
 * private key. Verified against the live spec on 2026-08-06.
 *
 * Credentials come from Marie's Mondial Relay "Connect" portal
 * (https://connect.mondialrelay.com) — Administration > Configuration des
 * API > "API Version V2.0" — NOT the old Enseigne/private-key pair from her
 * Shopify-era setup, which was for the now-retired WSI2 method.
 */

const ENDPOINT = process.env.MONDIAL_RELAY_SANDBOX === "true"
  ? "https://connect-api-sandbox.mondialrelay.com/api/shipment"
  : "https://connect-api.mondialrelay.com/api/shipment";

// If we never get a response back at all (timeout, connection dropped mid-
// request, DNS hiccup), we genuinely don't know whether Mondial Relay
// received and processed the request before we gave up — see the
// `uncertain` flag below. 25s gives real headroom over a normal response
// while still resolving the Server Action within a reasonable time.
const REQUEST_TIMEOUT_MS = 25_000;

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  }[c]));
}

function addressXml(addr) {
  return `<Address>` +
    `<AddressAdd1>${escapeXml(addr.name)}</AddressAdd1>` +
    `<Streetname>${escapeXml(addr.street)}</Streetname>` +
    `<HouseNo>${escapeXml(addr.houseNo)}</HouseNo>` +
    `<CountryCode>${escapeXml(addr.countryCode)}</CountryCode>` +
    `<PostCode>${escapeXml(addr.postCode)}</PostCode>` +
    `<City>${escapeXml(addr.city)}</City>` +
    `<PhoneNo>${escapeXml(addr.phone)}</PhoneNo>` +
    `<Email>${escapeXml(addr.email)}</Email>` +
    `</Address>`;
}

/**
 * @param {object} params
 * @param {{login: string, password: string, customerId: string}} params.credentials
 * @param {{name: string, street: string, houseNo: string, countryCode: string, postCode: string, city: string, phone: string, email: string}} params.sender
 * @param {{name: string, street: string, houseNo: string, countryCode: string, postCode: string, city: string, phone: string, email: string}} params.recipient
 * @param {{mode: string, location: string}} params.deliveryMode - e.g. {mode: "24R", location: <pickupPointId>}
 * @param {{mode: string, location: string}} params.collectionMode - e.g. {mode: "REL", location: "Auto"}
 * @param {number} params.weightGrams
 * @param {string} params.orderNo
 * @param {string} [params.deliveryInstruction]
 * @param {{format: string, type: string}} [params.output] - defaults to 10x15 PDF (matches Marie's thermal label printer)
 * @returns {Promise<{success: boolean, shipmentNumber?: string, labelUrl?: string, message?: string, rawResponse: string|null, uncertain?: boolean}>}
 *   `rawResponse` is the full response/error body on every outcome, success
 *   or failure — the caller persists it (Order.labelRawResponse) since the
 *   regex parse below has never been checked against a real Mondial Relay
 *   response. `uncertain: true` means we never got a response back at all
 *   (timeout or network failure) — the caller must NOT treat this as "no
 *   shipment was created" the way an ordinary failure is treated; Mondial
 *   Relay may have received and processed the request before we gave up
 *   waiting. Any outcome where we did get an HTTP response — success or a
 *   clear rejection — is not `uncertain`: we know what Mondial Relay told
 *   us, even if it's an error.
 */
export async function createShipmentLabel({
  credentials, sender, recipient, deliveryMode, collectionMode, weightGrams, orderNo,
  deliveryInstruction = "", output = { format: "10x15", type: "PdfUrl" },
}) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<ShipmentCreationRequest xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="http://www.example.org/Request">
<Context>
<Login>${escapeXml(credentials.login)}</Login>
<Password>${escapeXml(credentials.password)}</Password>
<CustomerId>${escapeXml(credentials.customerId)}</CustomerId>
<Culture>fr-BE</Culture>
<VersionAPI>1.0</VersionAPI>
</Context>
<OutputOptions>
<OutputFormat>${escapeXml(output.format)}</OutputFormat>
<OutputType>${escapeXml(output.type)}</OutputType>
</OutputOptions>
<ShipmentsList>
<Shipment>
<OrderNo>${escapeXml(orderNo)}</OrderNo>
<ParcelCount>1</ParcelCount>
<DeliveryMode Mode="${escapeXml(deliveryMode.mode)}" Location="${escapeXml(deliveryMode.location)}" />
<CollectionMode Mode="${escapeXml(collectionMode.mode)}" Location="${escapeXml(collectionMode.location)}" />
<Parcels><Parcel><Weight Value="${escapeXml(weightGrams)}" Unit="gr" /></Parcel></Parcels>
${deliveryInstruction ? `<DeliveryInstruction>${escapeXml(deliveryInstruction)}</DeliveryInstruction>` : ""}
<Sender>${addressXml(sender)}</Sender>
<Recipient>${addressXml(recipient)}</Recipient>
</Shipment>
</ShipmentsList>
</ShipmentCreationRequest>`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/xml", "Content-Type": "text/xml" },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    // We never got a response — Mondial Relay may or may not have received
    // and processed the request before this timed out/dropped. This is
    // deliberately NOT the same as an ordinary rejection: the caller must
    // not clear its purchase claim on this outcome, or a retry could buy a
    // second real, billed shipment for the same order.
    console.error("[mondial-relay] no response received (timeout or network error)", error);
    return {
      success: false,
      uncertain: true,
      message: "Mondial Relay n'a pas répondu — impossible de savoir si l'étiquette a été créée. Vérifiez le portail Mondial Relay avant de réessayer.",
      rawResponse: null,
    };
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();

  if (!response.ok) {
    // An HTTP-level error is still an answer from Mondial Relay, not a lost
    // request — log the full body (not just a truncated slice) so a
    // misclassification can be diagnosed from labelRawResponse rather than
    // guessed at.
    console.error("[mondial-relay] HTTP error", response.status, text);
    return { success: false, message: `Erreur Mondial Relay (HTTP ${response.status}).`, rawResponse: text };
  }

  const shipmentNumber = text.match(/<Shipment ShipmentNumber="([^"]*)"/)?.[1] ?? null;
  const labelUrl = text.match(/<Output>([^<]*)<\/Output>/)?.[1]?.replace(/&amp;/g, "&") ?? null;

  const statuses = [...text.matchAll(/<Status Code="([^"]*)" Level="([^"]*)" Message="([^"]*)"/g)]
    .map(([, code, level, message]) => ({ code, level, message }));
  // NOTE: this Level!=="Warning" filter has never been checked against a
  // real Mondial Relay success response (see the sandbox-characterization
  // step in the Mondial Relay test plan) — if a genuine success carries a
  // Status whose Level isn't literally "Warning", this misreports it as a
  // rejection despite the shipment having been created and billed. Always
  // log the full statuses + raw body either way so that's diagnosable from
  // labelRawResponse rather than silently lost.
  const blocking = statuses.filter((s) => s.level !== "Warning");

  if (!shipmentNumber || !labelUrl || blocking.length > 0) {
    console.error("[mondial-relay] rejected", { statuses, raw: text });
    return {
      success: false,
      message: blocking[0]?.message || "Mondial Relay a refusé la demande d'étiquette.",
      rawResponse: text,
    };
  }

  console.log("[mondial-relay] shipment created", { shipmentNumber, statuses });
  return { success: true, shipmentNumber, labelUrl, rawResponse: text };
}
