# Configuration Mondial Relay API V2

## Generation des identifiants techniques

Dans la console Connect@Mondial Relay, ouvrir la configuration de l'API 2 puis cliquer sur **Generer des identifiants d'API**.

### Erreur `messageAvertissement is not defined`

Le portail Mondial Relay peut afficher cette erreur JavaScript :

```text
Uncaught ReferenceError: messageAvertissement is not defined
    at HTMLAnchorElement.<anonymous> (Configurer.js?3.32.0:4:21)
```

Elle vient du portail Mondial Relay : son script utilise une variable de traduction qui n'a pas ete chargee. Elle ne vient pas de l'application Meri Beauty.

#### Contournement confirme avec Brave

1. Rester sur la page de configuration de l'API 2.
2. Ouvrir les outils de developpement avec `F12` ou `Ctrl + Shift + I`.
3. Selectionner l'onglet **Console**.
4. Si Brave bloque le collage, saisir `allow pasting`, puis valider avec Entree.
5. Executer :

```js
window.messageAvertissement =
  "Confirmer la generation des identifiants techniques API ?";
```

6. Cliquer de nouveau sur **Generer des identifiants d'API**.
7. Confirmer la boite de dialogue affichee par le portail.

Si le probleme persiste, essayer un rechargement force (`Ctrl + F5`), une fenetre privee, la langue francaise du portail et la desactivation temporaire des extensions de traduction ou de blocage.

Ne pas appeler manuellement l'endpoint de generation : le formulaire peut contenir des champs de securite invisibles necessaires a Mondial Relay.

## Variables d'environnement

Apres generation, conserver les valeurs uniquement dans l'environnement de deploiement :

```env
NEXT_PUBLIC_MONDIAL_RELAY_BRAND_ID=
MONDIAL_RELAY_API_LOGIN=
MONDIAL_RELAY_API_PASSWORD=
MONDIAL_RELAY_CUSTOMER_ID=
```

- `NEXT_PUBLIC_MONDIAL_RELAY_BRAND_ID` : identifiant d'enseigne ou de marque utilise par le widget des Points Relais.
- `MONDIAL_RELAY_API_LOGIN` : utilisateur technique API V2.
- `MONDIAL_RELAY_API_PASSWORD` : mot de passe technique API V2.
- `MONDIAL_RELAY_CUSTOMER_ID` : identifiant client demande par l'API d'expedition.

Ne jamais publier le mot de passe technique dans Git, une capture d'ecran, un ticket ou une conversation. Verifier egalement que le fichier `.env` reste ignore par Git.

## En cas de blocage

Contacter l'administrateur Mondial Relay de la societe ou le referent technique Mondial Relay. Fournir le message d'erreur et la version `Configurer.js?3.32.0`, sans joindre les identifiants generes.
