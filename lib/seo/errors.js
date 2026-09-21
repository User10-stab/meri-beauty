/**
 * Traduction des erreurs de l'API Google Search Console en messages français.
 *
 * Les erreurs de `googleapis` arrivent sous plusieurs formes selon l'endroit
 * où elles ont été levées (couche HTTP, couche OAuth, erreur réseau brute).
 * Ce module ramène tout cela à deux choses exploitables par l'interface :
 * un code interne stable (`SEO_ERROR_CODES`) et un message destiné à Marie.
 *
 * Le code compte autant que le message : `RECONNEXION_REQUISE` est le seul
 * cas où l'écran doit reproposer le bouton « Connecter », alors que
 * `QUOTA_DEPASSE` est transitoire et ne doit surtout pas laisser croire que
 * la connexion est cassée.
 */

export const SEO_ERROR_CODES = {
  NON_CONFIGURE: "NON_CONFIGURE",
  NON_CONNECTE: "NON_CONNECTE",
  RECONNEXION_REQUISE: "RECONNEXION_REQUISE",
  PERMISSION_INSUFFISANTE: "PERMISSION_INSUFFISANTE",
  PROPRIETE_INTROUVABLE: "PROPRIETE_INTROUVABLE",
  QUOTA_DEPASSE: "QUOTA_DEPASSE",
  REQUETE_INVALIDE: "REQUETE_INVALIDE",
  INDISPONIBLE: "INDISPONIBLE",
  INCONNUE: "INCONNUE",
};

export const SEO_ERROR_MESSAGES = {
  [SEO_ERROR_CODES.NON_CONFIGURE]:
    "L'intégration Google Search Console n'est pas configurée sur ce serveur. "
    + "Les identifiants Google doivent être renseignés dans l'environnement avant de pouvoir connecter un compte.",
  [SEO_ERROR_CODES.NON_CONNECTE]:
    "Aucun compte Google Search Console n'est connecté.",
  [SEO_ERROR_CODES.RECONNEXION_REQUISE]:
    "L'accès Google a expiré ou a été révoqué : reconnexion nécessaire.",
  [SEO_ERROR_CODES.PERMISSION_INSUFFISANTE]:
    "Permission insuffisante : le compte Google connecté n'a pas accès à cette propriété Search Console.",
  [SEO_ERROR_CODES.PROPRIETE_INTROUVABLE]:
    "Propriété introuvable dans Search Console. Vérifiez l'adresse du site configurée.",
  [SEO_ERROR_CODES.QUOTA_DEPASSE]:
    "Quota Google dépassé : trop de requêtes envoyées. Réessayez dans quelques minutes.",
  [SEO_ERROR_CODES.REQUETE_INVALIDE]:
    "Requête refusée par Google : les paramètres envoyés sont invalides.",
  [SEO_ERROR_CODES.INDISPONIBLE]:
    "Google Search Console est momentanément indisponible. Réessayez plus tard.",
  [SEO_ERROR_CODES.INCONNUE]:
    "Une erreur inattendue est survenue lors de l'appel à Google Search Console.",
};

/**
 * Codes après lesquels l'interface doit reproposer la connexion OAuth.
 * Tous les autres laissent la connexion existante en place.
 */
export const RECONNECT_CODES = [SEO_ERROR_CODES.RECONNEXION_REQUISE];

/**
 * Messages du flux OAuth lui-même.
 *
 * Les routes /api/seo/google/* renvoient l'administrateur sur l'écran SEO
 * avec `?erreur=<clé>` plutôt qu'avec un message complet : l'URL reste
 * courte, et rien des détails internes ne se retrouve dans l'historique du
 * navigateur. La traduction se fait ici, à l'affichage.
 */
export const OAUTH_REDIRECT_MESSAGES = {
  refus: "La connexion a été refusée ou interrompue du côté de Google.",
  etat_invalide:
    "Le lien de retour de Google n'est plus valable (il expire après 10 minutes). Relancez la connexion.",
  session_differente:
    "La session a changé pendant la connexion. Reconnectez-vous au tableau de bord, puis relancez la connexion Google.",
  code_absent: "Google n'a renvoyé aucun code d'autorisation. Relancez la connexion.",
  echange_echoue:
    "Impossible d'échanger le code d'autorisation auprès de Google. Vérifiez l'identifiant et le secret du client OAuth, ainsi que l'URI de redirection déclarée.",
  refresh_absent:
    "Google n'a pas fourni de jeton de renouvellement : l'accès aurait expiré au bout d'une heure. "
    + "Retirez l'accès de cette application depuis la page « Applications tierces » de votre compte Google, puis relancez la connexion.",
  config_absente:
    "Les identifiants OAuth Google ne sont pas configurés sur ce serveur (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
  cle_absente:
    "La clé de chiffrement des jetons (GOOGLE_TOKEN_ENCRYPTION_KEY) n'est pas configurée : les jetons ne peuvent pas être stockés en sécurité.",
  inattendue: "Une erreur inattendue est survenue pendant la connexion à Google.",
};

