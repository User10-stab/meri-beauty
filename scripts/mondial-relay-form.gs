/**
 * ============================================================================
 *  Mondial Relay — Questionnaire client (Google Form generator)
 * ============================================================================
 *
 *  Usage
 *  -----
 *  1. Go to https://script.google.com  →  New project
 *  2. Paste this whole file in (replace the default Code.gs content)
 *  3. Fill in FALLBACK_EMAIL below (the address the client can send files to)
 *  4. Click Run → choose `createMondialRelayQuestionnaire`
 *  5. Authorize the script when prompted (it only touches Forms)
 *  6. Open View → Logs — the form's EDIT url and LIVE url are printed there
 *
 *  Re-running the function creates a NEW form each time (it does not edit the
 *  previous one). Delete an unwanted form in Google Drive if needed.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// CONFIG  — edit FALLBACK_EMAIL before running
// ---------------------------------------------------------------------------
var CONFIG = {
  TITLE: "Mondial Relay — Informations pour l'intégration",

  DESCRIPTION: [
    "Bonjour,",
    "",
    "Pour finaliser l'intégration de Mondial Relay sur la boutique, j'ai besoin " +
      "de quelques informations de votre côté. Ce formulaire rassemble tout en " +
      "un seul endroit — cela devrait prendre moins de 10 minutes.",
    "",
    "ℹ️ Votre adresse, téléphone, email et numéro de TVA sont déjà renseignés : " +
      "inutile de les redonner ici.",
    "",
    "📎 Pour tout document à transmettre (grille tarifaire, identifiants, etc.), " +
      "vous pouvez soit le coller directement dans le formulaire, soit l'envoyer " +
      "par email à : FALLBACK_EMAIL",
  ].join("\n"),

  // ← put the address the client can email files to
  FALLBACK_EMAIL: "ton-email@exemple.com",

  CONFIRMATION: [
    "Merci ! J'ai bien reçu vos réponses.",
    "",
    "Je reviens vers vous très vite pour la suite. À bientôt 🙂",
  ].join("\n"),
};

// ===========================================================================
//  ENTRY POINT
// ===========================================================================
function createMondialRelayQuestionnaire() {
  var form = FormApp.create(CONFIG.TITLE);

  form
    .setDescription(CONFIG.DESCRIPTION.replace(/FALLBACK_EMAIL/g, CONFIG.FALLBACK_EMAIL))
    .setCollectEmail(true)
    .setProgressBar(true)
    .setConfirmationMessage(CONFIG.CONFIRMATION);

  // -------------------------------------------------------------------------
  // Section 1 — Compte Mondial Relay Connect
  // -------------------------------------------------------------------------
  addPage(
    form,
    "1. Votre compte Mondial Relay Connect",
    "« Connect » (connect.mondialrelay.com) est le portail client actuel de " +
      "Mondial Relay. Il est distinct de ce que vous utilisiez avec Shopify." +
      "\n\nSi vous avez un compte actif, les identifiants API V2.0 se génèrent " +
      "dans : Administration → Configuration des API → « API Version V2.0 »."
  );

  addChoice(
    form,
    "Avez-vous un compte actif sur connect.mondialrelay.com ?",
    ["Oui", "Non", "Je ne suis pas sûre"],
    true
  );

  addChoice(
    form,
    "Avez-vous déjà généré les identifiants API V2.0 ?",
    [
      "Oui, je les ai sous la main",
      "Non, mais je peux le faire",
      "J'aurais besoin d'aide pour cette étape",
    ],
    true
  );

  addText(form, "Login API V2.0", "Le « Login » affiché dans Configuration des API.");
  addText(form, "Password API V2.0", "Le mot de passe associé.");
  addText(form, "Customer ID (identifiant client) API V2.0");

  // -------------------------------------------------------------------------
  // Section 2 — Code Enseigne pour le widget carte des points relais
  // -------------------------------------------------------------------------
  addPage(
    form,
    "2. Code « Enseigne » (widget de paiement)",
    "À ne pas confondre avec les identifiants API ci-dessus : le code Enseigne " +
      "(identifiant de marque) est un code plus léger, nécessaire uniquement " +
      "pour afficher la carte des points relais lors du paiement sur la boutique."
  );

  addChoice(
    form,
    "Avez-vous ce code « Enseigne » ?",
    [
      "Oui, je l'ai",
      "Non, il faudra le demander à Mondial Relay",
      "Je ne sais pas de quoi il s'agit",
    ],
    true
  );

  addText(form, "Code Enseigne (si vous l'avez)");

  // -------------------------------------------------------------------------
  // Section 3 — Mode de remise des colis
  // -------------------------------------------------------------------------
  addPage(
    form,
    "3. Comment remettez-vous vos colis ?",
    "Deux possibilités. Le système peut sélectionner automatiquement le point " +
      "relais le plus proche — inutile d'en désigner un précisément."
  );

  form
    .addMultipleChoiceItem()
    .setTitle("Comment comptez-vous remettre vos colis à Mondial Relay ?")
    .setRequired(true)
    .setChoiceValues([
      "Je les dépose moi-même dans un point relais (mode REL — sans surcoût)",
      "Un coursier vient les récupérer à mon salon (mode CCC — nécessite un " +
        "contrat de collecte, avec un coût supplémentaire)",
    ]);

  // -------------------------------------------------------------------------
  // Section 4 — Grille tarifaire réelle
  // -------------------------------------------------------------------------
  addPage(
    form,
    "4. Grille tarifaire d'expédition",
    "J'ai besoin de vos prix réels (selon le poids et la destination) pour " +
      "remplacer les tarifs provisoires actuellement en place sur la boutique."
  );

  addParagraph(
    form,
    "Indiquez votre grille tarifaire",
    "Collez ici vos tarifs (par tranches de poids / destination). " +
      "Vous pouvez aussi envoyer un PDF, une photo ou un tableau par email à : " +
      CONFIG.FALLBACK_EMAIL,
    true
  );

  // -------------------------------------------------------------------------
  // Section 5 — Homologation des étiquettes + format 10×15
  // -------------------------------------------------------------------------
  addPage(
    form,
    "5. Homologation des étiquettes & format d'impression",
    "Avant la mise en ligne, Mondial Relay exige une homologation des " +
      "étiquettes en deux étapes :\n" +
      "  1) une étiquette de test au format PDF, envoyée par email ;\n" +
      "  2) un échantillon imprimé sur papier, envoyé par courrier.\n\n" +
      "C'est obligatoire — pas optionnel."
  );

  addChoice(
    form,
    "Êtes-vous disposée à passer par cette homologation ?",
    ["Oui", "Non", "J'ai des questions à ce sujet"],
    true
  );

  addChoice(
    form,
    "Souhaitez-vous utiliser le format thermique 10×15 ?",
    ["Oui", "Non", "Je ne suis pas sûre"],
    true,
    "Vous disposez déjà de l'imprimante thermique adaptée. " +
      "Ce format sera demandé à Mondial Relay lors de la même conversation."
  );

  // -------------------------------------------------------------------------
  // Done — print links
  // -------------------------------------------------------------------------
  Logger.log("✅ Formulaire créé !");
  Logger.log("Édition : " + form.getEditUrl());
  Logger.log("En ligne : " + form.getPublishedUrl());
}

// ===========================================================================
//  Helpers
// ===========================================================================
function addPage(form, title, helpText) {
  form.addPageBreakItem().setTitle(title).setHelpText(helpText || "");
}

function addChoice(form, title, values, required, helpText) {
  form
    .addMultipleChoiceItem()
    .setTitle(title)
    .setChoiceValues(values)
    .setHelpText(helpText || "")
    .setRequired(!!required);
}

function addText(form, title, helpText) {
  form.addTextItem().setTitle(title).setHelpText(helpText || "");
}

function addParagraph(form, title, helpText, required) {
  form
    .addParagraphTextItem()
    .setTitle(title)
    .setHelpText(helpText || "")
    .setRequired(!!required);
}
