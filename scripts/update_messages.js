const fs = require('fs');

const frPath = './messages/fr.json';
const enPath = './messages/en.json';
const nlPath = './messages/nl.json';

const fr = JSON.parse(fs.readFileSync(frPath, 'utf-8'));
const en = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
const nl = JSON.parse(fs.readFileSync(nlPath, 'utf-8'));

// 1. Fix fr.dashboardBoutique nesting
if (fr.dashboardBoutique && fr.dashboardBoutique.productEditor) {
  const pe = fr.dashboardBoutique.productEditor;
  const keysToMove = [
    'productImages',
    'barcodeLabelDialog',
    'productScanDialog',
    'pickupScannerDialog',
    'pickupConfirmDialog',
    'importWix',
    'orderDetail'
  ];
  keysToMove.forEach((k) => {
    if (pe[k]) {
      fr.dashboardBoutique[k] = pe[k];
      delete pe[k];
    }
  });
}

// Helper to safely set nested value
function setPath(obj, pathArr, value) {
  let curr = obj;
  for (let i = 0; i < pathArr.length - 1; i++) {
    const k = pathArr[i];
    if (!curr[k] || typeof curr[k] !== 'object') curr[k] = {};
    curr = curr[k];
  }
  curr[pathArr[pathArr.length - 1]] = value;
}

