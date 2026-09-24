/**
 * Timeline prospect — module PUR (testé).
 *
 * Anti-redondance : les routes de tracking créent la ligne d'événement
 * (MailOpening / CampaignClick) ET mettaient à jour le prospect via une
 * activité `email_opened` / `email_clicked` — chaque ouverture/clic
 * apparaissait donc DEUX fois (📝 + 👁️/👆). Règle désormais :
 * - source de vérité des ouvertures/clics = les lignes d'événement ;
 * - les activités `email_opened` / `email_clicked` (anciennes données)
 *   sont exclues de la fusion.
 */

export const TIMELINE_LIMIT = 200;

// Activités redondantes avec les lignes d'événement (legacy).
const SHADOWED_ACTIVITY_TYPES = new Set(["email_opened", "email_clicked"]);

export function buildTimeline({ activities = [], openings = [], clicks = [], limit = TIMELINE_LIMIT } = {}) {
  const timeline = [
    ...activities
      .filter((a) => !SHADOWED_ACTIVITY_TYPES.has(a.type))
      .map((a) => ({
        kind: "activity",
        type: a.type,
        date: a.createdAt,
        description: a.description,
        campaign: a.campaign ?? null,
        metadata: a.metadata ?? null,
        id: `a-${a.id}`,
      })),
    ...openings.map((o) => ({
      kind: "open",
      type: "email_opened",
      date: o.openedAt,
      description: `E-mail ouvert${o.campaign ? ` — ${o.campaign.title}` : ""}`,
      campaign: o.campaign ?? null,
      id: `o-${o.id}`,
    })),
    ...clicks.map((c) => ({
      kind: "click",
      type: "email_clicked",
      date: c.clickedAt,
      description: `Lien cliqué${c.campaign ? ` — ${c.campaign.title}` : ""}`,
      campaign: c.campaign ?? null,
      metadata: c.ctaUrl ? { url: c.ctaUrl } : null,
      id: `c-${c.id}`,
    })),
  ]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);

  return timeline;
}

export function buildCampaignEngagement({ openings = [], clicks = [] } = {}) {
  const engagementMap = new Map();
  for (const o of openings) {
    const key = o.campaignId || "hors-campagne";
    const entry = engagementMap.get(key) || { campaign: o.campaign ?? null, opens: 0, clicks: 0 };
    entry.opens += 1;
    engagementMap.set(key, entry);
  }
  for (const c of clicks) {
    const key = c.campaignId || "hors-campagne";
    const entry = engagementMap.get(key) || { campaign: c.campaign ?? null, opens: 0, clicks: 0 };
    entry.clicks += 1;
    engagementMap.set(key, entry);
  }
  return [...engagementMap.values()];
}
