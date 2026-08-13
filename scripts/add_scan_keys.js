const fs = require('fs');

const frPath = './messages/fr.json';
const enPath = './messages/en.json';
const nlPath = './messages/nl.json';

const fr = JSON.parse(fs.readFileSync(frPath, 'utf-8'));
const en = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
const nl = JSON.parse(fs.readFileSync(nlPath, 'utf-8'));

function setPath(obj, pathArr, value) {
  let curr = obj;
  for (let i = 0; i < pathArr.length - 1; i++) {
    const k = pathArr[i];
    if (!curr[k] || typeof curr[k] !== 'object') curr[k] = {};
    curr = curr[k];
  }
  curr[pathArr[pathArr.length - 1]] = value;
}

const items = [
  {
    path: ['boutique', 'scanSubtitle'],
    fr: "Visez le code-barres sur l'emballage pour voir la fiche produit, le prix et le stock.",
    en: 'Point the camera at the barcode on packaging to see product details, price, and stock.',
    nl: 'Richt de camera op de streepjescode op de verpakking om productdetails, prijs en voorraad te zien.'
  },
  {
    path: ['boutique', 'cameraError'],
    fr: "Impossible d'accéder à la caméra — vérifiez les autorisations de votre navigateur.",
    en: 'Unable to access the camera — check your browser permissions.',
    nl: 'Geen toegang tot de camera — controleer uw browserrechten.'
  },
  {
    path: ['boutique', 'cancel'],
    fr: 'Annuler',
    en: 'Cancel',
    nl: 'Annuleren'
  },
  {
    path: ['boutique', 'backToBoutique'],
    fr: 'Retour à la boutique',
    en: 'Back to shop',
    nl: 'Terug naar de winkel'
  }
];

items.forEach((item) => {
  setPath(fr, item.path, item.fr);
  setPath(en, item.path, item.en);
  setPath(nl, item.path, item.nl);
});

fs.writeFileSync(frPath, JSON.stringify(fr, null, 2) + '\n', 'utf-8');
fs.writeFileSync(enPath, JSON.stringify(en, null, 2) + '\n', 'utf-8');
fs.writeFileSync(nlPath, JSON.stringify(nl, null, 2) + '\n', 'utf-8');

console.log('Added ProductScanClient keys to fr.json, en.json, nl.json');
