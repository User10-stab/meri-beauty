const fs = require('fs');

const newKeys = {
  appointmentActions: {
    confirm: "Confirmer",
    reject: "Refuser",
    complete: "Terminer",
    cancel: "Annuler le RDV",
    confirmLong: "Confirmer le rendez-vous",
    rejectLong: "Refuser le rendez-vous",
    completeLong: "Terminer le rendez-vous",
    cannotModify: "Ce rendez-vous ne peut plus être modifié.",
    confirming: "Confirmation…",
    rejecting: "Refus en cours…",
    completing: "Finalisation en cours…",
    cancelling: "Annulation en cours…",
    confirmed: "Rendez-vous confirmé.",
    rejected: "Rendez-vous refusé.",
    completed: "Rendez-vous terminé.",
    cancelled: "Rendez-vous annulé.",
    error: "Erreur."
  },
  appointmentDetails: {
    title: "Détails du rendez-vous",
    client: "Client",
    service: "Prestation",
    category: "Catégorie",
    staff: "Prestataire",
    schedule: "Horaire",
    date: "Date",
    time: "Heure",
    duration: "Durée",
    payment: "Paiement",
    totalAmount: "Montant total",
    deposit: "Acompte",
    paid: "Payé",
    remaining: "Restant",
    paymentStatus: "Statut paiement",
    notes: "Notes",
    noNotes: "Aucune note",
    name: "Nom",
    phone: "Téléphone",
    email: "Email"
  },
  appointmentPayment: {
    collectBalance: "Encaisser le solde restant",
    stillDue: "Le client doit encore régler {amount} sur place.",
    invoiceEmitted: "Une facture sera émise pour le montant total dès l'encaissement.",
    paymentMethod: "Mode de paiement",
    cash: "Espèces",
    card: "Carte",
    confirmCollection: "Confirmer l'encaissement",
    cancel: "Annuler"
  },
  appointmentStatus: {
    pending: "En attente",
    confirmed: "Confirmé",
    completed: "Terminé",
    cancelled: "Annulé",
    noShow: "Absence"
  },
  paymentStatus: {
    pending: "En attente",
    paid: "Payé",
    partiallyPaid: "Partiellement payé",
    refunded: "Remboursé"
  },
  appointmentTable: {
    searchPlaceholder: "Rechercher un client…",
    allStatuses: "Tous les statuts",
    allStaff: "Toute l'équipe",
    noResults: "Aucun rendez-vous ne correspond à votre recherche",
    columnHeaders: {
      client: "Client",
      service: "Service",
      staff: "Experte",
      date: "Date",
      payment: "Paiement",
      status: "Statut",
      review: "Avis",
      actions: "Actions"
    },
    reviewSent: "Avis envoyé",
    awaitingReview: "En attente d'avis"
  },
  calendarView: {
    day: "Jour",
    week: "Semaine",
    month: "Mois",
    today: "Aujourd'hui",
    previous: "Précédent",
    next: "Suivant",
    view: "Affichage",
    filterByStaff: "Filtrer par membre de l'équipe",
    allStaff: "Tous les membres",
    noAppointments: "Aucun rendez-vous",
    loading: "Chargement du calendrier…",
    error: "Erreur lors du chargement du calendrier"
  },
  monthView: {
    monday: "Lundi",
    tuesday: "Mardi",
    wednesday: "Mercredi",
    thursday: "Jeudi",
    friday: "Vendredi",
    saturday: "Samedi",
    sunday: "Dimanche"
  },
  reservationForm: {
    step1: "Catégorie",
    step2: "Service",
    step3: "Experte",
    step4: "Rendez-vous",
    step5: "Date & Heure",
    step6: "Informations",
    step7: "Récapitulatif",
    step8: "Paiement",
    prevStep: "Précédent",
    nextStep: "Suivant",
    selectCategory: "Sélectionnez une catégorie",
    selectService: "Sélectionnez un service",
    selectStaff: "Sélectionnez une experte",
    selectDate: "Sélectionnez une date",
    selectTime: "Sélectionnez une heure",
    noStaffAvailable: "Aucune experte disponible pour ce service",
    noSlotsAvailable: "Aucun créneau disponible pour cette date",
    addAnother: "Ajouter un autre rendez-vous",
    continue: "Continuer",
    confirmBooking: "Confirmer la réservation",
    bookingConfirmed: "Votre réservation est confirmée !",
    firstName: "Prénom",
    lastName: "Nom",
    email: "Email",
    phone: "Téléphone",
    notes: "Notes (optionnel)",
    acceptTerms: "J'accepte les conditions d'utilisation",
    totalPrice: "Prix total",
    depositRequired: "Acompte requis",
    selectPaymentMethod: "Sélectionnez un mode de paiement",
    continueAsGuest: "Continuer en tant qu'invité",
    bookNow: "Réserver maintenant",
    yourBooking: "Votre réservation",
    bookingDetails: "Détails de votre réservation",
    removeDraft: "Supprimer",
    draftsList: "Vos rendez-vous"
  }
};

