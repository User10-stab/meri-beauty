import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { randomBytes } from "node:crypto";

// PrismaClient se construit à l'import de lib/prisma : on le remplace, ces
// tests ne touchent aucune base.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { encryptSecret, decryptSecret } = await import("@/lib/token-encryption");
const {
  buildAuthorizedClient,
  needsRefresh,
  persistRefreshedTokens,
  resolveDateRange,
  summarizeRows,
  formatDimensionRow,
  toApiDate,
  parseApiDate,
  resolveSiteUrl,
  DATA_LAG_DAYS,
  DEFAULT_RANGE_DAYS,
} = await import("@/lib/seo/search-console");
const { SEO_ERROR_CODES } = await import("@/lib/seo/errors");
const {
  createGoogleOAuthState,
  verifyGoogleOAuthState,
  readEmailFromIdToken,
} = await import("@/lib/seo/google-oauth");
const { createStripeOAuthState } = await import("@/lib/stripe-oauth");
const { cacheKey, cached, invalidateCache } = await import("@/lib/seo/cache");

const KEY = randomBytes(32).toString("base64");

let originalKey;
let originalSecret;

beforeEach(() => {
  originalKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  originalSecret = process.env.AUTH_SECRET;
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = KEY;
  process.env.AUTH_SECRET = "secret-de-test-pour-les-etats-oauth";
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = originalKey;
  if (originalSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalSecret;
});

/** Une ligne GoogleConnection plausible. */
function connectionFixture({ expiresAt = new Date(Date.now() + 60 * 60 * 1000) } = {}) {
  return {
    id: "conn_1",
    userId: "user_1",
    googleEmail: "marie@meribeauty.com",
    accessToken: encryptSecret("access-token-courant"),
    refreshToken: encryptSecret("refresh-token-durable"),
    expiresAt,
    siteUrl: "sc-domain:meribeautystudio.com",
  };
}

/** Un client OAuth2 googleapis factice. */
function oauthClientMock(credentials = {}) {
  return {
    credentials: null,
    setCredentials: vi.fn(function set(value) {
      this.credentials = value;
    }),
    refreshAccessToken: vi.fn(async () => ({
      credentials: {
        access_token: "access-token-renouvele",
        expiry_date: Date.now() + 3600_000,
        ...credentials,
      },
    })),
  };
}

/** Un client Prisma factice réduit à googleConnection.update. */
function prismaMock() {
  return { googleConnection: { update: vi.fn(async () => ({})) } };
}

describe("needsRefresh", () => {
  const now = Date.UTC(2026, 8, 18, 12, 0, 0);

  test("un jeton valable encore une heure ne déclenche rien", () => {
    expect(needsRefresh(new Date(now + 3600_000), now)).toBe(false);
  });

  test("un jeton déjà expiré déclenche le renouvellement", () => {
    expect(needsRefresh(new Date(now - 1000), now)).toBe(true);
  });

  test("un jeton qui expire dans la minute est traité comme expiré", () => {
    // Sans cette marge, un appel lancé juste avant l'échéance arriverait
    // chez Google avec un jeton mort et remonterait un 401 — que l'écran
    // traduirait en « reconnexion nécessaire » à tort.
    expect(needsRefresh(new Date(now + 60_000), now)).toBe(true);
  });

  test("une date d'expiration absente ou illisible est traitée comme expirée", () => {
    expect(needsRefresh(null, now)).toBe(true);
    expect(needsRefresh(undefined, now)).toBe(true);
    expect(needsRefresh(new Date("pas-une-date"), now)).toBe(true);
  });
});

describe("buildAuthorizedClient", () => {
  test("utilise le jeton existant sans appeler Google quand il est encore valable", async () => {
    const oauth = oauthClientMock();
    const client = prismaMock();

    await buildAuthorizedClient(connectionFixture(), { client, oauthClient: oauth });

    expect(oauth.refreshAccessToken).not.toHaveBeenCalled();
    expect(client.googleConnection.update).not.toHaveBeenCalled();
    expect(oauth.setCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: "access-token-courant",
        refresh_token: "refresh-token-durable",
      })
    );
  });

  test("renouvelle et enregistre le nouveau jeton quand il a expiré", async () => {
    const oauth = oauthClientMock();
    const client = prismaMock();
    const connection = connectionFixture({ expiresAt: new Date(Date.now() - 1000) });

    await buildAuthorizedClient(connection, { client, oauthClient: oauth });

    expect(oauth.refreshAccessToken).toHaveBeenCalledOnce();
    expect(client.googleConnection.update).toHaveBeenCalledOnce();

    const update = client.googleConnection.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "conn_1" });
    // Le nouveau jeton part en base CHIFFRÉ, jamais en clair.
    expect(update.data.accessToken).not.toBe("access-token-renouvele");
    expect(decryptSecret(update.data.accessToken)).toBe("access-token-renouvele");
  });

  test("un renouvellement n'efface pas le refresh token quand Google n'en renvoie pas", async () => {
    // Google ne renvoie un refresh token qu'au premier consentement. Écraser
    // le nôtre avec une valeur absente couperait l'accès pour de bon.
    const client = prismaMock();
    await persistRefreshedTokens("conn_1", { access_token: "nouveau" }, { client });

    const update = client.googleConnection.update.mock.calls[0][0];
    expect(update.data).not.toHaveProperty("refreshToken");
    expect(update.data.accessToken).toBeTruthy();
  });

  test("un refresh token renvoyé par Google remplace bien l'ancien, chiffré", async () => {
    const client = prismaMock();
    await persistRefreshedTokens(
      "conn_1",
      { access_token: "a", refresh_token: "nouveau-refresh", expiry_date: 1789000000000 },
      { client }
    );

    const update = client.googleConnection.update.mock.calls[0][0];
    expect(decryptSecret(update.data.refreshToken)).toBe("nouveau-refresh");
    expect(update.data.expiresAt).toEqual(new Date(1789000000000));
  });

  test("n'écrit rien quand Google ne renvoie aucun jeton exploitable", async () => {
    const client = prismaMock();
    await persistRefreshedTokens("conn_1", {}, { client });
    expect(client.googleConnection.update).not.toHaveBeenCalled();
  });

  test("des jetons illisibles demandent une reconnexion plutôt qu'une erreur opaque", async () => {
    const connection = { ...connectionFixture(), refreshToken: "pas-du-chiffre-valide" };

    await expect(
      buildAuthorizedClient(connection, { client: prismaMock(), oauthClient: oauthClientMock() })
    ).rejects.toMatchObject({ seoCode: SEO_ERROR_CODES.RECONNEXION_REQUISE });
  });

  test("une connexion sans refresh token demande une reconnexion", async () => {
    const connection = { ...connectionFixture(), refreshToken: null };

    await expect(
      buildAuthorizedClient(connection, { client: prismaMock(), oauthClient: oauthClientMock() })
    ).rejects.toMatchObject({ seoCode: SEO_ERROR_CODES.RECONNEXION_REQUISE });
  });
});

