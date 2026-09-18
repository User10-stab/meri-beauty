import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Chiffrement symétrique au repos (AES-256-GCM).
 *
 * Écrit pour les jetons OAuth Google Search Console (voir
 * lib/seo/google-search-console.js), mais volontairement générique : rien
 * ici ne connaît Google. Tout secret que la base ne doit pas stocker en
 * clair peut passer par ici.
 *
 * Pourquoi GCM et pas CBC : le refresh token est une clé d'accès permanente
 * au compte Search Console du salon. Un chiffrement sans authentification
 * (CBC) protégerait la confidentialité mais pas l'intégrité — quelqu'un
 * ayant un accès en écriture à la base pourrait substituer un bloc sans que
 * le déchiffrement échoue. GCM échoue bruyamment dans ce cas.
 *
 * Format du texte chiffré (une seule chaîne, stockable dans une colonne
 * TEXT, sans colonne supplémentaire pour l'IV ou le tag) :
 *
 *   v1.<iv base64url>.<authTag base64url>.<ciphertext base64url>
 *
 * Le préfixe de version est là pour qu'une future rotation d'algorithme
 * puisse déchiffrer l'ancien format au lieu de tout jeter.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // taille recommandée pour GCM
const KEY_BYTES = 32; // AES-256
const ENV_VAR = "GOOGLE_TOKEN_ENCRYPTION_KEY";

/**
 * Lit et décode la clé de chiffrement depuis l'environnement.
 *
 * La valeur est acceptée en base64 ou en hexadécimal — les deux encodages
 * d'usage pour `openssl rand`. Elle doit faire exactement 32 octets une fois
 * décodée : une clé plus courte serait silencieusement complétée par Node,
 * ce qui donnerait un chiffrement plus faible que ce que le nom AES-256
 * laisse croire.
 *
 * @returns {Buffer}
 */
function getKey() {
  const raw = process.env[ENV_VAR];

  if (!raw || !raw.trim()) {
    throw new Error(
      `${ENV_VAR} n'est pas configurée : impossible de chiffrer ou de déchiffrer les jetons.`
    );
  }

  const trimmed = raw.trim();

  // L'hexadécimal est testé en premier : une chaîne de 64 caractères hex est
  // aussi du base64 valide, mais elle se décoderait en 48 octets et serait
  // rejetée plus bas. Ce test évite ce faux négatif déroutant.
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, "hex");
  } else {
    key = Buffer.from(trimmed, "base64");
  }

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${ENV_VAR} doit contenir 32 octets (base64 ou hexadécimal) — ${key.length} octet(s) décodé(s).`
    );
  }

  return key;
}

/**
 * Indique si le chiffrement est utilisable, sans lever d'exception.
 *
 * Sert aux écrans qui doivent se dégrader proprement ("intégration non
 * configurée") plutôt que planter quand l'environnement est incomplet.
 *
 * @returns {boolean}
 */
export function isTokenEncryptionConfigured() {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Chiffre une valeur en clair.
 *
 * @param {string} plaintext - La valeur à protéger (jeton OAuth, etc.).
 * @returns {string} La chaîne chiffrée, prête à être stockée.
 */
export function encryptSecret(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptSecret attend une chaîne non vide.");
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Déchiffre une valeur produite par encryptSecret.
 *
 * Lève une exception si la clé est absente, si le format est invalide, ou
 * si le contenu a été modifié (le tag GCM ne correspond plus). Les appelants
 * traitent cette exception comme « reconnexion nécessaire » : un jeton
 * illisible n'est pas récupérable, seul un nouveau consentement l'est.
 *
 * @param {string} payload - La chaîne renvoyée par encryptSecret.
 * @returns {string} La valeur en clair.
 */
export function decryptSecret(payload) {
  if (typeof payload !== "string" || !payload) {
    throw new Error("decryptSecret attend une chaîne non vide.");
  }

  const parts = payload.split(".");
  if (parts.length !== 4) {
    throw new Error("Format de valeur chiffrée invalide.");
  }

  const [version, ivPart, tagPart, ciphertextPart] = parts;
  if (version !== VERSION) {
    throw new Error(`Version de chiffrement non prise en charge : ${version}`);
  }

  const iv = Buffer.from(ivPart, "base64url");
  const authTag = Buffer.from(tagPart, "base64url");
  const ciphertext = Buffer.from(ciphertextPart, "base64url");

  if (iv.length !== IV_BYTES) {
    throw new Error("Vecteur d'initialisation invalide.");
  }

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