// Read all three catalogs
let fr = JSON.parse(fs.readFileSync('messages/fr.json', 'utf-8'));
let en = JSON.parse(fs.readFileSync('messages/en.json', 'utf-8'));
let nl = JSON.parse(fs.readFileSync('messages/nl.json', 'utf-8'));

// Add keys to FR
Object.assign(fr, newKeys);

// Add English translations
const enKeys = {
  appointmentActions: {
    confirm: "Confirm",
    reject: "Reject",
    complete: "Complete",
    cancel: "Cancel appointment",
    confirmLong: "Confirm appointment",
    rejectLong: "Reject appointment",
    completeLong: "Complete appointment",
    cannotModify: "This appointment cannot be modified.",
    confirming: "Confirming…",
    rejecting: "Rejecting…",
    completing: "Completing…",
    cancelling: "Cancelling…",
    confirmed: "Appointment confirmed.",
    rejected: "Appointment rejected.",
    completed: "Appointment completed.",
    cancelled: "Appointment cancelled.",
    error: "Error."
  },
  appointmentDetails: {
    title: "Appointment details",
    client: "Client",
    service: "Service",
    category: "Category",
    staff: "Provider",
    schedule: "Schedule",
    date: "Date",
    time: "Time",
    duration: "Duration",
    payment: "Payment",
    totalAmount: "Total amount",
    deposit: "Deposit",
    paid: "Paid",
    remaining: "Remaining",
    paymentStatus: "Payment status",
    notes: "Notes",
    noNotes: "No notes",
    name: "Name",
    phone: "Phone",
    email: "Email"
  },
  appointmentPayment: {
    collectBalance: "Collect remaining balance",
    stillDue: "Client still owes {amount} on site.",
    invoiceEmitted: "An invoice will be issued for the total amount upon collection.",
    paymentMethod: "Payment method",
    cash: "Cash",
    card: "Card",
    confirmCollection: "Confirm collection",
    cancel: "Cancel"
  },
  appointmentStatus: {
    pending: "Pending",
    confirmed: "Confirmed",
    completed: "Completed",
    cancelled: "Cancelled",
    noShow: "No-show"
  },
  paymentStatus: {
    pending: "Pending",
    paid: "Paid",
    partiallyPaid: "Partially paid",
    refunded: "Refunded"
  },
  appointmentTable: {
    searchPlaceholder: "Search for a client…",
    allStatuses: "All statuses",
    allStaff: "All staff",
    noResults: "No appointments match your search",
    columnHeaders: {
      client: "Client",
      service: "Service",
      staff: "Provider",
      date: "Date",
      payment: "Payment",
      status: "Status",
      review: "Review",
      actions: "Actions"
    },
    reviewSent: "Review sent",
    awaitingReview: "Awaiting review"
  },
  calendarView: {
    day: "Day",
    week: "Week",
    month: "Month",
    today: "Today",
    previous: "Previous",
    next: "Next",
    view: "View",
    filterByStaff: "Filter by staff member",
    allStaff: "All members",
    noAppointments: "No appointments",
    loading: "Loading calendar…",
    error: "Error loading calendar"
  },
  monthView: {
    monday: "Monday",
    tuesday: "Tuesday",
    wednesday: "Wednesday",
    thursday: "Thursday",
    friday: "Friday",
    saturday: "Saturday",
    sunday: "Sunday"
  },
  reservationForm: {
    step1: "Category",
    step2: "Service",
    step3: "Provider",
    step4: "Appointment",
    step5: "Date & Time",
    step6: "Information",
    step7: "Summary",
    step8: "Payment",
    prevStep: "Previous",
    nextStep: "Next",
    selectCategory: "Select a category",
    selectService: "Select a service",
    selectStaff: "Select a provider",
    selectDate: "Select a date",
    selectTime: "Select a time",
    noStaffAvailable: "No providers available for this service",
    noSlotsAvailable: "No slots available for this date",
    addAnother: "Add another appointment",
    continue: "Continue",
    confirmBooking: "Confirm booking",
    bookingConfirmed: "Your booking is confirmed!",
    firstName: "First name",
    lastName: "Last name",
    email: "Email",
    phone: "Phone",
    notes: "Notes (optional)",
    acceptTerms: "I accept the terms and conditions",
    totalPrice: "Total price",
    depositRequired: "Deposit required",
    selectPaymentMethod: "Select a payment method",
    continueAsGuest: "Continue as guest",
    bookNow: "Book now",
    yourBooking: "Your booking",
    bookingDetails: "Booking details",
    removeDraft: "Remove",
    draftsList: "Your appointments"
  }
};

Object.assign(en, enKeys);