describe("summarizeRows", () => {
  test("additionne les clics et les impressions", () => {
    const summary = summarizeRows([
      { clicks: 10, impressions: 100, position: 5 },
      { clicks: 5, impressions: 400, position: 20 },
    ]);

    expect(summary.clicks).toBe(15);
    expect(summary.impressions).toBe(500);
  });

  test("recalcule le CTR global au lieu de moyenner les CTR ligne à ligne", () => {
    // Moyenner donnerait (10 % + 1,25 %) / 2 = 5,6 % ; le vrai CTR est
    // 15/500 = 3 %. La moyenne donnerait le même poids à une requête vue
    // 100 fois et à une vue 400 fois.
    const summary = summarizeRows([
      { clicks: 10, impressions: 100, ctr: 0.1, position: 5 },
      { clicks: 5, impressions: 400, ctr: 0.0125, position: 20 },
    ]);

    expect(summary.ctr).toBeCloseTo(0.03, 10);
  });

  test("pondère la position moyenne par les impressions", () => {
    // (5×100 + 20×400) / 500 = 17, pas (5+20)/2 = 12,5.
    const summary = summarizeRows([
      { clicks: 10, impressions: 100, position: 5 },
      { clicks: 5, impressions: 400, position: 20 },
    ]);

    expect(summary.position).toBeCloseTo(17, 10);
  });

  test("ne divise pas par zéro quand la période est vide", () => {
    expect(summarizeRows([])).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
    expect(summarizeRows(null)).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
  });

  test("ignore les valeurs absentes plutôt que de produire NaN", () => {
    const summary = summarizeRows([{ clicks: undefined, impressions: 10, position: null }]);
    expect(Number.isNaN(summary.ctr)).toBe(false);
    expect(summary.clicks).toBe(0);
  });
});