// 2. Add new keys to fr, en, nl
const newTranslations = [
  // ProductEditor
  {
    path: ['dashboardBoutique', 'productEditor', 'variants', 'fields', 'barcodeHint'],
    fr: 'Code fournisseur (EAN/UPC) ou un code interne généré',
    en: 'Supplier code (EAN/UPC) or a generated internal code',
    nl: 'Leveranciercode (EAN/UPC) of een gegenereerde interne code'
  },
  {
    path: ['dashboardBoutique', 'productEditor', 'variants', 'fields', 'weightHint'],
    fr: 'Optionnel — utilisé pour calculer les frais de port',
    en: 'Optional — used to calculate shipping costs',
    nl: 'Optioneel — gebruikt om verzendkosten te berekenen'
  },
  {
    path: ['dashboardBoutique', 'productEditor', 'variants', 'fields', 'weightPlaceholder'],
    fr: 'ex. 250',
    en: 'e.g. 250',
    nl: 'bijv. 250'
  },
  {
    path: ['dashboardBoutique', 'productEditor', 'variants', 'marginLabel'],
    fr: 'Marge',
    en: 'Margin',
    nl: 'Marge'
  },
  {
    path: ['dashboardBoutique', 'productEditor', 'newMetadataTitle'],
    fr: 'Nouveau produit — Boutique — Dashboard',
    en: 'New product — Boutique — Dashboard',
    nl: 'Nieuw product — Boutique — Dashboard'
  },
  {
    path: ['dashboardBoutique', 'productEditor', 'editMetadataTitle'],
    fr: 'Modifier le produit — Boutique — Dashboard',
    en: 'Edit product — Boutique — Dashboard',
    nl: 'Product bewerken — Boutique — Dashboard'
  },
  // Categories Page
  {
    path: ['dashboardBoutique', 'categories', 'inactive'],
    fr: 'Inactive',
    en: 'Inactive',
    nl: 'Inactief'
  },
  {
    path: ['dashboardBoutique', 'categories', 'statusDraft'],
    fr: 'Brouillon',
    en: 'Draft',
    nl: 'Concept'
  },
  {
    path: ['dashboardBoutique', 'categories', 'statusArchived'],
    fr: 'Archivé',
    en: 'Archived',
    nl: 'Gearchiveerd'
  },
  {
    path: ['dashboardBoutique', 'categories', 'stockLabel'],
    fr: '· stock {count}',
    en: '· stock {count}',
    nl: '· voorraad {count}'
  },
  {
    path: ['dashboardBoutique', 'categories', 'edit'],
    fr: 'Modifier',
    en: 'Edit',
    nl: 'Bewerken'
  },
  // Import Wix Metadata
  {
    path: ['dashboardBoutique', 'importWix', 'metadataTitle'],
    fr: 'Importer depuis Wix — Boutique — Dashboard',
    en: 'Import from Wix — Boutique — Dashboard',
    nl: 'Importeren van Wix — Boutique — Dashboard'
  },
  // Loading states
  {
    path: ['dashboardBoutique', 'loading', 'newProduct'],
    fr: 'Préparation du nouveau produit…',
    en: 'Preparing new product…',
    nl: 'Nieuw product voorbereiden…'
  },
  {
    path: ['dashboardBoutique', 'loading', 'editProduct'],
    fr: 'Ouverture de la fiche produit…',
    en: 'Opening product page…',
    nl: 'Productpagina openen…'
  },
  // Public Boutique Storefront
  {
    path: ['boutique', 'subtitle'],
    fr: 'Une sélection de soins et produits professionnels, à retirer en boutique ou à faire livrer chez vous.',
    en: 'A selection of professional treatments and products, available for store pickup or home delivery.',
    nl: 'Een selectie van professionele verzorgingsproducten, op te halen in de winkel of thuisbezorgd.'
  },
  {
    path: ['boutique', 'searchPlaceholder'],
    fr: 'Rechercher un produit…',
    en: 'Search for a product…',
    nl: 'Zoek een product…'
  },
  {
    path: ['boutique', 'filters'],
    fr: 'Filtres',
    en: 'Filters',
    nl: 'Filters'
  },
  {
    path: ['boutique', 'resetFilters'],
    fr: 'Réinitialiser les filtres',
    en: 'Reset filters',
    nl: 'Filters resetten'
  },
  {
    path: ['boutique', 'sortNewest'],
    fr: 'Nouveautés',
    en: 'Newest',
    nl: 'Nieuwste'
  },
  {
    path: ['boutique', 'sortPriceAsc'],
    fr: 'Prix croissant',
    en: 'Price: Low to High',
    nl: 'Prijs: laag naar hoog'
  },
  {
    path: ['boutique', 'sortPriceDesc'],
    fr: 'Prix décroissant',
    en: 'Price: High to Low',
    nl: 'Prijs: hoog naar laag'
  },
  {
    path: ['boutique', 'sortName'],
    fr: 'Nom (A–Z)',
    en: 'Name (A–Z)',
    nl: 'Naam (A–Z)'
  },
  {
    path: ['boutique', 'otherCategory'],
    fr: 'Autre',
    en: 'Other',
    nl: 'Overige'
  },
  {
    path: ['boutique', 'soldOut'],
    fr: 'Épuisé',
    en: 'Sold out',
    nl: 'Uitverkocht'
  },
  {
    path: ['boutique', 'addedToCart'],
    fr: 'Ajouté au panier.',
    en: 'Added to cart.',
    nl: 'Toegevoegd aan winkelmandje.'
  },
  {
    path: ['boutique', 'variant'],
    fr: 'Déclinaison',
    en: 'Variant',
    nl: 'Variant'
  },
  {
    path: ['boutique', 'remainingInStock'],
    fr: 'Il ne reste que {count} en stock',
    en: 'Only {count} left in stock',
    nl: 'Nog slechts {count} op voorraad'
  },
  {
    path: ['boutique', 'outOfStock'],
    fr: 'Rupture de stock',
    en: 'Out of stock',
    nl: 'Niet op voorraad'
  },
  {
    path: ['boutique', 'decreaseQuantity'],
    fr: 'Diminuer la quantité',
    en: 'Decrease quantity',
    nl: 'Aantal verminderen'
  },
  {
    path: ['boutique', 'increaseQuantity'],
    fr: 'Augmenter la quantité',
    en: 'Increase quantity',
    nl: 'Aantal verhogen'
  },
  {
    path: ['boutique', 'adding'],
    fr: 'Ajout…',
    en: 'Adding…',
    nl: 'Toevoegen…'
  },
  {
    path: ['boutique', 'scanProduct'],
    fr: 'Scanner un produit',
    en: 'Scan a product',
    nl: 'Scan een product'
  },
  {
    path: ['boutique', 'cartTitle'],
    fr: 'Mon panier',
    en: 'My Cart',
    nl: 'Mijn winkelmandje'
  },
  {
    path: ['boutique', 'cartEmptyTitle'],
    fr: 'Votre panier est vide',
    en: 'Your cart is empty',
    nl: 'Uw winkelmandje is leeg'
  },
  {
    path: ['boutique', 'cartEmptySubtitle'],
    fr: 'Parcourez notre boutique et ajoutez vos produits préférés pour commencer.',
    en: 'Browse our shop and add your favorite products to get started.',
    nl: 'Bekijk onze winkel en voeg uw favoriete producten toe.'
  },
  {
    path: ['boutique', 'viewShop'],
    fr: 'Voir la boutique',
    en: 'View shop',
    nl: 'Winkel bekijken'
  },
  {
    path: ['boutique', 'removeFromCart'],
    fr: 'Retirer du panier',
    en: 'Remove from cart',
    nl: 'Verwijderen uit winkelmandje'
  },
  {
    path: ['boutique', 'summary'],
    fr: 'Récapitulatif',
    en: 'Summary',
    nl: 'Overzicht'
  },
  {
    path: ['boutique', 'beforePromo'],
    fr: 'Avant promotion (TTC)',
    en: 'Before promo (incl. VAT)',
    nl: 'Vóór korting (incl. btw)'
  },
  {
    path: ['boutique', 'subtotalExclVat'],
    fr: 'Sous-total (hors TVA)',
    en: 'Subtotal (excl. VAT)',
    nl: 'Subtotaal (excl. btw)'
  },
  {
    path: ['boutique', 'vat'],
    fr: 'TVA ({rate}%)',
    en: 'VAT ({rate}%)',
    nl: 'Btw ({rate}%)'
  },
  {
    path: ['boutique', 'promoDiscount'],
    fr: 'Économie promotion',
    en: 'Promo discount',
    nl: 'Korting'
  },
  {
    path: ['boutique', 'totalInclVat'],
    fr: 'Total TTC',
    en: 'Total (incl. VAT)',
    nl: 'Totaal incl. btw'
  },
  {
    path: ['boutique', 'shippingNotice'],
    fr: "Frais de livraison calculés à l'étape suivante.",
    en: 'Shipping costs calculated at next step.',
    nl: 'Verzendkosten worden berekend in de volgende stap.'
  },
  {
    path: ['boutique', 'returns', 'title'],
    fr: 'Retourner un article',
    en: 'Return an item',
    nl: 'Een artikel retourneren'
  },
  {
    path: ['boutique', 'returns', 'subtitle'],
    fr: 'Conformément au droit de rétractation, vous disposez de 14 jours après réception pour retourner un article.',
    en: 'In accordance with the right of withdrawal, you have 14 days after receipt to return an item.',
    nl: 'Overeenkomstig het herroepingsrecht heeft u 14 dagen na ontvangst om een artikel te retourneren.'
  },
  {
    path: ['boutique', 'returns', 'lookupTitle'],
    fr: 'Retrouver ma commande',
    en: 'Find my order',
    nl: 'Mijn bestelling zoeken'
  },
  {
    path: ['boutique', 'returns', 'orderNumberPlaceholder'],
    fr: 'Numéro de commande (ex : 42)',
    en: 'Order number (e.g., 42)',
    nl: 'Bestelnummer (bijv. 42)'
  },
  {
    path: ['boutique', 'returns', 'emailPlaceholder'],
    fr: 'Email utilisé lors de la commande',
    en: 'Email used for the order',
    nl: 'E-mailadres gebruikt bij de bestelling'
  },
  {
    path: ['boutique', 'returns', 'selectItemsError'],
    fr: 'Sélectionnez au moins un article à retourner.',
    en: 'Select at least one item to return.',
    nl: 'Selecteer ten minste één artikel om te retourneren.'
  },
  {
    path: ['boutique', 'returns', 'reasonError'],
    fr: "Merci d'indiquer le motif du retour.",
    en: 'Please indicate the reason for the return.',
    nl: 'Geef alstublieft de reden voor het retourneren op.'
  },
  {
    path: ['boutique', 'returns', 'requestSentTitle'],
    fr: 'Demande envoyée',
    en: 'Request sent',
    nl: 'Aanvraag verzonden'
  },
  {
    path: ['boutique', 'returns', 'requestSentMessage'],
    fr: 'Votre demande de retour pour la commande n°{orderNumber} a bien été transmise. Vous recevrez un e-mail de confirmation, puis une réponse de notre équipe sous peu.',
    en: 'Your return request for order #{orderNumber} has been transmitted. You will receive a confirmation email and a response from our team shortly.',
    nl: 'Uw retouraanvraag voor bestelling nr. {orderNumber} is succesvol verzonden. U ontvangt binnenkort een bevestigingsmail en een reactie van ons team.'
  },
  {
    path: ['boutique', 'returns', 'reasonLabel'],
    fr: 'Motif du retour',
    en: 'Reason for return',
    nl: 'Reden van retour'
  },
  {
    path: ['boutique', 'returns', 'reasonPlaceholder'],
    fr: 'Expliquez brièvement pourquoi vous souhaitez retourner ce(s) article(s)',
    en: 'Briefly explain why you wish to return these item(s)',
    nl: 'Leg kort uit waarom u dit/deze artikel(en) wilt retourneren'
  }
];

newTranslations.forEach((item) => {
  setPath(fr, item.path, item.fr);
  setPath(en, item.path, item.en);
  setPath(nl, item.path, item.nl);
});

fs.writeFileSync(frPath, JSON.stringify(fr, null, 2) + '\n', 'utf-8');
fs.writeFileSync(enPath, JSON.stringify(en, null, 2) + '\n', 'utf-8');
fs.writeFileSync(nlPath, JSON.stringify(nl, null, 2) + '\n', 'utf-8');

console.log('Successfully updated messages catalog files fr.json, en.json, nl.json');
