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
 * @returns {Promise<{success: boolean, shipmentNumber?: string, labelUrl?: string, message?: string}>}
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

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/xml", "Content-Type": "text/xml" },
      body,
    });
  } catch (error) {
    console.error("[mondial-relay] network error", error);
    return { success: false, message: "Impossible de contacter Mondial Relay." };
  }

  const text = await response.text();

  if (!response.ok) {
    console.error("[mondial-relay] HTTP error", response.status, text.slice(0, 1000));
    return { success: false, message: `Erreur Mondial Relay (HTTP ${response.status}).` };
  }

  const shipmentNumber = text.match(/<Shipment ShipmentNumber="([^"]*)"/)?.[1] ?? null;
  const labelUrl = text.match(/<Output>([^<]*)<\/Output>/)?.[1]?.replace(/&amp;/g, "&") ?? null;

  const statuses = [...text.matchAll(/<Status Code="([^"]*)" Level="([^"]*)" Message="([^"]*)"/g)]
    .map(([, code, level, message]) => ({ code, level, message }));
  const blocking = statuses.filter((s) => s.level !== "Warning");

  if (!shipmentNumber || !labelUrl || blocking.length > 0) {
    console.error("[mondial-relay] rejected", { statuses, raw: text.slice(0, 1500) });
    return {
      success: false,
      message: blocking[0]?.message || "Mondial Relay a refusé la demande d'étiquette.",
    };
  }

  return { success: true, shipmentNumber, labelUrl };
}