/**
 * Extrait le statut HTTP d'une erreur `googleapis`, quelle que soit sa forme.
 *
 * Trois formes coexistent :
 *   - `err.response.status` — erreur HTTP remontée par Gaxios ;
 *   - `err.code` numérique — forme historique du client Google ;
 *   - `err.code` textuel ("ENOTFOUND", "ETIMEDOUT") — erreur réseau, qui
 *     n'est pas un statut du tout et ne doit pas être confondue avec un.
 *
 * @param {unknown} error
 * @returns {number | null} Le statut HTTP, ou null si l'erreur n'en porte pas.
 */
export function extractHttpStatus(error) {
  if (!error || typeof error !== "object") return null;

  const fromResponse = error.response?.status;
  if (typeof fromResponse === "number") return fromResponse;

  const status = error.status;
  if (typeof status === "number") return status;

  const code = error.code;
  if (typeof code === "number") return code;
  // "401" en chaîne : renvoyé par certaines couches OAuth.
  if (typeof code === "string" && /^\d{3}$/.test(code)) return Number(code);

  return null;
}

/**
 * Traduit une erreur d'appel Search Console en couple code/message français.
 *
 * @param {unknown} error - L'erreur levée par googleapis (ou par nous).
 * @returns {{ code: string, message: string, status: number | null }}
 */
export function mapGoogleError(error) {
  const status = extractHttpStatus(error);

  // Erreur levée par notre propre couche d'accès (jetons illisibles, refresh
  // token absent) : elle porte déjà son verdict, inutile de le redeviner
  // depuis un statut HTTP qu'elle n'a pas.
  if (typeof error?.seoCode === "string" && SEO_ERROR_MESSAGES[error.seoCode]) {
    return buildError(error.seoCode, status);
  }

  // `invalid_grant` est la réponse de Google quand le refresh token a été
  // révoqué (mot de passe changé, accès retiré depuis le compte Google,
  // jeton inutilisé pendant six mois). Elle arrive en 400, pas en 401 —
  // sans ce cas particulier, une révocation s'afficherait comme une
  // « requête invalide » et personne ne penserait à se reconnecter.
  const raw = typeof error?.message === "string" ? error.message : "";
  const oauthError = error?.response?.data?.error;
  if (raw.includes("invalid_grant") || oauthError === "invalid_grant") {
    return buildError(SEO_ERROR_CODES.RECONNEXION_REQUISE, status);
  }

  switch (status) {
    case 400:
      return buildError(SEO_ERROR_CODES.REQUETE_INVALIDE, status);
    case 401:
      return buildError(SEO_ERROR_CODES.RECONNEXION_REQUISE, status);
    case 403:
      return buildError(SEO_ERROR_CODES.PERMISSION_INSUFFISANTE, status);
    case 404:
      return buildError(SEO_ERROR_CODES.PROPRIETE_INTROUVABLE, status);
    case 429:
      return buildError(SEO_ERROR_CODES.QUOTA_DEPASSE, status);
    default:
      break;
  }

  if (typeof status === "number" && status >= 500) {
    return buildError(SEO_ERROR_CODES.INDISPONIBLE, status);
  }

  return buildError(SEO_ERROR_CODES.INCONNUE, status);
}

/**
 * Construit la forme d'erreur renvoyée par les server actions SEO.
 *
 * @param {string} code - Une valeur de SEO_ERROR_CODES.
 * @param {number | null} [status]
 * @returns {{ code: string, message: string, status: number | null }}
 */
export function buildError(code, status = null) {
  return {
    code,
    message: SEO_ERROR_MESSAGES[code] ?? SEO_ERROR_MESSAGES[SEO_ERROR_CODES.INCONNUE],
    status,
  };
}

/**
 * Enveloppe une erreur dans la forme `{ success, message, data }` que
 * renvoient toutes les server actions du projet, en y ajoutant le code
 * interne dont l'interface a besoin pour décider quoi afficher.
 *
 * @param {unknown} error
 * @returns {{ success: false, code: string, message: string, data: null }}
 */
export function failureFromGoogleError(error) {
  const mapped = mapGoogleError(error);
  return { success: false, code: mapped.code, message: mapped.message, data: null };
}

/**
 * Même forme, mais pour nos propres refus (non configuré, non connecté),
 * qui ne viennent pas de Google.
 *
 * @param {string} code - Une valeur de SEO_ERROR_CODES.
 * @returns {{ success: false, code: string, message: string, data: null }}
 */
export function failure(code) {
  const built = buildError(code);
  return { success: false, code: built.code, message: built.message, data: null };
}
