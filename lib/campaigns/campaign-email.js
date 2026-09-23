/**
 * Gabarit d'e-mail de campagne marketing.
 *
 * Exigences (tracking + conformité) :
 * - pixel invisible -> GET /api/mail-openings/track (comptabilise openedCount) ;
 * - bouton/lien CTA -> URL de tracking /api/campaign-clicks/track qui
 *   redirige 302 vers la destination (comptabilise clickedCount) ;
 * - lien de désinscription visible (compte OU prospect).
 *
 * Le HTML passe par brandedHtml() donc par le shell Meri Beauty —
 * sendEmail() le garantit de toute façon.
 */

import { brandedHtml, escapeHtml } from "@/lib/email-templates";
import { renderCampaignContent } from "@/lib/campaigns/render-content";

/**
 * Un e-mail n'a pas d'URL de base : toute URL relative (/uploads/…)
 * y est inaffichable (image cassée dans Gmail). On absolutise avec
 * l'URL publique de l'app. Les http(s) et data: sont laissés intacts.
 */
export function toAbsoluteUrl(url, baseUrl) {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  if (/^(https?:|data:|cid:)/i.test(raw)) return raw;
  if (raw.startsWith("/") && baseUrl) {
    return `${String(baseUrl).replace(/\/+$/, "")}${raw}`;
  }
  return raw;
}

/** Réécrit les src="/…" et href="/…" relatifs d'un HTML en absolus. */
export function absolutizeContentUrls(html, baseUrl) {
  if (!baseUrl) return html;
  return String(html ?? "").replace(
    /((?:src|href)\s*=\s*["'])(\/(?!\/)[^"']*)/gi,
    (_, prefix, path) => `${prefix}${String(baseUrl).replace(/\/+$/, "")}${path}`
  );
}

export function buildDestinationUrl(ctaUrl, campaign, recipientEmail) {
  if (!ctaUrl) return null;
  try {
    const url = new URL(ctaUrl);
    url.searchParams.set("utm_source", campaign.utmSource || "email");
    url.searchParams.set("utm_medium", campaign.utmMedium || "email");
    if (campaign.utmCampaign) url.searchParams.set("utm_campaign", campaign.utmCampaign);
    else url.searchParams.set("utm_campaign", `campagne_${campaign.id}`);
    if (campaign.utmContent) url.searchParams.set("utm_content", campaign.utmContent);
    if (campaign.utmTerm) url.searchParams.set("utm_term", campaign.utmTerm);
    return url.toString();
  } catch {
    return ctaUrl;
  }
}

export function buildClickTrackingUrl(baseUrl, { campaignId, destinationUrl, email, userId }) {
  const params = new URLSearchParams({
    c: campaignId,
    url: destinationUrl,
    ...(email ? { e: email } : {}),
    ...(userId ? { u: userId } : {}),
  });
  return `${baseUrl}/api/campaign-clicks/track?${params.toString()}`;
}

export function buildOpenTrackingUrl(baseUrl, { campaignId, email, userId }) {
  const params = new URLSearchParams({
    c: campaignId,
    ...(email ? { e: email } : {}),
    ...(userId ? { u: userId } : {}),
  });
  return `${baseUrl}/api/mail-openings/track?${params.toString()}`;
}

/**
 * Formule de politesse : nom d'entreprise en priorité, sinon prénom +
 * nom s'ils sont renseignés, sinon "Bonjour," seul.
 */
export function buildGreeting({ firstName, lastName, company } = {}) {
  const person = [firstName, lastName].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ");
  const who = String(company ?? "").trim() || person;
  return who ? `Bonjour ${who},` : "Bonjour,";
}

export function campaignEmail({ campaign, firstName, lastName, company, clickTrackingUrl, openTrackingUrl, unsubscribeUrl, baseUrl }) {
  const subject = campaign.subject;
  const greeting = buildGreeting({ firstName, lastName, company });
  // Structure d'origine préservée (texte brut ou HTML admin), URLs
  // relativess rendues absolues pour l'affichage en boîte mail.
  const safeContent = absolutizeContentUrls(renderCampaignContent(campaign.content), baseUrl);
  const safeCtaText = escapeHtml(campaign.ctaText || "Découvrir");
  const safePreheader = campaign.preheader ? escapeHtml(campaign.preheader) : "";

  const absoluteImage = toAbsoluteUrl(campaign.imageUrl, baseUrl);
  const imageHtml = absoluteImage
    ? `<p style="text-align:center;margin:0 0 20px;"><img src="${escapeHtml(absoluteImage)}" alt="" style="max-width:100%;border-radius:12px;" /></p>`
    : "";

  const ctaHtml = clickTrackingUrl
    ? `<p style="text-align:center;margin:28px 0;"><a href="${escapeHtml(clickTrackingUrl)}" style="display:inline-block;background-color:#2F3A2E;color:#ffffff;padding:14px 32px;border-radius:999px;text-decoration:none;font-weight:600;">${safeCtaText}</a></p>`
    : "";

  const bodyHtml = `
    ${campaign.preheader ? `<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${safePreheader}</span>` : ""}
    <p>${greeting}</p>
    ${imageHtml}
    <div>${safeContent}</div>
    ${ctaHtml}
    ${openTrackingUrl ? `<img src="${escapeHtml(openTrackingUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;" />` : ""}
  `;

  const html = brandedHtml(campaign.title || subject, bodyHtml, unsubscribeUrl);
  const text = [
    greeting.replace(/<[^>]*>/g, ""),
    "",
    campaign.preheader || "",
    "",
    "Voir en ligne :",
    clickTrackingUrl || "",
    "",
    `Pour ne plus recevoir nos campagnes : ${unsubscribeUrl || ""}`,
  ].filter(Boolean).join("\n");

  return { subject, text, html };
}
