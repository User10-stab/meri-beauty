"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Camera, CameraOff, CreditCard, Loader2, Minus, Plus, ScanLine, Trash2, UserRound, X } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import QRCode from "qrcode";
import { toast } from "sonner";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  completePointOfSaleSale,
  cancelPointOfSaleCheckout,
  getPointOfSaleProductByBarcode,
  getPointOfSaleOrderStatus,
  recoverPointOfSaleCheckout,
  searchPointOfSaleCustomers,
} from "@/actions/boutique/point-of-sale";

const emptyAddress = {
  addressLine1: "",
  addressLine2: "",
  addressCity: "",
  addressPostalCode: "",
  addressCountry: "BE",
};

const emptyCustomer = {
  id: null,
  fullName: "",
  email: "",
  phone: "",
  ...emptyAddress,
};

export function PointOfSaleClient() {
  const router = useRouter();
  const [barcode, setBarcode] = useState("");
  const [cart, setCart] = useState([]);
  const [serviceDescription, setServiceDescription] = useState("");
  const [servicePrice, setServicePrice] = useState("");
  // No account, no invoice — a simplified ticket is issued instead. Blocked
  // together with CARD_QR (Stripe checkout needs a real customer_email) —
  // enforced again server-side, this is just the matching UI gate.
  const [isWalkIn, setIsWalkIn] = useState(false);
  const [customer, setCustomer] = useState(emptyCustomer);
  // Whether the *resolved* customer already has a billing address stored.
  // Tracked separately from the form fields on purpose: deriving it from
  // customer.addressLine1 made the address form unmount on the first
  // keystroke typed into it, so city/postal code could never be filled and
  // the server rejected every new-customer sale with POS_ADDRESS_REQUIRED.
  const [addressOnFile, setAddressOnFile] = useState(false);
  const [matches, setMatches] = useState([]);
  const [method, setMethod] = useState("CARD_QR");
  const [attemptKey, setAttemptKey] = useState(null);
  const [terminalConfirmOpen, setTerminalConfirmOpen] = useState(false);
  const [terminalApproved, setTerminalApproved] = useState(false);
  const [terminalReference, setTerminalReference] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [qrModal, setQrModal] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [isCancellingQr, setIsCancellingQr] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef(null);
  const scannerControlsRef = useRef(null);
  const scannerBusyRef = useRef(false);
  const [isPending, startTransition] = useTransition();

  const total = useMemo(() => cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0), [cart]);
  const cashReceivedNumber = Number(cashReceived);
  const changeDue = cashReceived !== "" && !Number.isNaN(cashReceivedNumber) ? cashReceivedNumber - total : null;

  function resetAttempt() {
    const next = crypto.randomUUID();
    localStorage.setItem("meri-pos-attempt-key", next);
    setAttemptKey(next);
    return next;
  }

  useEffect(() => {
    const stored = localStorage.getItem("meri-pos-attempt-key") || crypto.randomUUID();
    localStorage.setItem("meri-pos-attempt-key", stored);
    setAttemptKey(stored);
    recoverPointOfSaleCheckout(stored).then((result) => {
      if (result.success && result.data?.completed) {
        localStorage.removeItem("meri-pos-attempt-key");
        router.push(`/dashboard/boutique/orders/${result.data.orderId}`);
      } else if (result.success && result.data?.checkoutUrl) {
        setQrModal(result.data);
      } else if (result.terminal || result.notFound) {
        resetAttempt();
      }
    }).catch(() => {});
  }, [router]);

  useEffect(() => {
    if (!qrModal?.checkoutUrl) {
      setQrDataUrl("");
      return;
    }
    let active = true;
    QRCode.toDataURL(qrModal.checkoutUrl, { width: 320, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => active && setQrDataUrl(url))
      .catch(() => active && toast.error("Impossible de générer le QR de paiement."));
    return () => { active = false; };
  }, [qrModal?.checkoutUrl]);

  useEffect(() => {
    if (!qrModal?.orderId) return undefined;
    let active = true;
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const result = await getPointOfSaleOrderStatus(qrModal.orderId);
        if (!active || !result.success) return;
        if (result.status === "COMPLETED") {
          localStorage.removeItem("meri-pos-attempt-key");
          setQrModal(null);
          toast.success("Paiement Stripe confirmé.");
          router.push(`/dashboard/boutique/orders/${qrModal.orderId}`);
        } else if (["CANCELLED", "EXPIRED"].includes(result.status)) {
          setQrModal(null);
          resetAttempt();
          toast.error("Le paiement a été annulé ou a expiré.");
        }
      } finally {
        busy = false;
      }
    };
    poll();
    const interval = setInterval(poll, 2500);
    return () => { active = false; clearInterval(interval); };
  }, [qrModal?.orderId, router]);

  useEffect(() => {
    const query = customer.email || customer.fullName;
    if (customer.id || query.trim().length < 2) {
      setMatches([]);
      return undefined;
    }
    const timeout = setTimeout(async () => {
      const result = await searchPointOfSaleCustomers(query);
      if (result.success) setMatches(result.data);
    }, 250);
    return () => clearTimeout(timeout);
  }, [customer.email, customer.fullName, customer.id]);

  const addBarcode = useCallback(async (scannedCode = barcode) => {
    const code = scannedCode?.trim();
    if (!code) return;
    const result = await getPointOfSaleProductByBarcode(code);
    if (!result.success) {
      toast.error(result.message);
      return;
    }
    const item = result.data;
    if (item.availableQuantity <= 0) {
      toast.error("Ce produit est en rupture de stock.");
      return;
    }
    setCart((current) => {
      const present = current.find((entry) => entry.variantId === item.variantId);
      if (!present) return [...current, { ...item, key: item.variantId, type: "PRODUCT", quantity: 1 }];
      if (present.quantity >= item.availableQuantity) {
        toast.error("La quantité demandée dépasse le stock disponible.");
        return current;
      }
      return current.map((entry) => (entry.variantId === item.variantId ? { ...entry, quantity: entry.quantity + 1 } : entry));
    });
    setBarcode("");
  }, [barcode]);

  function addServiceLine() {
    const description = serviceDescription.trim();
    const price = Number(servicePrice);
    if (!description) return toast.error("Indiquez la description de la prestation.");
    if (!Number.isFinite(price) || price <= 0) return toast.error("Indiquez un prix valide.");
    setCart((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        type: "SERVICE",
        variantId: null,
        productName: description,
        variantName: "Prestation",
        unitPrice: Math.round(price * 100) / 100,
        availableQuantity: Infinity,
        quantity: 1,
      },
    ]);
    setServiceDescription("");
    setServicePrice("");
  }

  useEffect(() => {
    if (!scannerOpen) return undefined;

    let cancelled = false;
    const reader = new BrowserMultiFormatReader();
    scannerBusyRef.current = false;
    setScannerError(null);
    setCameraReady(false);

    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        videoRef.current,
        async (scanResult, _error, controls) => {
          scannerControlsRef.current = controls;
          if (cancelled || !scanResult || scannerBusyRef.current) return;
          scannerBusyRef.current = true;
          controls.stop();
          setScannerOpen(false);
          await addBarcode(scanResult.getText());
        }
      )
      .catch((error) => {
        if (cancelled) return;
        console.error("[PointOfSaleClient] camera scanner failed", error);
        setScannerError("Impossible d'accéder à la caméra. Vérifiez l'autorisation du navigateur ou utilisez le lecteur USB.");
      });

    return () => {
      cancelled = true;
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
    };
  }, [scannerOpen, addBarcode]);

  function changeQuantity(key, delta) {
    setCart((current) =>
      current
        .map((item) => item.key === key ? { ...item, quantity: item.quantity + delta } : item)
        .filter((item) => item.quantity > 0)
    );
  }

  function selectCustomer(match) {
    setCustomer({
      id: match.id,
      fullName: match.fullName,
      email: match.email,
      phone: match.phone ?? "",
      addressLine1: match.addressLine1 ?? "",
      addressLine2: match.addressLine2 ?? "",
      addressCity: match.addressCity ?? "",
      addressPostalCode: match.addressPostalCode ?? "",
      addressCountry: match.addressCountry ?? "BE",
    });
    setAddressOnFile(Boolean(match.addressLine1));
    setMatches([]);
  }

  function updateCustomer(field, value) {
    // Editing an identity field detaches from the matched customer. Their
    // stored address belongs to them, not to whoever is being typed now, so
    // drop it and ask again — otherwise person B gets invoiced at person A's
    // address, and the form never reappears because it still looks filled.
    const wasMatched = Boolean(customer.id);
    if (wasMatched) setAddressOnFile(false);
    setCustomer((current) => ({
      ...current,
      ...(wasMatched ? emptyAddress : null),
      id: null,
      [field]: value,
    }));
  }

  // Address edits don't detach from an already-matched customer — filling in
  // a missing address for someone already selected is a continuation of that
  // match, not a new person.
  function updateCustomerAddress(field, value) {
    setCustomer((current) => ({ ...current, [field]: value }));
  }

  // A returning customer with an address already on file shouldn't have to
  // re-enter it at every counter sale — only ask when it's genuinely
  // missing (new customer, or an existing one with none saved yet). Mirrors
  // the server's own rule, which also tests the stored record rather than
  // the submitted payload.
  const needsAddress = !addressOnFile;

  function selectMethod(next) {
    if (next === "CARD_QR" && isWalkIn) return; // blocked while client de passage is active
    setMethod(next);
    if (next !== "EXTERNAL_TERMINAL") {
      setTerminalApproved(false);
      setTerminalReference("");
    }
    if (next !== "CASH") setCashReceived("");
  }

  function toggleWalkIn(next) {
    setIsWalkIn(next);
    if (next && method === "CARD_QR") setMethod("CASH");
  }

  function submitSale() {
    if (!cart.length) return toast.error("Ajoutez au moins un produit ou une prestation.");
    if (!attemptKey) return toast.error("Initialisation de la caisse en cours. Réessayez dans un instant.");
    if (method === "EXTERNAL_TERMINAL" && !terminalConfirmOpen) {
      setTerminalConfirmOpen(true);
      return;
    }
    if (method === "CASH" && (cashReceived === "" || Number.isNaN(cashReceivedNumber) || cashReceivedNumber < total)) {
      return toast.error("Le montant reçu doit couvrir le total de la vente.");
    }
    startTransition(async () => {
      const result = await completePointOfSaleSale({
        customer: isWalkIn ? null : customer,
        items: cart.map((item) =>
          item.type === "SERVICE"
            ? { type: "SERVICE", description: item.productName, unitPrice: item.unitPrice, quantity: item.quantity }
            : { type: "PRODUCT", variantId: item.variantId, quantity: item.quantity }
        ),
        method,
        attemptKey,
        ...(method === "EXTERNAL_TERMINAL" ? { terminalApproved, terminalReference: terminalReference.trim() } : {}),
        ...(method === "CASH" ? { cashReceived: cashReceivedNumber } : {}),
      });
      setTerminalConfirmOpen(false);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      if (method === "CARD_QR") {
        if (!result.data.completed) {
          setQrModal({ ...result.data, totalAmount: total });
          return;
        }
        localStorage.removeItem("meri-pos-attempt-key");
        toast.success("Paiement Stripe confirmé.");
        router.push(`/dashboard/boutique/orders/${result.data.orderId}`);
        return;
      }
      localStorage.removeItem("meri-pos-attempt-key");
      if (result.data.alreadyProcessed) {
        toast.success(`La vente n°${result.data.orderNumber} était déjà enregistrée.`);
        router.push(`/dashboard/boutique/orders/${result.data.orderId}`);
        return;
      }
      if (result.data.walkIn) {
        if (result.data.ticketPdfBase64) {
          const bytes = Uint8Array.from(atob(result.data.ticketPdfBase64), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
          window.open(url, "_blank");
          toast.success(`Vente n°${result.data.orderNumber} enregistrée. Ticket prêt à imprimer.`);
        } else {
          toast.error(`Vente n°${result.data.orderNumber} enregistrée, mais le ticket n'a pas pu être généré.`);
        }
        router.push(`/dashboard/boutique/orders/${result.data.orderId}`);
        return;
      }
      if (result.data.receiptEmailSent) {
        toast.success(`Vente n°${result.data.orderNumber} enregistrée. Le reçu a été envoyé par e-mail.`);
      } else {
        toast.error(`Vente n°${result.data.orderNumber} enregistrée, mais l'e-mail n'a pas pu être envoyé. Vérifiez la configuration e-mail.`);
      }
      router.push(`/dashboard/boutique/orders/${result.data.orderId}`);
    });
  }

  async function cancelQrPayment() {
    if (!qrModal?.orderId || isCancellingQr) return;
    setIsCancellingQr(true);
    try {
      const result = await cancelPointOfSaleCheckout(qrModal.orderId);
      if (result.paid) {
        toast.success("Le paiement venait d'être confirmé.");
        localStorage.removeItem("meri-pos-attempt-key");
        router.push(`/dashboard/boutique/orders/${qrModal.orderId}`);
        return;
      }
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      setQrModal(null);
      resetAttempt();
      toast.success(result.message);
    } finally {
      setIsCancellingQr(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <section className="space-y-5 rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#c8a46a]">Caisse</p>
          <h1 className="mt-1 text-2xl font-bold text-dark dark:text-white">Vente en magasin</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-dark-6">Scannez les articles, associez le client, encaissez puis envoyez son reçu.</p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            addBarcode();
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <ScanLine size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              placeholder="Lecteur USB : QR ou code-barres"
              autoComplete="off"
              className="h-11 w-full rounded-lg border border-gray-200 pl-10 pr-3 text-sm outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>
          <Button type="submit">Ajouter</Button>
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="flex h-11 items-center justify-center gap-2 rounded-lg border border-[#2f3a2e] px-4 text-sm font-semibold text-[#2f3a2e] transition-colors hover:bg-[#2f3a2e]/5"
          >
            <Camera size={16} />
            Caméra
          </button>
        </form>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            addServiceLine();
          }}
          className="flex gap-2"
        >
          <input
            value={serviceDescription}
            onChange={(event) => setServiceDescription(event.target.value)}
            placeholder="Prestation (ex. Coupe cheveux)"
            autoComplete="off"
            className="h-11 flex-1 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          />
          <input
            value={servicePrice}
            onChange={(event) => setServicePrice(event.target.value)}
            placeholder="Prix €"
            inputMode="decimal"
            autoComplete="off"
            className="h-11 w-28 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          />
          <Button type="submit">Ajouter</Button>
        </form>

        {cart.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 px-5 py-12 text-center text-sm text-gray-500">Le panier est vide.</div>
        ) : (
          <div className="divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-dark-3 dark:border-dark-3">
            {cart.map((item) => (
              <div key={item.key} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{item.productName}</p>
                  <p className="text-xs text-gray-500">{item.variantName} · {item.unitPrice.toFixed(2)} €</p>
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-1 dark:border-dark-3">
                  <button type="button" onClick={() => changeQuantity(item.key, -1)} className="rounded p-1 hover:bg-gray-100 dark:hover:bg-dark-2"><Minus size={14} /></button>
                  <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                  <button type="button" onClick={() => changeQuantity(item.key, 1)} disabled={item.quantity >= item.availableQuantity} className="rounded p-1 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-dark-2"><Plus size={14} /></button>
                </div>
                <p className="w-20 text-right text-sm font-semibold text-gray-900 dark:text-white">{(item.unitPrice * item.quantity).toFixed(2)} €</p>
                <button type="button" onClick={() => changeQuantity(item.key, -item.quantity)} className="text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </section>

      <aside className="space-y-5 rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <div className="flex items-center gap-2"><UserRound size={18} className="text-[#2f3a2e]" /><h2 className="font-semibold text-gray-900 dark:text-white">Client et reçu</h2></div>

        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-dark-6">
          <input
            type="checkbox"
            checked={isWalkIn}
            onChange={(event) => toggleWalkIn(event.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-[#2f3a2e] focus:ring-[#2f3a2e]"
          />
          Client de passage — pas de compte, ticket simplifié sans nom ni e-mail
        </label>

        {isWalkIn ? (
          <p className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-500 dark:border-dark-3 dark:bg-dark-2">
            Aucune identité n&apos;est enregistrée. Un ticket sera généré à la place d&apos;une facture — le paiement par QR n&apos;est pas disponible dans ce mode.
          </p>
        ) : (
          <div className="relative space-y-3">
            <input value={customer.fullName} onChange={(event) => updateCustomer("fullName", event.target.value)} placeholder="Nom complet" className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white" />
            <input value={customer.email} onChange={(event) => updateCustomer("email", event.target.value)} placeholder="E-mail pour le reçu" type="email" className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white" />
            <input value={customer.phone} onChange={(event) => updateCustomer("phone", event.target.value)} placeholder="Téléphone (facultatif)" className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white" />
            {matches.length > 0 && (
              <div className="absolute z-10 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-dark-3 dark:bg-dark-2">
                {matches.map((match) => (
                  <button key={match.id} type="button" onClick={() => selectCustomer(match)} className="block w-full border-b border-gray-100 px-3 py-2 text-left last:border-0 hover:bg-gray-50 dark:border-dark-3 dark:hover:bg-dark-3">
                    <span className="block text-sm font-medium">{match.fullName}</span><span className="block text-xs text-gray-500">{match.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!isWalkIn && needsAddress && (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-900/10">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Adresse de facturation obligatoire pour ce client (nouveau ou sans adresse enregistrée).
            </p>
            <input
              value={customer.addressLine1}
              onChange={(event) => updateCustomerAddress("addressLine1", event.target.value)}
              placeholder="Rue et numéro"
              className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
            <input
              value={customer.addressLine2}
              onChange={(event) => updateCustomerAddress("addressLine2", event.target.value)}
              placeholder="Boîte, étage (facultatif)"
              className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
            <div className="flex gap-2">
              <input
                value={customer.addressPostalCode}
                onChange={(event) => updateCustomerAddress("addressPostalCode", event.target.value)}
                placeholder="Code postal"
                className="h-10 w-24 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
              />
              <input
                value={customer.addressCity}
                onChange={(event) => updateCustomerAddress("addressCity", event.target.value)}
                placeholder="Ville"
                className="h-10 flex-1 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
              />
              <input
                value={customer.addressCountry}
                onChange={(event) => updateCustomerAddress("addressCountry", event.target.value.toUpperCase())}
                placeholder="BE"
                maxLength={2}
                className="h-10 w-16 rounded-lg border border-gray-200 px-3 text-center text-sm uppercase outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
              />
            </div>
          </div>
        )}

        <div className="space-y-2 border-t border-gray-100 pt-5 dark:border-dark-3">
          <p className="text-sm font-medium text-gray-700 dark:text-dark-6">Paiement encaissé</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button type="button" onClick={() => selectMethod("CARD_QR")} disabled={isWalkIn} title={isWalkIn ? "Indisponible en mode client de passage" : undefined} className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${method === "CARD_QR" ? "border-[#2f3a2e] bg-[#2f3a2e]/5 text-[#2f3a2e]" : "border-gray-200 text-gray-600 dark:border-dark-3"}`}><CreditCard size={16} />Carte QR</button>
            <button type="button" onClick={() => selectMethod("CASH")} className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium ${method === "CASH" ? "border-[#2f3a2e] bg-[#2f3a2e]/5 text-[#2f3a2e]" : "border-gray-200 text-gray-600 dark:border-dark-3"}`}><Banknote size={16} />Espèces</button>
            <button type="button" onClick={() => selectMethod("EXTERNAL_TERMINAL")} className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium ${method === "EXTERNAL_TERMINAL" ? "border-[#2f3a2e] bg-[#2f3a2e]/5 text-[#2f3a2e]" : "border-gray-200 text-gray-600 dark:border-dark-3"}`}><CreditCard size={16} />Terminal externe</button>
          </div>
          {method === "CASH" && (
            <div className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-dark-3">
              <label className="text-xs font-medium text-gray-500" htmlFor="pos-cash-received">Montant reçu du client</label>
              <input
                id="pos-cash-received"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={cashReceived}
                onChange={(event) => setCashReceived(event.target.value)}
                placeholder="0.00"
                className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
              />
              {changeDue !== null && (
                <p className={`text-sm font-medium ${changeDue < 0 ? "text-red-600" : "text-gray-700 dark:text-dark-6"}`}>
                  {changeDue < 0 ? `Il manque ${Math.abs(changeDue).toFixed(2)} €` : `Monnaie à rendre : ${changeDue.toFixed(2)} €`}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-end justify-between border-t border-gray-100 pt-5 dark:border-dark-3"><span className="text-sm text-gray-500">Total</span><strong className="text-3xl text-[#2f3a2e]">{total.toFixed(2)} €</strong></div>
        <Button
          className="w-full"
          onClick={submitSale}
          disabled={
            isPending ||
            !attemptKey ||
            cart.length === 0 ||
            (method === "CASH" && (cashReceived === "" || changeDue < 0)) ||
            (!isWalkIn && needsAddress && (!customer.addressLine1.trim() || !customer.addressCity.trim() || !customer.addressPostalCode.trim()))
          }
        >
          {isPending
            ? "Enregistrement…"
            : method === "CARD_QR"
            ? "Générer le QR de paiement"
            : isWalkIn
            ? "Encaisser et générer le ticket"
            : "Encaisser et envoyer le reçu"}
        </Button>
      </aside>

      <ConfirmDialog
        open={terminalConfirmOpen}
        title="Confirmer le paiement par terminal externe"
        message={`Vérifiez que le terminal affiche « APPROUVÉ » avant de continuer — ${total.toFixed(2)} € pour ${customer.fullName || "ce client"}.`}
        confirmLabel="Encaisser et envoyer le reçu"
        loading={isPending}
        confirmDisabled={!terminalApproved || !terminalReference.trim()}
        onConfirm={submitSale}
        onCancel={() => setTerminalConfirmOpen(false)}
      >
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <label className="flex items-start gap-2 font-medium">
            <input
              type="checkbox"
              checked={terminalApproved}
              onChange={(event) => setTerminalApproved(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-amber-400"
            />
            Je confirme que le terminal affiche « APPROUVÉ » pour ce paiement.
          </label>
          <input
            value={terminalReference}
            onChange={(event) => setTerminalReference(event.target.value)}
            maxLength={100}
            placeholder="Référence / numéro du ticket terminal (obligatoire)"
            className="mt-3 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2f3a2e]"
          />
        </div>
      </ConfirmDialog>

      {qrModal && (
        <div role="dialog" aria-modal="true" aria-labelledby="pos-qr-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-gray-dark">
            <h2 id="pos-qr-title" className="text-xl font-bold text-gray-900 dark:text-white">Paiement par carte</h2>
            <p className="mt-1 text-sm text-gray-500">Scannez ce QR avec le téléphone du client.</p>
            <p className="mt-4 text-3xl font-bold text-[#2f3a2e]">{Number(qrModal.totalAmount ?? total).toFixed(2)} €</p>
            <div className="mx-auto mt-5 flex h-80 w-80 max-w-full items-center justify-center rounded-xl border border-gray-200 bg-white p-3">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrDataUrl} alt="QR code Stripe Checkout" width={320} height={320} className="h-full w-full object-contain" />
              ) : <Loader2 size={28} className="animate-spin text-[#2f3a2e]" />}
            </div>
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-500"><Loader2 size={15} className="animate-spin" />En attente de confirmation Stripe…</div>
            <a href={qrModal.checkoutUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-medium text-[#2f3a2e] underline">Ouvrir le paiement dans un nouvel onglet</a>
            <button type="button" onClick={cancelQrPayment} disabled={isCancellingQr} className="mt-5 w-full rounded-lg border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
              {isCancellingQr ? "Annulation…" : "Annuler ce paiement"}
            </button>
          </div>
        </div>
      )}

      {scannerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Scanner un produit avec la caméra"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={(event) => event.target === event.currentTarget && setScannerOpen(false)}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-dark">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-white">Scanner un QR ou code-barres</h2>
                <p className="text-xs text-gray-500">Placez le code dans le cadre. Le produit sera ajouté automatiquement.</p>
              </div>
              <button type="button" onClick={() => setScannerOpen(false)} aria-label="Fermer le scanner" className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
            </div>

            {scannerError ? (
              <div className="flex flex-col items-center gap-3 rounded-lg bg-gray-50 px-6 py-12 text-center">
                <CameraOff size={24} className="text-gray-300" />
                <p className="text-sm text-gray-600">{scannerError}</p>
              </div>
            ) : (
              <div className="relative overflow-hidden rounded-lg bg-black">
                <video ref={videoRef} onCanPlay={() => setCameraReady(true)} className="aspect-square w-full object-cover" muted playsInline />
                <div className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.25)]" />
                {!cameraReady && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
                    <Loader2 size={22} className="animate-spin text-white" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
