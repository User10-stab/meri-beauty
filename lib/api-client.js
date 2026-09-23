/**
 * fetchJson — fetch + JSON avec garde-fous lisibles.
 *
 * Sans ça, quand le serveur dev renvoie une page HTML (route API non
 * enregistrée, cache .next corrompu, serveur arrêté), le `.json()` lève
 * "Unexpected token '<', <!DOCTYPE..." — incompréhensible côté dashboard.
 * Ici l'erreur dit quoi faire, en français.
 *
 * @returns {Promise<any>} le JSON décodé (à tester via `json.success`).
 * @throws {Error} message d'action claire.
 */
export async function fetchJson(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw new Error(
      `Serveur injoignable (${err?.message || "réseau"}). Vérifiez que le serveur dev tourne.`
    );
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    if (res.status === 404) {
      throw new Error(
        "Route API introuvable (404 : le serveur a renvoyé une page HTML). " +
          "Redémarrage propre requis : stoppez le serveur, supprimez le dossier .next, relancez."
      );
    }
    throw new Error(`Réponse inattendue du serveur (HTTP ${res.status}).`);
  }

  return res.json();
}
