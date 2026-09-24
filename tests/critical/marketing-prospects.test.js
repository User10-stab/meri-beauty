/**
 * Smoke tests (sans DB) du module Marketing Campaign + Prospect Tracking.
 * Fonctions pures uniquement : aucun accès base, aucun envoi.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  STATUS_RANK,
  normalizeEmail,
  normalizeSource,
  sanitizeUtm,
  PROSPECT_STATUS_LABELS,
  PROSPECT_SOURCE_CHOICES,
  getSourceLabel,
  isValidSource,
} from "@/lib/prospects/prospect-service";
import { getUtmParams } from "@/lib/utm";
import {
  buildDestinationUrl,
  buildClickTrackingUrl,
  buildOpenTrackingUrl,
} from "@/lib/campaigns/campaign-email";
import { SEGMENTS, isValidSegment, dedupeRecipients } from "@/lib/campaigns/segments";
import { verifyProspectUnsubscribeToken, generateProspectUnsubscribeToken } from "@/lib/campaigns/campaign-unsubscribe";
import { resolveCampaignAttachment } from "@/lib/campaigns/campaign-attachment";
import { shouldCcInternal } from "@/lib/email";
import { buildGreeting } from "@/lib/campaigns/campaign-email";
import { renderCampaignContent, looksLikeHtml } from "@/lib/campaigns/render-content";
import { campaignEmail } from "@/lib/campaigns/campaign-email";
import { toAbsoluteUrl, absolutizeContentUrls } from "@/lib/campaigns/campaign-email";
import {
  getDailyLimit,
  brusselsDayKey,
  computeBatchSize,
  nextResumeAt,
} from "@/lib/campaigns/email-quota";
import { buildTimeline, buildCampaignEngagement } from "@/lib/prospects/timeline";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("STATUS_RANK — promotion montante uniquement", () => {
  it("perdu absorbe tout, client est le rang max", () => {
    expect(STATUS_RANK.perdu).toBe(-1);
    expect(STATUS_RANK.client).toBeGreaterThan(STATUS_RANK.demo_essai);
    expect(STATUS_RANK.demo_essai).toBeGreaterThan(STATUS_RANK.interesse);
  });
  it("lecteur entre contacte et engage (ouvert sans cliquer)", () => {
    expect(STATUS_RANK.lecteur).toBeGreaterThan(STATUS_RANK.contacte);
    expect(STATUS_RANK.engage).toBeGreaterThan(STATUS_RANK.lecteur);
  });
  it("tous les statuts ont un label FR", () => {
    for (const status of Object.keys(STATUS_RANK)) {
      expect(PROSPECT_STATUS_LABELS[status]).toBeTruthy();
    }
  });
});

describe("normalizeEmail / normalizeSource / sanitizeUtm", () => {
  it("lowercase + trim", () => {
    expect(normalizeEmail("  Marie@Example.BE ")).toBe("marie@example.be");
  });
  it("mappe les sources salon", () => {
    expect(normalizeSource("instagram")).toBe("instagram");
    expect(normalizeSource("rdv")).toBe("reservation");
    expect(normalizeSource("workshop")).toBe("atelier");
    expect(normalizeSource("boutique")).toBe("boutique");
    expect(normalizeSource("n'importe quoi")).toBe("autre");
  });
  it("borne les UTM à 100 caractères", () => {
    const out = sanitizeUtm({ utmSource: "x".repeat(500), utmMedium: " email ", unknown: "z" });
    expect(out.utmSource).toHaveLength(100);
    expect(out.utmMedium).toBe("email");
    expect(out.unknown).toBeUndefined();
  });
});

describe("getUtmParams", () => {
  it("lit la query-string", () => {
    expect(getUtmParams("?utm_source=google&utm_campaign=promo"))
      .toEqual({ utmSource: "google", utmCampaign: "promo" });
  });
  it("SSR-safe sans window", () => {
    expect(getUtmParams("")).toEqual({});
  });
});

describe("tracking URLs campagne", () => {
  const campaign = { id: "c1", utmSource: "email", utmMedium: "email", utmCampaign: "promo" };
  it("destination enrichie des UTM sans écraser l'existant", () => {
    const url = buildDestinationUrl("https://meribeautystudio.com/boutique?a=1", campaign);
    expect(url).toContain("utm_source=email");
    expect(url).toContain("utm_campaign=promo");
    expect(url).toContain("a=1");
  });
  it("click/open tracking pointent vers les routes publiques", () => {
    const click = buildClickTrackingUrl("https://base.test", {
      campaignId: "c1", destinationUrl: "https://x.test/", email: "a@b.c",
    });
    expect(click).toContain("/api/campaign-clicks/track?c=c1");
    const open = buildOpenTrackingUrl("https://base.test", { campaignId: "c1", email: "a@b.c" });
    expect(open).toContain("/api/mail-openings/track?c=c1");
  });
});

describe("segments", () => {  it("tous les segments métier salon existent", () => {
    for (const s of ["newsletter", "clients", "prospects", "boutique", "appointments", "ateliers", "formations", "all"]) {
      expect(isValidSegment(s)).toBe(true);
    }
    expect(isValidSegment("licences")).toBe(false);
  });
  it("segments unitaires par statut (engagé / essai / intéressé / lecteur)", () => {
    for (const s of ["prospects_engage", "prospects_essai", "prospects_interesse", "prospects_lecteur"]) {
      expect(isValidSegment(s)).toBe(true);
    }
  });
  it("dedupe par email en gardant le userId", () => {
    const out = dedupeRecipients([
      { email: "a@b.c", firstName: null, userId: null },
      { email: "a@b.c", firstName: "A", userId: "u1" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].userId).toBe("u1");
  });
  it("SEGMENTS a un label pour le wizard", () => {
    expect(SEGMENTS.length).toBeGreaterThan(5);
    for (const s of SEGMENTS) expect(s.label).toBeTruthy();
  });
});

describe("unsubscribe prospect", () => {
  it("token HMAC lié à l'email", () => {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret";
    const token = generateProspectUnsubscribeToken("Marie@Example.be");
    expect(verifyProspectUnsubscribeToken("marie@example.be", token)).toBe(true);
    expect(verifyProspectUnsubscribeToken("autre@example.be", token)).toBe(false);
  });
});

describe("resolveCampaignAttachment", () => {  it("lit un fichier local confiné et slugifie le nom", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mb-camp-"));
    writeFileSync(path.join(dir, "123-abc.pdf"), "%PDF-1.4 test");
    const out = await resolveCampaignAttachment("/uploads/campaigns/123-abc.pdf", {
      uploadsRoot: dir,
      filenameHint: "Promo Printemps",
    });
    expect(out?.filename).toBe("promo-printemps.pdf");
    expect(out?.content?.length).toBeGreaterThan(0);
  });
  it("refuse le traversal, les extensions inconnues hors zone et le vide", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mb-camp-"));
    expect(await resolveCampaignAttachment("/uploads/campaigns/../../secret.pdf", { uploadsRoot: dir })).toBeNull();
    expect(await resolveCampaignAttachment("/uploads/autre/f.pdf", { uploadsRoot: dir })).toBeNull();
    expect(await resolveCampaignAttachment("", { uploadsRoot: dir })).toBeNull();
    expect(await resolveCampaignAttachment("ftp://x.test/f.pdf", { uploadsRoot: dir })).toBeNull();
  });
  it("télécharge une URL http(s) autorisée, refuse le reste", async () => {
    // headers-like minimal ({ get }) comme la Fetch API.
    const goodFetch = async () => ({
      ok: true,
      headers: { get: (k) => (k === "content-type" ? "application/pdf" : "4") },
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    });
    const out = await resolveCampaignAttachment("https://cdn.test/offre.pdf", { fetchImpl: goodFetch });
    expect(out?.filename?.endsWith(".pdf")).toBe(true);

    const badTypeFetch = async () => ({
      ok: true,
      headers: { get: (k) => (k === "content-type" ? "text/html" : "4") },
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    expect(await resolveCampaignAttachment("https://x.test/p.html", { fetchImpl: badTypeFetch })).toBeNull();
    expect(await resolveCampaignAttachment("https://x.test/gros.pdf", {
      fetchImpl: async () => ({
        ok: true,
        headers: { get: (k) => (k === "content-type" ? "application/pdf" : String(99 * 1024 * 1024)) },
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    })).toBeNull();
  });
});

describe("PROSPECT_SOURCE_CHOICES (dropdown)", () => {  const ENUM_VALUES = [
    "google", "google_ads", "linkedin", "facebook", "instagram", "email",
    "campagne", "salon_evenement", "recommandation", "site_web", "reservation",
    "boutique", "atelier", "formation", "contact", "autre",
  ];
  it("couvre exactement les valeurs de l'enum, avec labels FR", () => {
    expect(PROSPECT_SOURCE_CHOICES.map((c) => c.value).sort()).toEqual([...ENUM_VALUES].sort());
    for (const c of PROSPECT_SOURCE_CHOICES) {
      expect(c.label).toBeTruthy();
      expect(isValidSource(c.value)).toBe(true);
    }
    expect(isValidSource("nimporte_quoi")).toBe(false);
  });
  it("getSourceLabel résout les labels", () => {
    expect(getSourceLabel("salon_evenement")).toBe("Salon / Événement");
    expect(getSourceLabel("inconnu")).toBe("inconnu");
  });
});

describe("shouldCcInternal (copie salon)", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });
  it("jamais de copie hors production (tests locaux protégés)", () => {
    process.env.NODE_ENV = "development";
    expect(shouldCcInternal({})).toBe(false);
    expect(shouldCcInternal({ skipCc: true })).toBe(false);
  });
  it("copie en production sauf opt-out campagne", () => {
    process.env.NODE_ENV = "production";
    expect(shouldCcInternal({})).toBe(true);
    expect(shouldCcInternal({ skipCc: true })).toBe(false);
  });
});

describe("buildGreeting (Bonjour + entreprise ou nom)", () => {
  it("entreprise prioritaire", () => {
    expect(buildGreeting({ company: "Onglerie Nails", firstName: "Sara", lastName: "Ben" }))
      .toBe("Bonjour Onglerie Nails,");
  });
  it("prénom + nom si pas d'entreprise", () => {
    expect(buildGreeting({ firstName: "Sara", lastName: "Ben" })).toBe("Bonjour Sara Ben,");
    expect(buildGreeting({ firstName: "Sara" })).toBe("Bonjour Sara,");
  });
  it("repli sans identité", () => {
    expect(buildGreeting({})).toBe("Bonjour,");
    expect(buildGreeting()).toBe("Bonjour,");
  });
});

describe("renderCampaignContent (structure préservée)", () => {
  it("texte brut : sauts de ligne et espaces conservés, HTML échappé", () => {
    const out = renderCampaignContent("Ligne 1\n\nLigne 2  espacée\n<script>x</script>");
    expect(out).toContain("Ligne 1<br><br>Ligne 2");
    expect(out).toContain("&nbsp;");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });
  it("HTML admin gardé tel quel", () => {
    const html = "<p>Bonjour</p><p>À bientôt</p>";
    expect(looksLikeHtml(html)).toBe(true);
    expect(renderCampaignContent(html)).toBe(html);
  });
});

describe("campaignEmail (pixel conditionnel pour la copie salon)", () => {
  const base = {
    campaign: { title: "T", subject: "S", content: "Hello" },
    clickTrackingUrl: null,
    unsubscribeUrl: null,
  };
  it("pixel présent pour un vrai destinataire", () => {
    const { html } = campaignEmail({ ...base, openTrackingUrl: "https://x.test/pixel" });
    expect(html).toContain("https://x.test/pixel");
  });
  it("aucun pixel pour la copie témoin salon (stats non gonflées)", () => {
    const { html } = campaignEmail({ ...base, openTrackingUrl: null });
    expect(html).not.toContain("width=\"1\" height=\"1\"");
  });
});

describe("images e-mail (URLs absolues pour Gmail)", () => {
  it("toAbsoluteUrl absolutise les chemins /uploads", () => {
    expect(toAbsoluteUrl("/uploads/campaigns/a.jpg", "https://meribeautystudio.com"))
      .toBe("https://meribeautystudio.com/uploads/campaigns/a.jpg");
    expect(toAbsoluteUrl("https://cdn.test/a.jpg", "https://meribeautystudio.com"))
      .toBe("https://cdn.test/a.jpg");
    expect(toAbsoluteUrl(null, "https://meribeautystudio.com")).toBeNull();
  });
  it("absolutizeContentUrls réécrit src/href relatifs, garde le reste", () => {
    const out = absolutizeContentUrls(
      '<img src="/uploads/a.jpg"><a href="/boutique">Voir</a><a href="https://x.test/">X</a>',
      "https://meribeautystudio.com"
    );
    expect(out).toContain('src="https://meribeautystudio.com/uploads/a.jpg"');
    expect(out).toContain('href="https://meribeautystudio.com/boutique"');
    expect(out).toContain('href="https://x.test/"');
  });
  it("campaignEmail embarque l'image en absolu", () => {
    const { html } = campaignEmail({
      campaign: { title: "T", subject: "S", content: "Hello", imageUrl: "/uploads/campaigns/a.jpg" },
      openTrackingUrl: null,
      clickTrackingUrl: null,
      unsubscribeUrl: null,
      baseUrl: "https://meribeautystudio.com",
    });
    expect(html).toContain('src="https://meribeautystudio.com/uploads/campaigns/a.jpg"');
  });
});

describe("email-quota (file Resend 100/jour)", () => {
  it("computeBatchSize : min(quota restant, file restante)", () => {
    expect(computeBatchSize(100, 150)).toBe(100); // 150 prospects -> 100 partent, 50 en attente
    expect(computeBatchSize(50, 50)).toBe(50);
    expect(computeBatchSize(0, 50)).toBe(0); // quota épuisé -> reprise demain
    expect(computeBatchSize(100, 0)).toBe(0);
    expect(computeBatchSize(-5, 10)).toBe(0);
  });
  it("brusselsDayKey au format jour calendaire", () => {
    expect(brusselsDayKey(new Date("2026-09-24T10:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("nextResumeAt = +24h", () => {
    const from = new Date("2026-09-24T08:00:00Z");
    expect(nextResumeAt(from).toISOString()).toBe("2026-09-25T08:00:00.000Z");
  });
  it("getDailyLimit configurable, défaut 100", () => {
    delete process.env.RESEND_DAILY_LIMIT;
    expect(getDailyLimit()).toBe(100);
    process.env.RESEND_DAILY_LIMIT = "200";
    expect(getDailyLimit()).toBe(200);
    process.env.RESEND_DAILY_LIMIT = "nawak";
    expect(getDailyLimit()).toBe(100);
    delete process.env.RESEND_DAILY_LIMIT;
  });
});

describe("buildTimeline (anti doublon ouverture/clic)", () => {
  const d = (s) => new Date(s);
  it("une ouverture = UNE ligne (pas activité + événement)", () => {
    const timeline = buildTimeline({
      activities: [
        { id: "1", type: "email_opened", createdAt: d("2026-09-24T15:38:54"), description: "E-mail de campagne ouvert", campaign: { id: "c", title: "Boutique lancement" }, metadata: null },
        { id: "2", type: "note_added", createdAt: d("2026-09-24T15:00:00"), description: "Appelée", campaign: null, metadata: null },
      ],
      openings: [
        { id: "9", openedAt: d("2026-09-24T15:38:54"), campaignId: "c", campaign: { id: "c", title: "Boutique lancement" } },
      ],
      clicks: [],
    });
    // note + 1 ouverture (l'activité email_opened legacy est exclue)
    expect(timeline).toHaveLength(2);
    expect(timeline.filter((t) => t.kind === "open")).toHaveLength(1);
    expect(timeline[0].kind).toBe("open"); // tri desc : le plus récent d'abord
  });
  it("un clic = UNE ligne, URL conservée", () => {
    const timeline = buildTimeline({
      activities: [
        { id: "3", type: "email_clicked", createdAt: d("2026-09-24T15:38:54"), description: "Lien cliqué", campaign: null, metadata: null },
      ],
      openings: [],
      clicks: [
        { id: "7", clickedAt: d("2026-09-24T15:38:54"), campaignId: "c", campaign: { id: "c", title: "C" }, ctaUrl: "https://x.test/offre" },
      ],
    });
    expect(timeline).toHaveLength(1);
    expect(timeline[0].metadata).toEqual({ url: "https://x.test/offre" });
  });
  it("buildCampaignEngagement groupe par campagne", () => {
    const engagement = buildCampaignEngagement({
      openings: [
        { campaignId: "c", campaign: { id: "c", title: "C" } },
        { campaignId: "c", campaign: { id: "c", title: "C" } },
      ],
      clicks: [{ campaignId: "c", campaign: { id: "c", title: "C" } }],
    });
    expect(engagement).toEqual([{ campaign: { id: "c", title: "C" }, opens: 2, clicks: 1 }]);
  });
});
