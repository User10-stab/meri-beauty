import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { OAuth2Client } from "google-auth-library";
import { getAbsoluteUrl } from "@/lib/site-url";

/**
 * OAuth Google pour Search Console.
 *
 * Même principe de `state` signé que lib/stripe-oauth.js : un jeton sans
 * état, signé avec AUTH_SECRET, qui porte son propre contenu et sa propre
 * expiration. Aucune table de sessions OAuth, donc rien à nettoyer.
 *
 *   state     = base64url(JSON{ purpose, userId, nonce, exp }) + "." + signature
 *   signature = HMAC-SHA256(payload, AUTH_SECRET)
 *
 * Le champ `purpose` empêche qu'un jeton émis pour le flux Stripe soit
 * rejoué ici (et inversement). `userId` est revérifié contre la session
 * vivante au retour : la signature prouve que le jeton n'a pas été forgé,
 * pas qu'il est toujours entre les mains de celui qui l'a demandé — or il
 * transite par une URL de redirection qui peut fuir (historique, en-tête
 * referer, écran partagé) pendant ses dix minutes de validité.
 *
 * Les routes vivent sous /api/seo/google/... et surtout PAS sous
 * /api/auth/... : ce dernier est un catch-all NextAuth v5 qui possède tous
 * les chemins en dessous de lui — y ajouter une route la ferait passer
 * avant NextAuth et casserait la connexion de tout le site.
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Marqueur de flux embarqué dans le `state`. */
export const GOOGLE_OAUTH_STATE_PURPOSE = "google-search-console";

/**
 * Le périmètre fonctionnel demandé : lecture seule des données Search
 * Console. Rien dans cette fonctionnalité n'écrit chez Google.
 */
export const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

/**
 * `openid` et `email` s'ajoutent au périmètre de lecture uniquement pour
 * savoir QUEL compte Google a été connecté (affiché sur l'écran SEO, et
 * indispensable pour que Marie voie qu'elle a autorisé le bon compte quand
 * elle en a plusieurs). Ils n'ouvrent aucun accès supplémentaire aux
 * données du site.
 */
export const GOOGLE_OAUTH_SCOPES = ["openid", "email", SEARCH_CONSOLE_SCOPE];

/**
 * Résout le secret de signature des jetons `state`.
 * Réutilise AUTH_SECRET — aucune variable d'environnement supplémentaire.
 * @returns {string}
 */
function getStateSecret() {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET n'est pas configurée.");
  }
  return secret;
}

/**
 * @param {string} payload
 * @returns {string}
 */
function sign(payload) {
  return createHmac("sha256", getStateSecret()).update(payload).digest("base64url");
}

/**
 * Crée un jeton `state` signé, lié à l'utilisateur qui lance le flux.
 *
 * @param {string} userId - L'utilisateur authentifié qui démarre la connexion.
 * @returns {string}
 */
export function createGoogleOAuthState(userId) {
  const payload = Buffer.from(
    JSON.stringify({
      purpose: GOOGLE_OAUTH_STATE_PURPOSE,
      userId,
      nonce: randomBytes(16).toString("hex"),
      exp: Date.now() + STATE_TTL_MS,
    })
  ).toString("base64url");

  return `${payload}.${sign(payload)}`;
}

/**
 * Vérifie et décode un jeton `state` renvoyé par Google.
 *
 * Renvoie le contenu uniquement si la signature est valide, si le flux
 * correspond et si le jeton n'a pas expiré ; null dans tous les autres cas.
 * L'appelant doit encore comparer `userId` à la session vivante.
 *
 * @param {unknown} state - La valeur brute reçue dans le callback.
 * @returns {{ userId: string } | null}
 */
export function verifyGoogleOAuthState(state) {
  if (typeof state !== "string") return null;

  const parts = state.split(".");
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;

  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);

  if (expected.length !== received.length) return null;
  if (!timingSafeEqual(expected, received)) return null;

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!data || typeof data !== "object") return null;
  if (data.purpose !== GOOGLE_OAUTH_STATE_PURPOSE) return null;
  if (typeof data.userId !== "string" || !data.userId) return null;
  if (typeof data.exp !== "number" || data.exp < Date.now()) return null;

  return { userId: data.userId };
}

/**
 * Lit la configuration OAuth depuis l'environnement.
 *
 * Renvoie null (plutôt que de lever une exception) quand elle est
 * incomplète : l'écran SEO doit pouvoir s'afficher et expliquer ce qui
 * manque, pas rendre une page d'erreur.
 *
 * GOOGLE_REDIRECT_URI est optionnelle — sans elle, l'URL est dérivée de
 * l'URL de base de l'application. Elle reste utile parce que Google exige
 * une correspondance au caractère près avec ce qui est déclaré dans la
 * console Cloud.
 *
 * @returns {{ clientId: string, clientSecret: string, redirectUri: string } | null}
 */
export function getGoogleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) return null;

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() || getAbsoluteUrl("/api/seo/google/callback");

  return { clientId, clientSecret, redirectUri };
}

/**
 * @returns {boolean} Si les identifiants Google sont présents.
 */
export function isGoogleOAuthConfigured() {
  return getGoogleOAuthConfig() !== null;
}

/**
 * La propriété Search Console interrogée par défaut, telle que Google
 * l'identifie : soit un préfixe d'URL ("https://meribeautystudio.com/"),
 * soit un domaine ("sc-domain:meribeautystudio.com").
 *
 * @returns {string | null}
 */
export function getConfiguredSiteUrl() {
  return process.env.GOOGLE_SEARCH_CONSOLE_SITE?.trim() || null;
}

/**
 * Construit un client OAuth2 à partir de la configuration.
 *
 * @returns {import("google-auth-library").OAuth2Client}
 */
export function createOAuthClient() {
  const config = getGoogleOAuthConfig();
  if (!config) {
    throw new Error("Les identifiants OAuth Google ne sont pas configurés.");
  }

  return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
}

/**
 * Construit l'URL de consentement Google.
 *
 * `access_type=offline` + `prompt=consent` sont tous les deux nécessaires :
 * Google ne renvoie un refresh token qu'au tout premier consentement d'un
 * couple compte/client. Sans `prompt=consent`, une reconnexion après une
 * révocation renverrait un access token seul et la connexion mourrait au
 * bout d'une heure sans moyen de se renouveler.
 *
 * `include_granted_scopes` est laissé de côté volontairement : on ne veut
 * pas hériter silencieusement de périmètres accordés à ce client ailleurs.
 *
 * @param {{ userId: string }} params
 * @returns {string}
 */
export function buildGoogleConsentUrl({ userId }) {
  const client = createOAuthClient();

  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_OAUTH_SCOPES,
    state: createGoogleOAuthState(userId),
  });
}

/**
 * Extrait l'adresse e-mail du compte connecté depuis l'`id_token`.
 *
 * L'id_token est un JWT signé par Google. Sa signature n'est pas vérifiée
 * ici, et c'est justifié dans ce cas précis : le jeton ne vient pas du
 * navigateur mais d'un échange serveur-à-serveur en TLS avec le point de
 * terminaison de Google, authentifié par notre client_secret. Google
 * documente explicitement qu'un jeton obtenu ainsi peut être décodé sans
 * revalidation. Cette valeur n'est en outre qu'un libellé d'affichage :
 * aucune décision d'autorisation n'en dépend.
 *
 * @param {string | null | undefined} idToken
 * @returns {string | null}
 */
export function readEmailFromIdToken(idToken) {
  if (typeof idToken !== "string" || !idToken) return null;

  const parts = idToken.split(".");
  if (parts.length !== 3) return null;

  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof claims?.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}