describe("formatDimensionRow", () => {
  test("extrait la clé de dimension et normalise les nombres", () => {
    expect(
      formatDimensionRow({ keys: ["institut de beauté bruxelles"], clicks: 3, impressions: 42, ctr: 0.07, position: 8.4 })
    ).toEqual({
      key: "institut de beauté bruxelles",
      clicks: 3,
      impressions: 42,
      ctr: 0.07,
      position: 8.4,
    });
  });

  test("survit à une ligne sans clé", () => {
    expect(formatDimensionRow({}).key).toBe("—");
  });
});

describe("resolveDateRange", () => {
  const now = new Date("2026-09-18T10:00:00Z");

  test("la plage par défaut s'arrête avant les jours non consolidés par Google", () => {
    // Terminer aujourd'hui afficherait deux ou trois journées à zéro, que
    // l'on lirait comme une chute de trafic.
    const { startDate, endDate } = resolveDateRange({ now });
    expect(endDate).toBe("2026-09-15");
    expect(DATA_LAG_DAYS).toBe(3);
  });

  test("la plage par défaut couvre 28 jours, bornes comprises", () => {
    const { startDate, endDate } = resolveDateRange({ now });
    const days =
      (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000 + 1;
    expect(days).toBe(DEFAULT_RANGE_DAYS);
  });

  test("une plage explicite et valide est respectée", () => {
    expect(resolveDateRange({ from: "2026-01-01", to: "2026-01-31", now })).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
  });

  test("une plage inversée retombe sur la valeur par défaut au lieu d'un appel absurde", () => {
    expect(resolveDateRange({ from: "2026-02-01", to: "2026-01-01", now })).toEqual(
      resolveDateRange({ now })
    );
  });

  test("un paramètre d'URL bricolé donne un écran utilisable, pas une erreur", () => {
    expect(resolveDateRange({ from: "hier", to: "<script>", now })).toEqual(resolveDateRange({ now }));
    expect(resolveDateRange({ from: "2026-13-45", to: "2026-01-01", now })).toEqual(
      resolveDateRange({ now })
    );
  });
});

describe("toApiDate / parseApiDate", () => {
  test("formate en AAAA-MM-JJ avec un zéro de tête", () => {
    expect(toApiDate(new Date("2026-01-05T23:00:00Z"))).toBe("2026-01-05");
  });

  test("n'accepte que le format attendu par Google", () => {
    expect(parseApiDate("2026-09-18")).toBe("2026-09-18");
    expect(parseApiDate("18/09/2026")).toBeNull();
    expect(parseApiDate(20260918)).toBeNull();
    expect(parseApiDate(null)).toBeNull();
  });
});

describe("resolveSiteUrl", () => {
  const originalSite = process.env.GOOGLE_SEARCH_CONSOLE_SITE;

  afterEach(() => {
    if (originalSite === undefined) delete process.env.GOOGLE_SEARCH_CONSOLE_SITE;
    else process.env.GOOGLE_SEARCH_CONSOLE_SITE = originalSite;
  });

  test("la propriété enregistrée prime sur la variable d'environnement", () => {
    process.env.GOOGLE_SEARCH_CONSOLE_SITE = "https://exemple.test/";
    expect(resolveSiteUrl({ siteUrl: "sc-domain:meribeautystudio.com" })).toBe(
      "sc-domain:meribeautystudio.com"
    );
  });

  test("sans propriété enregistrée, l'environnement sert de valeur initiale", () => {
    process.env.GOOGLE_SEARCH_CONSOLE_SITE = "https://exemple.test/";
    expect(resolveSiteUrl({ siteUrl: null })).toBe("https://exemple.test/");
    expect(resolveSiteUrl(null)).toBe("https://exemple.test/");
  });

  test("sans rien du tout, renvoie null au lieu d'une chaîne vide", () => {
    delete process.env.GOOGLE_SEARCH_CONSOLE_SITE;
    expect(resolveSiteUrl(null)).toBeNull();
  });
});

describe("état OAuth signé", () => {
  test("un état émis par nous se relit", () => {
    expect(verifyGoogleOAuthState(createGoogleOAuthState("user_1"))).toEqual({ userId: "user_1" });
  });

  test("un état falsifié est rejeté", () => {
    const state = createGoogleOAuthState("user_1");
    const [payload] = state.split(".");
    expect(verifyGoogleOAuthState(`${payload}.signature-inventee`)).toBeNull();
  });

  test("un contenu modifié sans re-signature est rejeté", () => {
    const [, signature] = createGoogleOAuthState("user_1").split(".");
    const forged = Buffer.from(
      JSON.stringify({
        purpose: "google-search-console",
        userId: "user_2",
        nonce: "x",
        exp: Date.now() + 60_000,
      })
    ).toString("base64url");

    expect(verifyGoogleOAuthState(`${forged}.${signature}`)).toBeNull();
  });

  test("un état émis pour un autre flux OAuth ne passe pas ici", () => {
    // Le champ `purpose` est ce qui empêche qu'un état du flux Stripe
    // Connect soit rejoué sur la connexion Google.
    expect(verifyGoogleOAuthState(createStripeOAuthState("staff_1", "user_1"))).toBeNull();
  });

  test("un état expiré est rejeté", () => {
    const state = createGoogleOAuthState("user_1");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    try {
      expect(verifyGoogleOAuthState(state)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("une entrée qui n'est pas un état est rejetée sans planter", () => {
    expect(verifyGoogleOAuthState(null)).toBeNull();
    expect(verifyGoogleOAuthState("")).toBeNull();
    expect(verifyGoogleOAuthState("a.b.c")).toBeNull();
  });
});

describe("cache des réponses Google", () => {
  beforeEach(() => invalidateCache());

  test("un second appel ne rappelle pas Google", async () => {
    const compute = vi.fn(async () => ({ clics: 12 }));

    const first = await cached("k1", compute);
    const second = await cached("k1", compute);

    expect(compute).toHaveBeenCalledOnce();
    expect(second).toBe(first);
  });

  test("l'entrée expire au bout de sa durée de vie", async () => {
    const compute = vi.fn(async () => Math.random());

    await cached("k2", compute, { ttlMs: 1000, now: 0 });
    await cached("k2", compute, { ttlMs: 1000, now: 999 });
    expect(compute).toHaveBeenCalledOnce();

    await cached("k2", compute, { ttlMs: 1000, now: 1001 });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  test("une erreur n'est pas mise en cache", async () => {
    // Figer un quota dépassé pendant trois heures empêcherait de réessayer
    // une fois le problème passé.
    const compute = vi.fn(async () => {
      throw new Error("429");
    });

    await expect(cached("k3", compute)).rejects.toThrow();
    await expect(cached("k3", compute)).rejects.toThrow();
    expect(compute).toHaveBeenCalledTimes(2);
  });

  test("une déconnexion vide le cache du compte précédent", async () => {
    const compute = vi.fn(async () => "donnees-du-compte-a");

    await cached("k4", compute);
    invalidateCache();
    await cached("k4", compute);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  test("l'invalidation par préfixe ne touche que les clés visées", async () => {
    const a = vi.fn(async () => "a");
    const b = vi.fn(async () => "b");

    await cached("overview|x", a);
    await cached("sites|x", b);
    invalidateCache("overview");
    await cached("overview|x", a);
    await cached("sites|x", b);

    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledOnce();
  });

  test("la clé de cache distingue les plages de dates et les propriétés", () => {
    expect(cacheKey("overview", "c1", "site-a", "2026-01-01", "2026-01-31")).not.toBe(
      cacheKey("overview", "c1", "site-a", "2026-02-01", "2026-02-28")
    );
    expect(cacheKey("overview", "c1", "site-a", "2026-01-01")).not.toBe(
      cacheKey("overview", "c1", "site-b", "2026-01-01")
    );
    // Deux façons d'exprimer « pas de valeur » donnent la même clé.
    expect(cacheKey("x", null)).toBe(cacheKey("x", undefined));
  });
});

describe("readEmailFromIdToken", () => {
  test("lit l'adresse e-mail des revendications", () => {
    const claims = Buffer.from(JSON.stringify({ email: "marie@meribeauty.com" })).toString("base64url");
    expect(readEmailFromIdToken(`entete.${claims}.signature`)).toBe("marie@meribeauty.com");
  });

  test("renvoie null plutôt que de planter sur un jeton absent ou malformé", () => {
    expect(readEmailFromIdToken(null)).toBeNull();
    expect(readEmailFromIdToken("pas-un-jwt")).toBeNull();
    expect(readEmailFromIdToken("a.pas-du-base64-json.c")).toBeNull();
  });
});
