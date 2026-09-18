import { describe, expect, test } from "vitest";
import {
  SEO_ERROR_CODES,
  extractHttpStatus,
  failureFromGoogleError,
  mapGoogleError,
} from "@/lib/seo/errors";

/**
 * L'écran SEO ne montre jamais l'erreur brute de Google. Ce qu'il montre
 * dépend entièrement de cette traduction : un mauvais aiguillage fait
 * afficher « reconnexion nécessaire » pour un simple dépassement de quota,
 * et Marie refait un consentement OAuth pour rien.
 */

/** Erreur telle que Gaxios la lève réellement. */
function gaxiosError(status, message = "Request failed") {
  const error = new Error(message);
  error.response = { status, data: { error: { code: status, message } } };
  error.code = status;
  return error;
}

describe("extractHttpStatus", () => {
  test("lit le statut depuis response.status", () => {
    expect(extractHttpStatus(gaxiosError(403))).toBe(403);
  });

  test("lit un code numérique posé directement sur l'erreur", () => {
    const error = new Error("boom");
    error.code = 429;
    expect(extractHttpStatus(error)).toBe(429);
  });

  test("accepte un statut renvoyé sous forme de chaîne", () => {
    const error = new Error("boom");
    error.code = "401";
    expect(extractHttpStatus(error)).toBe(401);
  });

  test("ne confond pas un code réseau avec un statut HTTP", () => {
    // ENOTFOUND n'est pas un statut : le traiter comme tel ferait retomber
    // une coupure réseau sur une branche de traduction au hasard.
    const error = new Error("getaddrinfo ENOTFOUND");
    error.code = "ENOTFOUND";
    expect(extractHttpStatus(error)).toBeNull();
  });

  test("ne casse pas sur une valeur qui n'est pas une erreur", () => {
    expect(extractHttpStatus(null)).toBeNull();
    expect(extractHttpStatus("erreur")).toBeNull();
  });
});

describe("mapGoogleError", () => {
  test("401 → reconnexion nécessaire", () => {
    const mapped = mapGoogleError(gaxiosError(401));
    expect(mapped.code).toBe(SEO_ERROR_CODES.RECONNEXION_REQUISE);
    expect(mapped.message).toMatch(/reconnexion nécessaire/i);
  });

  test("403 → permission insuffisante", () => {
    const mapped = mapGoogleError(gaxiosError(403));
    expect(mapped.code).toBe(SEO_ERROR_CODES.PERMISSION_INSUFFISANTE);
    expect(mapped.message).toMatch(/permission insuffisante/i);
  });

  test("404 → propriété introuvable", () => {
    const mapped = mapGoogleError(gaxiosError(404));
    expect(mapped.code).toBe(SEO_ERROR_CODES.PROPRIETE_INTROUVABLE);
    expect(mapped.message).toMatch(/introuvable/i);
  });

  test("429 → quota dépassé", () => {
    const mapped = mapGoogleError(gaxiosError(429));
    expect(mapped.code).toBe(SEO_ERROR_CODES.QUOTA_DEPASSE);
    expect(mapped.message).toMatch(/quota/i);
  });

  test("400 → requête invalide", () => {
    expect(mapGoogleError(gaxiosError(400)).code).toBe(SEO_ERROR_CODES.REQUETE_INVALIDE);
  });

  test("une panne Google (5xx) est signalée comme temporaire, pas comme une déconnexion", () => {
    expect(mapGoogleError(gaxiosError(503)).code).toBe(SEO_ERROR_CODES.INDISPONIBLE);
    expect(mapGoogleError(gaxiosError(500)).code).toBe(SEO_ERROR_CODES.INDISPONIBLE);
  });

  test("un accès révoqué (invalid_grant, renvoyé en 400) demande une reconnexion", () => {
    // C'est le piège de ce mappage : Google renvoie 400, pas 401, quand le
    // refresh token a été révoqué. Sans ce cas, l'écran dirait « requête
    // invalide » et personne ne penserait à se reconnecter.
    const error = gaxiosError(400, "invalid_grant: Token has been expired or revoked.");
    expect(mapGoogleError(error).code).toBe(SEO_ERROR_CODES.RECONNEXION_REQUISE);
  });

  test("invalid_grant porté par le corps de la réponse est reconnu aussi", () => {
    const error = new Error("Erreur OAuth");
    error.response = { status: 400, data: { error: "invalid_grant" } };
    expect(mapGoogleError(error).code).toBe(SEO_ERROR_CODES.RECONNEXION_REQUISE);
  });

  test("une erreur de notre propre couche garde son verdict", () => {
    const error = new Error("Jetons illisibles");
    error.seoCode = SEO_ERROR_CODES.RECONNEXION_REQUISE;
    expect(mapGoogleError(error).code).toBe(SEO_ERROR_CODES.RECONNEXION_REQUISE);
  });

  test("une erreur sans statut retombe sur le cas inconnu, jamais sur un silence", () => {
    const mapped = mapGoogleError(new Error("boom"));
    expect(mapped.code).toBe(SEO_ERROR_CODES.INCONNUE);
    expect(mapped.message.length).toBeGreaterThan(0);
  });

  test("chaque code connu a un message français non vide", () => {
    for (const code of Object.values(SEO_ERROR_CODES)) {
      const error = new Error("x");
      error.seoCode = code;
      const mapped = mapGoogleError(error);
      expect(mapped.message).toBeTruthy();
      expect(mapped.message).not.toMatch(/undefined/);
    }
  });
});

describe("failureFromGoogleError", () => {
  test("rend la forme { success, code, message, data } attendue des server actions", () => {
    expect(failureFromGoogleError(gaxiosError(429))).toEqual({
      success: false,
      code: SEO_ERROR_CODES.QUOTA_DEPASSE,
      message: expect.stringMatching(/quota/i),
      data: null,
    });
  });
});
