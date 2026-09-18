import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import {
  decryptSecret,
  encryptSecret,
  isTokenEncryptionConfigured,
} from "@/lib/token-encryption";

/**
 * Le refresh token Google est une clé d'accès permanente au compte Search
 * Console du salon. Ces tests verrouillent les trois propriétés qui font
 * qu'il ne se retrouve pas en clair, et qu'une altération ne passe pas
 * inaperçue.
 */

const KEY_B64 = randomBytes(32).toString("base64");
const KEY_HEX = randomBytes(32).toString("hex");
const OTHER_KEY = randomBytes(32).toString("base64");

let originalKey;

beforeEach(() => {
  originalKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = KEY_B64;
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = originalKey;
});

describe("chiffrement des jetons au repos", () => {
  test("un aller-retour rend exactement la valeur d'origine", () => {
    const token = "1//0gH4x-refresh-token-de-google_avec.des~caracteres";
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  test("le texte chiffré ne contient jamais le jeton en clair", () => {
    const token = "refresh-token-tres-secret";
    const encrypted = encryptSecret(token);

    expect(encrypted).not.toContain(token);
    expect(Buffer.from(encrypted, "utf8").includes(token)).toBe(false);
  });

  test("deux chiffrements de la même valeur donnent deux textes différents", () => {
    // L'IV est aléatoire : sans cela, deux comptes ayant le même jeton
    // seraient reconnaissables à l'identique de leurs colonnes.
    const first = encryptSecret("meme-valeur");
    const second = encryptSecret("meme-valeur");

    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe("meme-valeur");
    expect(decryptSecret(second)).toBe("meme-valeur");
  });

  test("une clé hexadécimale est acceptée au même titre qu'une clé base64", () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = KEY_HEX;
    expect(decryptSecret(encryptSecret("jeton"))).toBe("jeton");
  });

  test("un texte chiffré modifié est refusé, pas déchiffré de travers", () => {
    const encrypted = encryptSecret("jeton-integre");
    const parts = encrypted.split(".");

    // On retourne un bit du dernier octet du cryptogramme.
    const ciphertext = Buffer.from(parts[3], "base64url");
    ciphertext[ciphertext.length - 1] ^= 0x01;
    const tampered = [parts[0], parts[1], parts[2], ciphertext.toString("base64url")].join(".");

    expect(() => decryptSecret(tampered)).toThrow();
  });

  test("un tag d'authentification modifié est refusé", () => {
    const parts = encryptSecret("jeton-integre").split(".");
    const tag = Buffer.from(parts[2], "base64url");
    tag[0] ^= 0xff;

    expect(() => decryptSecret([parts[0], parts[1], tag.toString("base64url"), parts[3]].join("."))).toThrow();
  });

  test("une autre clé ne déchiffre pas", () => {
    const encrypted = encryptSecret("jeton");
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = OTHER_KEY;

    expect(() => decryptSecret(encrypted)).toThrow();
  });

  test("une clé de mauvaise taille est rejetée au lieu d'être complétée en silence", () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.from("trop-courte").toString("base64");

    expect(() => encryptSecret("jeton")).toThrow(/32 octets/);
    expect(isTokenEncryptionConfigured()).toBe(false);
  });

  test("sans clé configurée, rien ne chiffre et isTokenEncryptionConfigured le dit", () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

    expect(isTokenEncryptionConfigured()).toBe(false);
    expect(() => encryptSecret("jeton")).toThrow(/GOOGLE_TOKEN_ENCRYPTION_KEY/);
  });

  test("une chaîne mal formée est refusée sans planter autrement", () => {
    expect(() => decryptSecret("pas-un-texte-chiffre")).toThrow(/Format/);
    expect(() => decryptSecret("v2.a.b.c")).toThrow(/Version/);
    expect(() => decryptSecret("")).toThrow();
  });

  test("une valeur vide ne peut pas être chiffrée", () => {
    // Un appelant qui chiffrerait une chaîne vide stockerait un « jeton »
    // parfaitement valide en base qui ne donne accès à rien.
    expect(() => encryptSecret("")).toThrow();
    expect(() => encryptSecret(null)).toThrow();
  });
});