// Add Dutch translations
const nlKeys = {
  appointmentActions: {
    confirm: "Bevestigen",
    reject: "Afwijzen",
    complete: "Voltooien",
    cancel: "Afspraak annuleren",
    confirmLong: "Afspraak bevestigen",
    rejectLong: "Afspraak afwijzen",
    completeLong: "Afspraak voltooien",
    cannotModify: "Deze afspraak kan niet meer worden gewijzigd.",
    confirming: "Bevestiging…",
    rejecting: "Bezig met afwijzen…",
    completing: "Bezig met voltooien…",
    cancelling: "Bezig met annuleren…",
    confirmed: "Afspraak bevestigd.",
    rejected: "Afspraak afgewezen.",
    completed: "Afspraak voltooid.",
    cancelled: "Afspraak geannuleerd.",
    error: "Fout."
  },
  appointmentDetails: {
    title: "Afspraakdetails",
    client: "Klant",
    service: "Service",
    category: "Categorie",
    staff: "Dienstverlener",
    schedule: "Schema",
    date: "Datum",
    time: "Tijd",
    duration: "Duur",
    payment: "Betaling",
    totalAmount: "Totaalbedrag",
    deposit: "Aanbetaling",
    paid: "Betaald",
    remaining: "Resterend",
    paymentStatus: "Betalingsstatus",
    notes: "Notities",
    noNotes: "Geen notities",
    name: "Naam",
    phone: "Telefoon",
    email: "E-mail"
  },
  appointmentPayment: {
    collectBalance: "Resteerbedrag innen",
    stillDue: "Klant betaalt nog {amount} ter plekke.",
    invoiceEmitted: "Na inning wordt een factuur voor het totaalbedrag afgegeven.",
    paymentMethod: "Betalingsmethode",
    cash: "Contant",
    card: "Kaart",
    confirmCollection: "Inning bevestigen",
    cancel: "Annuleren"
  },
  appointmentStatus: {
    pending: "In afwachting",
    confirmed: "Bevestigd",
    completed: "Voltooid",
    cancelled: "Geannuleerd",
    noShow: "Niet verschenen"
  },
  paymentStatus: {
    pending: "In afwachting",
    paid: "Betaald",
    partiallyPaid: "Gedeeltelijk betaald",
    refunded: "Terugbetaald"
  },
  appointmentTable: {
    searchPlaceholder: "Zoeken naar klant…",
    allStatuses: "Alle statussen",
    allStaff: "Alle medewerkers",
    noResults: "Geen afspraken gevonden",
    columnHeaders: {
      client: "Klant",
      service: "Service",
      staff: "Dienstverlener",
      date: "Datum",
      payment: "Betaling",
      status: "Status",
      review: "Beoordeling",
      actions: "Acties"
    },
    reviewSent: "Beoordeling verzonden",
    awaitingReview: "Wacht op beoordeling"
  },
  calendarView: {
    day: "Dag",
    week: "Week",
    month: "Maand",
    today: "Vandaag",
    previous: "Vorige",
    next: "Volgende",
    view: "Weergave",
    filterByStaff: "Filteren op medewerker",
    allStaff: "Alle leden",
    noAppointments: "Geen afspraken",
    loading: "Kalender laden…",
    error: "Fout bij laden van kalender"
  },
  monthView: {
    monday: "Maandag",
    tuesday: "Dinsdag",
    wednesday: "Woensdag",
    thursday: "Donderdag",
    friday: "Vrijdag",
    saturday: "Zaterdag",
    sunday: "Zondag"
  },
  reservationForm: {
    step1: "Categorie",
    step2: "Service",
    step3: "Dienstverlener",
    step4: "Afspraak",
    step5: "Datum & Tijd",
    step6: "Informatie",
    step7: "Samenvatting",
    step8: "Betaling",
    prevStep: "Vorige",
    nextStep: "Volgende",
    selectCategory: "Selecteer een categorie",
    selectService: "Selecteer een service",
    selectStaff: "Selecteer een dienstverlener",
    selectDate: "Selecteer een datum",
    selectTime: "Selecteer een tijd",
    noStaffAvailable: "Geen dienstverleners beschikbaar voor deze service",
    noSlotsAvailable: "Geen beschikbare slots voor deze datum",
    addAnother: "Nog een afspraak toevoegen",
    continue: "Doorgaan",
    confirmBooking: "Boeking bevestigen",
    bookingConfirmed: "Uw boeking is bevestigd!",
    firstName: "Voornaam",
    lastName: "Achternaam",
    email: "E-mail",
    phone: "Telefoon",
    notes: "Notities (optioneel)",
    acceptTerms: "Ik accepteer de voorwaarden",
    totalPrice: "Totaalprijs",
    depositRequired: "Aanbetaling vereist",
    selectPaymentMethod: "Selecteer een betalingsmethode",
    continueAsGuest: "Doorgaan als gast",
    bookNow: "Nu boeken",
    yourBooking: "Uw boeking",
    bookingDetails: "Boekinginformatie",
    removeDraft: "Verwijderen",
    draftsList: "Uw afspraken"
  }
};

Object.assign(en, enKeys);
Object.assign(nl, nlKeys);

// Write all three catalogs
fs.writeFileSync('messages/fr.json', JSON.stringify(fr, null, 4));
fs.writeFileSync('messages/en.json', JSON.stringify(en, null, 4));
fs.writeFileSync('messages/nl.json', JSON.stringify(nl, null, 4));

console.log('✓ All catalogs updated with Task 2 keys');
