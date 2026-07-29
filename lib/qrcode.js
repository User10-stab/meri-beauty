import QRCode from "qrcode";

/** Data-URL QR code for a pickup code — black-on-white for scan reliability, not brand colors. */
export async function pickupQrDataUrl(code) {
  return QRCode.toDataURL(code, { margin: 1, width: 240, color: { dark: "#000000", light: "#FFFFFF" } });
}
