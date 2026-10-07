"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, CameraOff, ChevronDown, FileText, Loader2, Lock, Minus, Plus, ScanLine, Trash2, Wallet, X } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import QRCode from "qrcode";
import { toast } from "sonner";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  completePointOfSaleSale,
  cancelPointOfSaleCheckout,
  getPointOfSaleProductByBarcode,
  getPointOfSaleOrderDraft,
  getPointOfSaleOrderStatus,
  getPointOfSaleStockLevels,
  linkPointOfSaleBarcode,
  recoverPointOfSaleCheckout,
  searchPointOfSaleCustomers,
} from "@/actions/boutique/point-of-sale";
import { verifyVatNumber } from "@/actions/vat/verify-vat";
import { isCashSessionOpen, getSuggestedOpeningFloat, openCashSession, tryAutoOpenCashSession } from "@/actions/dashboard/cash-sessions";
import { createBrowserUuid } from "@/lib/browser-uuid";
import { CounterBuyerForm } from "@/components/dashboard/boutique/counter/CounterBuyerForm";
import { CounterCatalogue } from "@/components/dashboard/boutique/counter/CounterCatalogue";
import { CounterCashReceived, CounterPaymentMethodTiles } from "@/components/dashboard/boutique/counter/CounterPaymentMethods";
import { DocumentDeliveryDialog } from "@/components/dashboard/operations/DocumentDeliveryDialog";
import { createManualInvoice } from "@/actions/invoices/manual-invoice";
import { MANUAL_INVOICE_NOTES_MAX } from "@/lib/invoices/manual-invoice-constants";
import { PromoCodeField } from "@/components/shared/PromoCodeField";
import { previewCounterPromoCode } from "@/actions/counter/promo-code";

const CART_STOCK_POLL_MS = 10_000;

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
  vatNumber: "",
  isCompany: false,
  vatInvoiceReady: false,
  vatValidationName: null,
  ...emptyAddress,
};

export function CounterCart({
  canAdjustStock = false,
  canOpenCashSession = false,
  canCollectCash = false,
  canInvoiceSale = false,
  canOpenOrders = false,
  pendingProduct,
  onConsumePendingProduct,
  pendingBarcode,
  onConsumePendingBarcode,
  sourceOrderId = null,
}) {
  // A boutique sale is always the salon's, so whoever may use this till
  // (canUseSalonTill) rings it into the Livre de caisse and needs it open.
  const tillGateApplies = canCollectCash;
  const router = useRouter();
  const [barcode, setBarcode] = useState("");
  // A scanned code no product has yet (typically the supplier EAN on a box
  // the catalogue never learnt). While set, the photo grid becomes the
  // picker: « Associer » links the code to the chosen variant, and every
  // later scan of it finds the product directly.
  const [unknownBarcode, setUnknownBarcode] = useState(null);
  const [linkCandidate, setLinkCandidate] = useState(null);
  const [linkingBarcode, setLinkingBarcode] = useState(false);
  // Bumped after every sale / cancelled checkout / barcode link, so the
  // grid re-reads stock (and which variants can still take a barcode).
  const [catalogueRefreshKey, setCatalogueRefreshKey] = useState(0);
  const [cart, setCart] = useState([]);
  // No account, no invoice — a simplified ticket is issued instead. Blocked
  // together with CARD_QR (Stripe checkout needs a real customer_email) —
  // enforced again server-side, this is just the matching UI gate.
  const [isWalkIn, setIsWalkIn] = useState(false);
  const [walkInEmail, setWalkInEmail] = useState("");
  // Nudge, not a hard requirement — staff can uncheck this to skip
  // collecting an e-mail from a walk-in and still complete the sale.
  const [collectWalkInEmail, setCollectWalkInEmail] = useState(true);
  // Only meaningful once the buyer turns out VAT-eligible — lets a B2B
  // client decline the invoice for this specific sale.
  const [invoiceRequested, setInvoiceRequested] = useState(true);
  // Set once the typed walk-in address turns out to already belong to a
  // real account — surfaced as a warning instead of silently e-mailing a
  // ticket to someone who has an actual customer profile to attach it to.
  const [walkInEmailMatch, setWalkInEmailMatch] = useState(null);
  const [customer, setCustomer] = useState(emptyCustomer);
  // Whether the *resolved* customer already has a billing address stored.
  // Tracked separately from the form fields on purpose: deriving it from
  // customer.addressLine1 made the address form unmount on the first
  // keystroke typed into it, so city/postal code could never be filled and
  // the server rejected every new-customer sale with POS_ADDRESS_REQUIRED.
  const [addressOnFile, setAddressOnFile] = useState(false);
  const [matches, setMatches] = useState([]);
  // Live preview only, mirroring the online checkout's own VAT box — the
  // authoritative VIES check (and the actual save onto the customer) happens
  // server-side in completePointOfSaleSale regardless of whether this was
  // clicked. { loading } | { valid, message } | { error, message }
  const [vatCheck, setVatCheck] = useState(null);
  const [method, setMethod] = useState("CARD_QR");
  const [cashSessionOpen, setCashSessionOpen] = useState(true); // optimistic until the first check resolves
  const [openingFloatInput, setOpeningFloatInput] = useState("");
  const [openingFloatMismatch, setOpeningFloatMismatch] = useState(null);
  const [openingSessionPending, setOpeningSessionPending] = useState(false);
  const [attemptKey, setAttemptKey] = useState(null);
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
  // An unpaid pickup order opened here with « Encaisser » (orders list):
  // { orderId, orderNumber }. Sent with the sale so the server closes that
  // order and releases its reservation in the same transaction.
  const [sourceOrder, setSourceOrder] = useState(null);
  const [loadingSourceOrder, setLoadingSourceOrder] = useState(Boolean(sourceOrderId));

  // ── Invoice sale ────────────────────────────────────────────────────
  // A free line, a transfer, an acompte, « payer plus tard » or an invoice
  // comment turns the sale into an invoice sale, recorded by
  // actions/invoices/manual-invoice.js instead of completePointOfSaleSale:
  // VAT number mandatory, and — like every deposit on the site — the invoice
  // is only issued once the sale is fully paid. A plain paid sale is
  // untouched and still goes through the ticket path below.
  const [settleMode, setSettleMode] = useState("NOW"); // NOW | DEPOSIT | LATER
  const [depositInput, setDepositInput] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [invoiceConfirmOpen, setInvoiceConfirmOpen] = useState(false);
  const [issuedInvoice, setIssuedInvoice] = useState(null);
  // `canInvoiceSale`: invoice sales stay the salon's own accounts
  // (isTillCashOperator) — a CAISSE staff member never sees this mode, and
  // the server refuses anyone else.

  // A promo code, as on the online checkout: { code, discountAmount }. The
  // amount is only the live preview — completePointOfSaleSale re-prices and
  // claims the code itself. `promoFieldKey` remounts the field to empty it.
  const [promo, setPromo] = useState(null);
  const [promoFieldKey, setPromoFieldKey] = useState(0);

  const cartSubtotal = useMemo(
    () => Math.round(cart.reduce((sum, item) => sum + Number(item.unitPrice || 0) * item.quantity, 0) * 100) / 100,
    [cart]
  );
  const hasFreeLines = cart.some((item) => item.type === "FREE");
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const invoiceFlow =
    canInvoiceSale && !sourceOrder && (hasFreeLines || method === "TRANSFER" || settleMode !== "NOW" || invoiceNotes.trim() !== "");
  // An invoice sale (manual-invoice.js) has no promo code — only the ticket
  // path below does.
  const appliedPromo = invoiceFlow ? null : promo;
  // What the client pays: the cart, less the promo.
  const total = Math.max(0, Math.round((cartSubtotal - (appliedPromo?.discountAmount ?? 0)) * 100) / 100);
  const promoItems = cart.filter((item) => item.type !== "FREE").map((item) => ({ variantId: item.variantId, quantity: item.quantity }));
  const promoContext = { scope: "BOUTIQUE", items: promoItems, customerId: isWalkIn ? null : customer.id ?? null };
  const depositAmount = Math.round(Number(depositInput) * 100) / 100;
  const depositValid = depositAmount > 0 && depositAmount < total;
  const collectsNow = !invoiceFlow || settleMode !== "LATER";
  // A transfer is never accepted at the till: it takes days to arrive. The
  // sale is recorded unpaid, « virement attendu », and only counts as paid
  // (and gets its invoice) once staff approve it — « Virement reçu », with
  // the bank reference, from « Ventes en attente de paiement ».
  const transferAwaited = invoiceFlow && collectsNow && method === "TRANSFER";
  // What changes hands now: the whole total, an acompte, or nothing.
  const collectedNow =
    transferAwaited ? 0 : !invoiceFlow || settleMode === "NOW" ? total : settleMode === "DEPOSIT" ? (depositValid ? depositAmount : 0) : 0;
  // The invoice is issued by this very sale only when it is paid in full now.
  const issuesInvoiceNow = invoiceFlow && settleMode === "NOW" && !transferAwaited;
  const cashReceivedNumber = Number(cashReceived);
  const changeDue = cashReceived !== "" && !Number.isNaN(cashReceivedNumber) ? cashReceivedNumber - collectedNow : null;
  // With no till session, only what never touches the drawer can be
  // recorded: an invoice sale paid by transfer, or not paid yet.
  const tillClosed = tillGateApplies && !cashSessionOpen;
  const allowedWhileClosed = invoiceFlow && (settleMode === "LATER" || method === "TRANSFER");
  const walkInEmailReady = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(walkInEmail.trim());

  useEffect(() => {
    if (invoiceFlow && method === "CARD_QR") setMethod("EXTERNAL_TERMINAL");
  }, [invoiceFlow, method]);

  const promoCode = promo?.code ?? null;
  const promoCartKey = JSON.stringify(promoItems);
  const promoCustomerId = promoContext.customerId;
  useEffect(() => {
    if (!promoCode) return undefined;
    let cancelled = false;
    previewCounterPromoCode(promoCode, cartSubtotal, { scope: "BOUTIQUE", items: JSON.parse(promoCartKey), customerId: promoCustomerId }).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setPromo((current) => (current?.code === promoCode ? { ...current, discountAmount: result.discountAmount, appliedRules: result.appliedRules ?? [] } : current));
      } else {
        toast.error(`Code ${promoCode} retiré : ${result.message}`);
        clearPromo();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [promoCode, promoCartKey, promoCustomerId, cartSubtotal]);

  function clearPromo() {
    setPromo(null);
    setPromoFieldKey((key) => key + 1);
  }

  function resetAttempt() {
    setCatalogueRefreshKey((key) => key + 1);
    const next = createBrowserUuid();
    localStorage.setItem("meri-pos-attempt-key", next);
    setAttemptKey(next);
    return next;
  }

  // After a completed sale: the salon's accounts land on the order (Commandes
  // is theirs). A staff member granted CAISSE cannot open Commandes — she
  // would be bounced to /dashboard after every sale — so her till simply
  // clears for the next client, with a fresh attempt key.
  function openSaleResult(orderId) {
    if (canOpenOrders) {
      router.push(`/dashboard/boutique/orders/${orderId}`);
      return;
    }
    resetInvoiceSale();
    setIsWalkIn(false);
    setWalkInEmail("");
    setWalkInEmailMatch(null);
    setInvoiceRequested(true);
    resetAttempt();
  }

  useEffect(() => {
    const stored = localStorage.getItem("meri-pos-attempt-key") || createBrowserUuid();
    localStorage.setItem("meri-pos-attempt-key", stored);
    setAttemptKey(stored);
    recoverPointOfSaleCheckout(stored).then((result) => {
      if (result.success && result.data?.completed) {
        localStorage.removeItem("meri-pos-attempt-key");
        openSaleResult(result.data.orderId);
      } else if (result.success && result.data?.checkoutUrl) {
        setQrModal(result.data);
      } else if (result.terminal || result.notFound) {
        resetAttempt();
      }
    }).catch(() => {});
    // openSaleResult only reads a prop fixed for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    // No till session, no sale — completePointOfSaleSale rejects every
    // method the same way now, not just CASH: a sale rung up with no
    // session open used to complete normally and carry cashSessionId: null
    // forever (Transaction.cashSessionId is set once, at sale time, never
    // backfilled). Checked on mount, then polled every 10s only while
    // actually blocked — the moment the till opens (auto-open, or a
    // teammate opening it from the Livre de caisse page), this screen
    // unblocks itself without a reload.
    let cancelled = false;
    let interval = null;

    function check() {
      isCashSessionOpen().then(async (result) => {
        if (cancelled) return;
        let open = Boolean(result.success && result.data);

        // Before falling back to the blocking manual form, try the same
        // silent auto-open every cash-taking action gets: carry the last
        // closed session's counted total forward when it's a usable
        // positive amount, instead of waiting on the cron's own interval.
        // Only worth attempting for someone who could act on the manual
        // form anyway — a cashier without CASH_REGISTER would just fail
        // this call's own permission check.
        if (!open && canOpenCashSession) {
          const autoOpened = await tryAutoOpenCashSession().catch(() => null);
          if (autoOpened?.success && autoOpened.data) open = true;
        }

        setCashSessionOpen(open);
        if (open && interval) {
          clearInterval(interval);
          interval = null;
        } else if (!open && !interval) {
          // Only worth fetching for someone who can actually act on it — a
          // cashier without CASH_REGISTER sees the "ask a colleague" message
          // instead and this call would just fail its own permission check.
          if (canOpenCashSession) {
            getSuggestedOpeningFloat().then((r) => {
              if (!cancelled && r.success && r.data != null) setOpeningFloatInput(String(r.data));
            }).catch(() => {});
          }
          interval = setInterval(check, 10000);
        }
      }).catch(() => {});
    }
    check();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [canOpenCashSession]);

  function handleOpenSessionFromPos(confirmDivergence = false) {
    const amount = Number(openingFloatInput);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Indiquez un fond de caisse valide.");
      return;
    }
    setOpeningSessionPending(true);
    openCashSession(amount, { confirmDivergence }).then(async (result) => {
      setOpeningSessionPending(false);
      if (!result.success) {
        if (result.code === "OPENING_FLOAT_MISMATCH") {
          setOpeningFloatMismatch(result);
          return;
        }
        // With two terminals, a teammate opening the till at the same
        // moment wins the race (openCashSession's advisory lock allows only
        // one) — the loser sees "déjà ouverte", not a crash, and should
        // unblock immediately rather than sit on a dead retry button.
        const current = await isCashSessionOpen().catch(() => null);
        if (current?.success && current.data) {
          setCashSessionOpen(true);
          toast.success("Caisse déjà ouverte par un collègue.");
          return;
        }
        toast.error(result.message);
        return;
      }
      setOpeningFloatMismatch(null);
      setCashSessionOpen(true);
      toast.success("Caisse ouverte.");
    });
  }

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
          openSaleResult(qrModal.orderId);
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
    // openSaleResult only reads a prop fixed for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // A walk-in ticket is anonymous by design — but if the typed address turns
  // out to already belong to a real account, silently e-mailing it there
  // would orphan that purchase from the customer's actual profile and order
  // history. Checked only once the address looks complete (not on every
  // keystroke), and matched exactly — a search that merely *contains* the
  // typed string would flag unrelated accounts too (e.g. "ann@x.com" is a
  // substring of "susann@x.com").
  useEffect(() => {
    if (!isWalkIn) {
      setWalkInEmailMatch(null);
      return undefined;
    }
    const value = walkInEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setWalkInEmailMatch(null);
      return undefined;
    }
    const timeout = setTimeout(async () => {
      const result = await searchPointOfSaleCustomers(value);
      if (!result.success) return;
      const exact = result.data.find((match) => match.email.toLowerCase() === value.toLowerCase());
      setWalkInEmailMatch(exact ?? null);
    }, 300);
    return () => clearTimeout(timeout);
  }, [walkInEmail, isWalkIn]);

  // Switches out of walk-in mode straight onto the matched account, exactly
  // as if the cashier had searched for and picked them manually.
  function useMatchedAccountInstead() {
    if (!walkInEmailMatch) return;
    toggleWalkIn(false);
    selectCustomer(walkInEmailMatch);
    setWalkInEmail("");
  }

  // Shared by the scanner and the name search — both resolve to the same
  // {variantId, availableQuantity, …} shape, so the stock ceiling and the
  // "already in the cart" merge must behave identically whichever way the
  // line was found.
  // Returns whether the line was actually added/incremented — callers that
  // need to know (the pendingProduct effect below, deciding whether its own
  // success toast applies) can check it instead of guessing from the error
  // toasts this already shows on the refusal paths.
  const addProductToCart = useCallback((item) => {
    if (item.availableQuantity <= 0) {
      toast.error("Ce produit est en rupture de stock.");
      return false;
    }
    let added = true;
    setCart((current) => {
      const present = current.find((entry) => entry.variantId === item.variantId);
      if (!present) {
        return [...current, {
          key: item.variantId,
          type: "PRODUCT",
          variantId: item.variantId,
          productName: item.productName,
          variantName: item.variantName,
          unitPrice: item.unitPrice,
          availableQuantity: item.availableQuantity,
          quantity: 1,
        }];
      }
      // A line prefilled from a taken-over order already counts that order's
      // own held units as available; a search/scan result does not — keep
      // whichever ceiling is higher so the order's units aren't lost.
      const ceiling = Math.max(present.availableQuantity, item.availableQuantity);
      if (present.quantity >= ceiling) {
        toast.error("La quantité demandée dépasse le stock disponible.");
        added = false;
        return current;
      }
      return current.map((entry) => (entry.variantId === item.variantId ? { ...entry, quantity: entry.quantity + 1, availableQuantity: ceiling } : entry));
    });
    return added;
  }, []);

  // A product row selected from the counter's top search (CounterSurface) —
  // added straight to the cart rather than merely re-focusing this section's
  // own search box, so "Utilisez la caisse ci-dessous" actually does
  // something instead of asking staff to retype the same product name a
  // second time. If no till session is open yet, the line is still queued
  // here (cart state doesn't depend on which branch below is rendered) —
  // it's simply invisible until a session opens, same as anything else added
  // while this screen shows "Caisse fermée".
  useEffect(() => {
    if (!pendingProduct) return;
    const added = addProductToCart(pendingProduct);
    if (added) {
      toast.success(
        cashSessionOpen
          ? `${pendingProduct.productName} — ${pendingProduct.variantName} ajouté au panier.`
          : `${pendingProduct.productName} ajouté au panier — ouvrez la caisse ci-dessous pour l'encaisser.`
      );
    }
    document.getElementById("counter-basket")?.scrollIntoView({ behavior: "smooth", block: "start" });
    onConsumePendingProduct?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingProduct]);

  // « Encaisser » from the orders list: fill the cart and the client from
  // that order. Staff can then add or remove lines and settle as usual —
  // cash or terminal only (a QR checkout completes later, in the webhook,
  // too late to close the original order together with the sale).
  useEffect(() => {
    if (!sourceOrderId) return undefined;
    let cancelled = false;
    setLoadingSourceOrder(true);
    getPointOfSaleOrderDraft(sourceOrderId)
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          toast.error(result.message);
          router.replace("/dashboard/boutique/point-of-sale");
          return;
        }
        const draft = result.data;
        setCart(
          draft.items.map((item) => ({
            key: item.variantId,
            type: "PRODUCT",
            variantId: item.variantId,
            productName: item.productName,
            variantName: item.variantName,
            unitPrice: item.unitPrice,
            availableQuantity: item.availableQuantity,
            quantity: item.quantity,
            // Units that order already holds (reservedQuantity): released to
            // this sale, so live stock checks add them back.
            heldQuantity: item.quantity,
          }))
        );
        if (draft.customer) {
          setIsWalkIn(false);
          selectCustomer(draft.customer);
        }
        setMethod((current) => (current === "CARD_QR" ? "CASH" : current));
        setSourceOrder({ orderId: draft.orderId, orderNumber: draft.orderNumber, discountAmount: draft.discountAmount });
        if (draft.unavailable.length > 0) {
          toast.error(`Plus en vente, non repris : ${draft.unavailable.join(", ")}.`);
        }
        toast.success(`Commande n°${draft.orderNumber} reprise à la caisse.`);
        document.getElementById("counter-cart")?.scrollIntoView({ behavior: "smooth", block: "start" });
      })
      .catch(() => !cancelled && toast.error("Impossible de charger cette commande."))
      .finally(() => !cancelled && setLoadingSourceOrder(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceOrderId]);

  // Drops the taken-over order: the cart empties and the original order is
  // left exactly as it was (nothing was changed on it yet).
  function releaseSourceOrder() {
    setSourceOrder(null);
    setCart([]);
    clearPromo();
    router.replace("/dashboard/boutique/point-of-sale");
  }

  const addBarcode = useCallback(async (scannedCode = barcode) => {
    const code = scannedCode?.trim();
    if (!code) return;
    const result = await getPointOfSaleProductByBarcode(code);
    if (!result.success) {
      if (result.code === "BARCODE_UNKNOWN" && result.linkable) {
        setUnknownBarcode(result.barcode);
        setBarcode("");
        return;
      }
      toast.error(result.message);
      return;
    }
    addProductToCart(result.data);
    setBarcode("");
  }, [barcode, addProductToCart]);

  // A tap in the grid re-reads live stock before adding: the grid is a
  // snapshot (refreshed every 20 s), and an online order can take the last
  // unit in between. Returns whether the line was added.
  const addFromCatalogue = useCallback(async (item) => {
    const result = await getPointOfSaleStockLevels([item.variantId]);
    if (!result.success) return addProductToCart(item); // the server still re-checks at payment
    const held = cart.find((line) => line.variantId === item.variantId)?.heldQuantity ?? 0;
    const live = (result.data[item.variantId] ?? 0) + held;
    const inCart = cart.find((line) => line.variantId === item.variantId)?.quantity ?? 0;
    if (live <= inCart) {
      toast.error(
        live <= 0
          ? `« ${item.productName} » n'est plus disponible — vendu ou réservé en ligne entre-temps.`
          : "Tout le stock disponible est déjà au panier."
      );
      setCatalogueRefreshKey((key) => key + 1);
      return false;
    }
    return addProductToCart({ ...item, availableQuantity: live });
  }, [cart, addProductToCart]);

  // What is in the cart is re-checked every CART_STOCK_POLL_MS: a client can
  // stand at the counter with the last unit while it is bought online. Each
  // line's ceiling follows the live figure, a line now above it is flagged
  // (and blocks the payment button), and the cashier is told once.
  const cartVariantKey = cart
    .filter((line) => line.type === "PRODUCT" && line.variantId)
    .map((line) => line.variantId)
    .sort()
    .join(",");
  const warnedConflictsRef = useRef(new Set());
  const checkCartStock = useCallback(async () => {
    const ids = cartVariantKey ? cartVariantKey.split(",") : [];
    if (ids.length === 0) return;
    const result = await getPointOfSaleStockLevels(ids);
    if (!result.success) return;
    setCart((current) =>
      current.map((line) => {
        if (line.type !== "PRODUCT" || !(line.variantId in result.data)) return line;
        const live = result.data[line.variantId] + (line.heldQuantity ?? 0);
        if (line.quantity > live && !warnedConflictsRef.current.has(line.variantId)) {
          warnedConflictsRef.current.add(line.variantId);
          toast.error(
            live <= 0
              ? `« ${line.productName} » vient d'être vendu ou réservé en ligne — il n'est plus disponible.`
              : `« ${line.productName} » : plus que ${live} disponible(s) — vendu ou réservé en ligne entre-temps.`
          );
        }
        if (line.quantity <= live) warnedConflictsRef.current.delete(line.variantId);
        return line.availableQuantity === live ? line : { ...line, availableQuantity: live };
      })
    );
  }, [cartVariantKey]);

  useEffect(() => {
    // Paused while a QR checkout is open: that order has itself reserved the
    // units, so they would read as "taken" by someone else.
    if (!cartVariantKey || qrModal) return undefined;
    checkCartStock();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") checkCartStock();
    }, CART_STOCK_POLL_MS);
    window.addEventListener("focus", checkCartStock);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", checkCartStock);
    };
  }, [cartVariantKey, qrModal, checkCartStock]);

  const stockConflicts = cart.filter((line) => line.type === "PRODUCT" && line.quantity > line.availableQuantity);

  function fitLineToStock(key) {
    setCart((current) =>
      current
        .map((line) => (line.key === key ? { ...line, quantity: Math.min(line.quantity, line.availableQuantity) } : line))
        .filter((line) => line.quantity > 0)
    );
  }

  // A product barcode scanned from the omnibar camera above is handed here,
  // so an unknown one gets the same « Associer » flow as the till's own
  // scanner instead of a dead-end "no result".
  useEffect(() => {
    if (!pendingBarcode) return;
    addBarcode(pendingBarcode);
    document.getElementById("counter-cart")?.scrollIntoView({ behavior: "smooth", block: "start" });
    onConsumePendingBarcode?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBarcode]);

  function cancelBarcodeLink() {
    setUnknownBarcode(null);
    setLinkCandidate(null);
  }

  async function confirmBarcodeLink() {
    if (!linkCandidate || !unknownBarcode) return;
    setLinkingBarcode(true);
    const result = await linkPointOfSaleBarcode({ variantId: linkCandidate.variantId, barcode: unknownBarcode });
    setLinkingBarcode(false);
    if (!result.success) {
      toast.error(result.message);
      setLinkCandidate(null);
      return;
    }
    toast.success(`Code-barres associé à « ${result.data.productName} » — il sera reconnu au prochain scan.`);
    setUnknownBarcode(null);
    setLinkCandidate(null);
    setCatalogueRefreshKey((key) => key + 1);
    addProductToCart(result.data);
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
        console.error("[CounterCart] camera scanner failed", error);
        setScannerError("Impossible d'accéder à la caméra. Vérifiez l'autorisation du navigateur ou utilisez le lecteur USB.");
      });

    return () => {
      cancelled = true;
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
    };
  }, [scannerOpen, addBarcode]);

  // Free text, editable price (TTC) — a service, a fee, a flat rate. Only on
  // an invoice sale: the ticket path sells catalogue products only.
  function addFreeLine() {
    setCart((current) => [
      ...current,
      { key: `free-${createBrowserUuid()}`, type: "FREE", description: "", unitPrice: "", quantity: 1, availableQuantity: 999 },
    ]);
  }

  function updateFreeLine(key, patch) {
    setCart((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

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
      vatNumber: match.vatNumber ?? "",
      isCompany: Boolean(match.isCompany),
      vatInvoiceReady: Boolean(match.vatInvoiceReady),
      vatValidationName: match.vatValidationName ?? null,
      addressLine1: match.addressLine1 ?? "",
      addressLine2: match.addressLine2 ?? "",
      addressCity: match.addressCity ?? "",
      addressPostalCode: match.addressPostalCode ?? "",
      addressCountry: match.addressCountry ?? "BE",
    });
    setAddressOnFile(Boolean(match.addressLine1));
    setVatCheck(null);
    setMatches([]);
  }

  function updateCustomer(field, value) {
    // Editing an identity field detaches from the matched customer. Their
    // stored address belongs to them, not to whoever is being typed now, so
    // drop it and ask again — otherwise person B gets invoiced at person A's
    // address, and the form never reappears because it still looks filled.
    // isCompany resets the same way: it describes the matched account, not
    // whoever is now being typed.
    const wasMatched = Boolean(customer.id);
    if (wasMatched) setAddressOnFile(false);
    setCustomer((current) => ({
      ...current,
      ...(wasMatched ? emptyAddress : null),
      ...(wasMatched ? { isCompany: false, vatInvoiceReady: false, vatValidationName: null } : null),
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

  // A VAT number is the same kind of continuation as an address, not an
  // identity change: adding one for an existing customer who never had it on
  // file — or correcting one — shouldn't detach the matched account.
  function updateCustomerVat(value) {
    setCustomer((current) => ({ ...current, vatNumber: value, vatInvoiceReady: false, vatValidationName: null }));
    setVatCheck(null);
  }

  async function handleVerifyVat() {
    if (!customer.vatNumber.trim()) {
      toast.error("Renseignez d'abord un numéro de TVA.");
      return;
    }
    setVatCheck({ loading: true });
    const result = await verifyVatNumber(customer.vatNumber);
    if (!result.success) {
      setVatCheck({ error: true, message: result.message });
      return;
    }
    setVatCheck({
      valid: result.valid,
      message: result.valid
        ? result.name
          ? `Actif — enregistré au nom de « ${result.name} ».`
          : "Actif dans le registre VIES."
        : "Ce numéro n'est pas reconnu par le registre européen VIES.",
    });
  }

  // A returning customer with an address already on file shouldn't have to
  // re-enter it at every counter sale — only ask when it's genuinely
  // missing (new customer, or an existing one with none saved yet). Mirrors
  // the server's own rule, which also tests the stored record rather than
  // the submitted payload.
  const needsAddress = !addressOnFile;

  // Existing VIES proof is reused silently; a newly typed VAT number is
  // checked again server-side when the sale is submitted.
  const willHaveVatInvoice = customer.vatInvoiceReady || Boolean(customer.vatNumber.trim());
  // A Belgian company must receive its invoice over Peppol, not an
  // ad-hoc e-mail (2026 mandate) — the till still creates and numbers the
  // invoice, it just hands the customer a receipt instead and staff send
  // the real invoice from Opérations afterward. Mirrors
  // isPeppolMandatoryCustomer in lib/tax-policy.js closely enough for the
  // till's own copy, without needing a round trip to know it.
  const willBeBelgianB2B = willHaveVatInvoice && customer.vatNumber.trim().toUpperCase().startsWith("BE");

  function selectMethod(next) {
    if (next === "CARD_QR" && (isWalkIn || sourceOrder || invoiceFlow)) return; // blocked for a client de passage, a taken-over order and an invoice sale
    if (next === "TRANSFER" && (isWalkIn || sourceOrder || !canInvoiceSale)) return; // a transfer is always an invoice sale
    setMethod(next);
    if (next !== "CASH") setCashReceived("");
  }

  function toggleWalkIn(next) {
    setIsWalkIn(next);
    if (next && method === "CARD_QR") setMethod("CASH");
  }

  function resetInvoiceSale() {
    setCart([]);
    clearPromo();
    setCustomer(emptyCustomer);
    setAddressOnFile(false);
    setVatCheck(null);
    setInvoiceNotes("");
    setSettleMode("NOW");
    setDepositInput("");
    setDueDate("");
    setCashReceived("");
    setMethod("CARD_QR");
  }

  /**
   * An invoice sale (see invoiceFlow): recorded by createManualInvoice. Paid
   * in full, its invoice is issued at once and the sending card opens; with
   * an acompte or nothing collected it joins « Ventes en attente de
   * paiement » below, and is invoiced by the payment that clears it.
   */
  function submitInvoiceSale() {
    if (!cart.length) return toast.error("Ajoutez au moins une ligne.");
    if (!attemptKey) return toast.error("Initialisation de la caisse en cours. Réessayez dans un instant.");
    if (!customer.fullName.trim() || !customer.email.trim()) return toast.error("Nom et e-mail du client obligatoires pour une facture.");
    if (!customer.vatNumber.trim()) return toast.error("Une facture exige le numéro de TVA du client.");
    if (needsAddress && (!customer.addressLine1.trim() || !customer.addressCity.trim() || !customer.addressPostalCode.trim())) {
      return toast.error("L'adresse de facturation du client est obligatoire.");
    }
    if (cart.some((item) => item.type === "FREE" && (!item.description.trim() || !(Number(item.unitPrice) > 0)))) {
      return toast.error("Chaque ligne libre doit avoir une description et un prix supérieur à 0.");
    }
    if (settleMode === "DEPOSIT" && !depositValid) return toast.error("L'acompte doit être supérieur à 0 et inférieur au total.");
    if (tillClosed && !allowedWhileClosed) {
      return toast.error("Caisse fermée : ouvrez-la, ou encaissez par virement, ou choisissez « Payer plus tard ».");
    }
    if (collectsNow) {
      if (method === "CASH" && (cashReceived === "" || Number.isNaN(cashReceivedNumber) || cashReceivedNumber < collectedNow)) {
        return toast.error("Le montant reçu doit couvrir la somme encaissée.");
      }
    }
    if (!invoiceConfirmOpen) {
      setInvoiceConfirmOpen(true);
      return;
    }

    startTransition(async () => {
      const result = await createManualInvoice({
        attemptKey,
        customer: {
          id: customer.id,
          fullName: customer.fullName,
          email: customer.email,
          phone: customer.phone,
          vatNumber: customer.vatNumber,
          addressLine1: customer.addressLine1,
          addressLine2: customer.addressLine2,
          addressCity: customer.addressCity,
          addressPostalCode: customer.addressPostalCode,
          addressCountry: customer.addressCountry,
        },
        lines: cart.map((item) =>
          item.type === "FREE"
            ? { type: "FREE", description: item.description.trim(), quantity: item.quantity, unitPrice: Number(item.unitPrice) }
            : { type: "PRODUCT", variantId: item.variantId, quantity: item.quantity }
        ),
        notes: invoiceNotes,
        dueDate: issuesInvoiceNow ? null : dueDate || null,
        settlement:
          settleMode === "LATER"
            ? { mode: "LATER" }
            : transferAwaited
            ? { mode: "LATER", awaitedTransferAmount: settleMode === "DEPOSIT" ? depositAmount : total }
            : {
                mode: settleMode,
                ...(settleMode === "DEPOSIT" ? { amount: depositAmount } : {}),
                // The external terminal is recorded as a CARD receipt, exactly
                // like a ticket sale paid there — referenced by the sale's
                // order number, set server-side.
                method: method === "EXTERNAL_TERMINAL" ? "CARD" : method,
                cashReceived: method === "CASH" ? cashReceivedNumber : null,
              },
      });
      setInvoiceConfirmOpen(false);
      if (!result?.success) {
        toast.error(result?.message ?? "Impossible d'enregistrer la vente.");
        if (result?.requiresCashSession) setCashSessionOpen(false);
        checkCartStock();
        setCatalogueRefreshKey((key) => key + 1);
        return;
      }

      localStorage.removeItem("meri-pos-attempt-key");
      resetAttempt();
      resetInvoiceSale();
      const { invoice, sale } = result.data;
      if (invoice) {
        toast.success(`Facture ${invoice.number} émise — vente n°${sale.orderNumber} encaissée.`);
        setIssuedInvoice(invoice); // « proposer l'envoi »
      } else {
        toast.success(
          transferAwaited
            ? `Vente n°${sale.orderNumber} enregistrée — virement attendu. Cliquez « Virement reçu » quand il arrive : la facture sera émise au paiement complet.`
            : `Vente n°${sale.orderNumber} enregistrée — reste ${sale.remainingAmount.toFixed(2)} € à encaisser. La facture sera émise au paiement du solde.`
        );
      }
      router.refresh();
    });
  }

  function submitSale() {
    if (invoiceFlow) return submitInvoiceSale();
    if (!cart.length) return toast.error("Ajoutez au moins un produit.");
    if (!attemptKey) return toast.error("Initialisation de la caisse en cours. Réessayez dans un instant.");
    if (isWalkIn && collectWalkInEmail && !walkInEmailReady) {
      return toast.error("Indiquez l'e-mail du client pour envoyer le ticket.");
    }
    if (method === "CASH" && (cashReceived === "" || Number.isNaN(cashReceivedNumber) || cashReceivedNumber < total)) {
      return toast.error("Le montant reçu doit couvrir le total de la vente.");
    }
    startTransition(async () => {
      const result = await completePointOfSaleSale({
        customer: isWalkIn ? null : customer,
        walkInEmail: isWalkIn ? walkInEmail.trim() : "",
        items: cart.map((item) => ({ type: "PRODUCT", variantId: item.variantId, quantity: item.quantity })),
        method,
        attemptKey,
        invoiceRequested,
        sourceOrderId: sourceOrder?.orderId ?? null,
        promoCode: appliedPromo?.code ?? null,
        // No confirmation popup any more (user's call, 2026-09-28): pressing
        // « Encaisser » with « Terminal externe » selected is the attestation,
        // as on every Pointage screen. The reference is the order number.
        ...(method === "EXTERNAL_TERMINAL" ? { terminalApproved: true } : {}),
        ...(method === "CASH" ? { cashReceived: cashReceivedNumber } : {}),
      });
      if (!result.success) {
        toast.error(result.message);
        if (result.requiresCashSession) setCashSessionOpen(false);
        checkCartStock();
        setCatalogueRefreshKey((key) => key + 1);
        return;
      }
      if (method === "CARD_QR") {
        if (!result.data.completed) {
          setQrModal({ ...result.data, totalAmount: total });
          return;
        }
        localStorage.removeItem("meri-pos-attempt-key");
        toast.success("Paiement Stripe confirmé.");
        openSaleResult(result.data.orderId);
        return;
      }
      localStorage.removeItem("meri-pos-attempt-key");
      if (result.data.alreadyProcessed) {
        toast.success(`La vente n°${result.data.orderNumber} était déjà enregistrée.`);
        openSaleResult(result.data.orderId);
        return;
      }
      if (result.data.walkIn) {
        if (result.data.ticketPdfBase64) {
          const bytes = Uint8Array.from(atob(result.data.ticketPdfBase64), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
          window.open(url, "_blank");
          if (result.data.ticketEmailSent === false) {
            toast.error(`Vente n°${result.data.orderNumber} enregistrée. Ticket prêt à imprimer, mais l'e-mail n'a pas pu être envoyé.`);
          } else if (result.data.ticketEmailSent === true) {
            toast.success(`Vente n°${result.data.orderNumber} enregistrée. Ticket prêt à imprimer, et envoyé par e-mail au client.`);
          } else {
            toast.success(`Vente n°${result.data.orderNumber} enregistrée. Ticket prêt à imprimer.`);
          }
        } else {
          toast.error(`Vente n°${result.data.orderNumber} enregistrée, mais le ticket n'a pas pu être généré.`);
        }
        openSaleResult(result.data.orderId);
        return;
      }
      // Every named-customer sale now gets the same compact receipt,
      // printable at the till and e-mailed — the invoice PDF itself is never
      // auto-sent, even for a valid-VAT customer. When one was created and
      // numbered (owed for VAT purposes), staff review and send it
      // afterward from Opérations instead: over Peppol for a Belgian
      // company, or by e-mail on demand for anyone else.
      if (
        result.data.documentType === "receipt" ||
        result.data.documentType === "invoice_pending_peppol" ||
        result.data.documentType === "invoice_pending_manual_send"
      ) {
        if (result.data.ticketPdfBase64) {
          const bytes = Uint8Array.from(atob(result.data.ticketPdfBase64), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
          window.open(url, "_blank");
        }
        const pendingInvoiceNote =
          result.data.documentType === "invoice_pending_peppol"
            ? ` Facture n°${result.data.invoiceNumber} créée — à transmettre via Peppol depuis Opérations.`
            : result.data.documentType === "invoice_pending_manual_send"
            ? ` Facture n°${result.data.invoiceNumber} créée — à envoyer manuellement depuis Opérations.`
            : "";
        if (result.data.receiptEmailSent) {
          toast.success(`Vente n°${result.data.orderNumber} enregistrée. Reçu prêt à imprimer, et envoyé par e-mail au client.${pendingInvoiceNote}`);
        } else {
          toast.error(`Vente n°${result.data.orderNumber} enregistrée. Reçu prêt à imprimer, mais l'e-mail n'a pas pu être envoyé.${pendingInvoiceNote}`);
        }
        openSaleResult(result.data.orderId);
        return;
      }
      openSaleResult(result.data.orderId);
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
        openSaleResult(qrModal.orderId);
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

  // No till session: the cart stays usable, but only for what never touches
  // the drawer (allowedWhileClosed) — every ticket sale, and any cash, card
  // or QR receipt, still needs the till open (completePointOfSaleSale and
  // createManualInvoice both enforce it server-side).
  const closedTillCard = tillClosed && (
      <div className="mx-auto max-w-md rounded-[10px] border border-stroke bg-white p-8 text-center shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          <Lock size={22} strokeWidth={1.75} />
        </div>
        <h1 className="mt-4 text-lg font-bold text-dark dark:text-white">Caisse fermée</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-dark-6">
          Aucune session de caisse n&apos;est ouverte. Ouvrez-la avant d&apos;encaisser une vente en espèces, au
          terminal ou par QR.
          {canInvoiceSale &&
            " En attendant, seule une vente avec facture réglée par virement, ou à payer plus tard, peut être enregistrée ci-dessous."}
        </p>
        {canOpenCashSession ? (
          <>
            <div className="mt-5 flex items-end justify-center gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="pos-opening-float">Fond de caisse</label>
                <input
                  id="pos-opening-float"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={openingFloatInput}
                  onChange={(event) => { setOpeningFloatInput(event.target.value); setOpeningFloatMismatch(null); }}
                  placeholder="0.00"
                  className="h-10 w-32 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                />
              </div>
              <Button onClick={() => handleOpenSessionFromPos(false)} disabled={openingSessionPending}>
                <Wallet size={16} />
                {openingSessionPending ? "Ouverture…" : "Ouvrir la caisse"}
              </Button>
            </div>
            {openingFloatInput !== "" && !openingFloatMismatch && (
              <p className="mt-2 text-xs text-gray-400">Repris du dernier comptage — modifiable.</p>
            )}
            {openingFloatMismatch && (
              <div className="mx-auto mt-3 max-w-xs space-y-1.5 rounded-lg border border-red-300 bg-red-50 p-3 text-left dark:border-red-700 dark:bg-red-950">
                <p className="text-xs text-red-800 dark:text-red-300">{openingFloatMismatch.message}</p>
                <button
                  type="button"
                  onClick={() => handleOpenSessionFromPos(true)}
                  disabled={openingSessionPending}
                  className="text-xs font-semibold text-red-800 underline hover:no-underline dark:text-red-300"
                >
                  Ouvrir avec {Number(openingFloatInput).toFixed(2)} € quand même
                </button>
              </div>
            )}
          </>
        ) : (
          // This branch is only a defensive fallback: every user who reaches
          // the POS has POINT_OF_SALE and can therefore open a session. The
          // server action enforces the same rule independently.
          <p className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600 dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6">
            Vous n&apos;avez pas la permission d&apos;ouvrir la caisse. Demandez à un responsable de vérifier vos accès.
          </p>
        )}
      </div>
  );

  return (
    <div className="space-y-6">
    {closedTillCard}
    <div id="counter-cart" className="space-y-6">
      <section className="space-y-4 rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#c8a46a]">Caisse</p>
          <h1 className="mt-1 text-2xl font-bold text-dark dark:text-white">Vente en magasin</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-dark-6">
            Scannez un code-barres ou touchez le produit dans le catalogue, puis associez le client et encaissez.
          </p>
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

        {unknownBarcode && (
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
            <div className="min-w-0">
              <p className="font-semibold">Code-barres inconnu : {unknownBarcode}</p>
              <p className="mt-0.5 text-xs">
                Touchez ce produit dans le catalogue ci-dessous (« Associer ») : le code sera enregistré et le produit
                s&apos;ajoutera directement au prochain scan.
              </p>
            </div>
            <button
              type="button"
              onClick={cancelBarcodeLink}
              className="shrink-0 rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100 dark:bg-transparent dark:text-sky-200"
            >
              Ignorer
            </button>
          </div>
        )}

        <CounterCatalogue
          refreshKey={catalogueRefreshKey}
          cart={cart}
          onAdd={addFromCatalogue}
          linkBarcode={unknownBarcode}
          onPickForLink={setLinkCandidate}
        />

        {cartItemCount > 0 && (
          <button
            type="button"
            onClick={() => document.getElementById("counter-basket")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="sticky bottom-3 z-10 flex w-full items-center justify-between gap-3 rounded-xl bg-[#2f3a2e] px-5 py-3 text-left text-white shadow-lg transition-colors hover:bg-[#2f3a2e]/95"
          >
            <span className="text-sm font-semibold">
              Panier : {cartItemCount} article{cartItemCount > 1 ? "s" : ""} · {total.toFixed(2)} €
            </span>
            <span className="flex items-center gap-1 text-sm font-semibold">
              Encaisser
              <ChevronDown size={16} />
            </span>
          </button>
        )}
      </section>

    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <section id="counter-basket" className="scroll-mt-4 space-y-5 rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <h2 className="text-lg font-bold text-dark dark:text-white">Panier</h2>

        {loadingSourceOrder && (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-500 dark:border-dark-3">
            <Loader2 size={15} className="animate-spin" />
            Chargement de la commande…
          </div>
        )}

        {sourceOrder && (
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            <div className="min-w-0">
              <p className="font-semibold">Commande n°{sourceOrder.orderNumber} reprise à la caisse</p>
              <p className="mt-0.5 text-xs">
                Ajoutez ou retirez des articles, puis encaissez en espèces ou au terminal. La commande d&apos;origine
                sera clôturée et remplacée par cette vente.
                {sourceOrder.discountAmount > 0 &&
                  ` Attention : sa remise de ${sourceOrder.discountAmount.toFixed(2)} € n'est pas reprise — les articles sont au prix en boutique.`}
              </p>
            </div>
            <button
              type="button"
              onClick={releaseSourceOrder}
              disabled={isPending}
              className="shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:bg-transparent dark:text-amber-300"
            >
              Ne plus reprendre
            </button>
          </div>
        )}

        {canInvoiceSale && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-gray-500 dark:text-dark-6">
              Prestation, frais ou forfait hors catalogue : ajoutez une ligne libre (vente avec facture).
            </p>
            <button
              type="button"
              onClick={addFreeLine}
              disabled={isWalkIn || Boolean(sourceOrder)}
              title={isWalkIn ? "Indisponible en mode client de passage : une ligne libre exige une facture" : sourceOrder ? "Indisponible sur une commande reprise" : undefined}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-[#2f3a2e] px-3 text-xs font-semibold text-[#2f3a2e] transition-colors hover:bg-[#2f3a2e]/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={14} />
              Ligne libre
            </button>
          </div>
        )}

        {cart.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 px-5 py-12 text-center text-sm text-gray-500">Le panier est vide.</div>
        ) : (
          <div className="divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-dark-3 dark:border-dark-3">
            {cart.map((item) => item.type === "FREE" ? (
              <div key={item.key} className="flex flex-wrap items-center gap-3 p-3">
                <input
                  value={item.description}
                  onChange={(event) => updateFreeLine(item.key, { description: event.target.value })}
                  maxLength={200}
                  placeholder="Description (ex. Formation privée — 2 h)"
                  aria-label="Description de la ligne libre"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                />
                <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-1 dark:border-dark-3">
                  <button type="button" onClick={() => changeQuantity(item.key, -1)} aria-label="Diminuer la quantité" className="rounded p-1 hover:bg-gray-100 dark:hover:bg-dark-2"><Minus size={14} /></button>
                  <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                  <button type="button" onClick={() => changeQuantity(item.key, 1)} disabled={item.quantity >= item.availableQuantity} aria-label="Augmenter la quantité" className="rounded p-1 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-dark-2"><Plus size={14} /></button>
                </div>
                <label className="flex items-center gap-1 text-xs text-gray-500">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(event) => updateFreeLine(item.key, { unitPrice: event.target.value })}
                    aria-label="Prix unitaire TTC"
                    placeholder="Prix TTC"
                    className="h-9 w-24 rounded-lg border border-gray-200 px-2 text-right text-sm text-dark outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                  />
                  €
                </label>
                <p className="w-20 text-right text-sm font-semibold text-gray-900 dark:text-white">{(Number(item.unitPrice || 0) * item.quantity).toFixed(2)} €</p>
                <button type="button" onClick={() => changeQuantity(item.key, -item.quantity)} aria-label="Supprimer la ligne" className="text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
              </div>
            ) : (
              <div key={item.key} className={`flex flex-wrap items-center gap-3 p-3 ${item.quantity > item.availableQuantity ? "bg-red-50 dark:bg-red-500/10" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{item.productName}</p>
                  <p className="text-xs text-gray-500">{item.variantName} · {item.unitPrice.toFixed(2)} €</p>
                  {item.quantity > item.availableQuantity && (
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-red-700 dark:text-red-300">
                      <AlertTriangle size={13} />
                      {item.availableQuantity <= 0
                        ? "Plus disponible — vendu ou réservé en ligne entre-temps."
                        : `Plus que ${item.availableQuantity} disponible(s) — vendu ou réservé en ligne entre-temps.`}
                      <button
                        type="button"
                        onClick={() => fitLineToStock(item.key)}
                        className="rounded-md border border-red-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-100 dark:bg-transparent"
                      >
                        {item.availableQuantity <= 0 ? "Retirer du panier" : `Passer à ${item.availableQuantity}`}
                      </button>
                    </p>
                  )}
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
        <CounterBuyerForm
          customer={customer}
          updateCustomer={updateCustomer}
          updateCustomerAddress={updateCustomerAddress}
          updateCustomerVat={updateCustomerVat}
          isWalkIn={isWalkIn}
          toggleWalkIn={toggleWalkIn}
          walkInEmail={walkInEmail}
          setWalkInEmail={setWalkInEmail}
          walkInEmailMatch={walkInEmailMatch}
          useMatchedAccountInstead={useMatchedAccountInstead}
          matches={matches}
          selectCustomer={selectCustomer}
          vatCheck={vatCheck}
          handleVerifyVat={handleVerifyVat}
          needsAddress={needsAddress}
          willHaveVatInvoice={willHaveVatInvoice}
          willBeBelgianB2B={willBeBelgianB2B}
          collectWalkInEmail={collectWalkInEmail}
          onCollectWalkInEmailChange={setCollectWalkInEmail}
          invoiceRequested={invoiceRequested}
          onInvoiceRequestedChange={setInvoiceRequested}
          // An invoice sale always ends in an invoice: no anonymous client,
          // no opting out of it.
          allowWalkIn={!invoiceFlow}
          showInvoiceOptOut={!invoiceFlow}
        />

        {invoiceFlow && (
          <div className="flex items-start gap-2 rounded-lg border border-[#2f3a2e]/20 bg-[#f4f7f3] px-3 py-2.5 text-xs text-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6">
            <FileText size={15} className="mt-0.5 shrink-0" />
            <p>
              <span className="font-semibold">Vente avec facture</span> — numéro de TVA du client obligatoire.{" "}
              {issuesInvoiceNow
                ? "La facture est émise à l'encaissement."
                : "La facture ne sera émise qu'au paiement complet, depuis « Ventes en attente de paiement »."}
            </p>
          </div>
        )}

        {canInvoiceSale && !isWalkIn && !sourceOrder && (
          <label className="block text-xs font-medium text-gray-500 dark:text-dark-6">
            Commentaire imprimé sur la facture (facultatif)
            <textarea
              value={invoiceNotes}
              onChange={(event) => setInvoiceNotes(event.target.value.slice(0, MANUAL_INVOICE_NOTES_MAX))}
              rows={2}
              placeholder="Ex. Prestation réalisée le 18/09 dans vos locaux."
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-dark outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </label>
        )}

        <div className="space-y-2 border-t border-gray-100 pt-5 dark:border-dark-3">
          {canInvoiceSale && !isWalkIn && !sourceOrder && (
            <>
              <p className="text-sm font-medium text-gray-700 dark:text-dark-6">Règlement</p>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Règlement de la vente">
                {[
                  ["NOW", "Payé maintenant"],
                  ["DEPOSIT", "Acompte"],
                  ["LATER", "Payer plus tard"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={settleMode === value}
                    onClick={() => setSettleMode(value)}
                    className={`rounded-lg border p-2.5 text-sm font-medium ${settleMode === value ? "border-[#2f3a2e] bg-[#2f3a2e]/5 text-[#2f3a2e]" : "border-gray-200 text-gray-600 dark:border-dark-3"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {settleMode === "DEPOSIT" && (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-900/10">
                  <label className="block text-xs font-medium text-gray-600 dark:text-dark-6" htmlFor="pos-deposit">Montant de l&apos;acompte (TTC)</label>
                  <div className="flex gap-2">
                    <input
                      id="pos-deposit"
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      value={depositInput}
                      onChange={(event) => setDepositInput(event.target.value)}
                      placeholder="0.00"
                      className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                    />
                    {[30, 50].map((percent) => (
                      <button
                        key={percent}
                        type="button"
                        disabled={total <= 0}
                        onClick={() => setDepositInput((Math.round(total * percent) / 100).toFixed(2))}
                        className="shrink-0 rounded-lg border border-amber-300 bg-white px-2.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                      >
                        {percent} %
                      </button>
                    ))}
                  </div>
                  {depositInput !== "" && !depositValid && (
                    <p className="text-xs font-medium text-red-600">L&apos;acompte doit être supérieur à 0 et inférieur au total.</p>
                  )}
                </div>
              )}
              {(settleMode !== "NOW" || transferAwaited) && (
                <label className="block text-xs font-medium text-gray-500 dark:text-dark-6">
                  Échéance du solde (facultatif)
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                  />
                </label>
              )}
            </>
          )}

          {collectsNow && (
            <>
              <p className="pt-2 text-sm font-medium text-gray-700 dark:text-dark-6">
                {invoiceFlow && settleMode === "DEPOSIT" ? "Paiement de l'acompte" : "Paiement encaissé"}
              </p>
              <CounterPaymentMethodTiles
                label=""
                methods={canInvoiceSale ? ["CARD_QR", "CASH", "EXTERNAL_TERMINAL", "TRANSFER"] : ["CARD_QR", "CASH", "EXTERNAL_TERMINAL"]}
                value={method}
                onChange={selectMethod}
                disabled={{
                  CARD_QR: isWalkIn
                    ? "Indisponible en mode client de passage"
                    : sourceOrder
                    ? "Une commande reprise se règle en espèces ou au terminal"
                    : invoiceFlow
                    ? "Indisponible pour une vente avec facture"
                    : tillClosed
                    ? "Caisse fermée"
                    : undefined,
                  CASH: tillClosed ? "Caisse fermée" : undefined,
                  EXTERNAL_TERMINAL: tillClosed ? "Caisse fermée" : undefined,
                  // A transfer never touches the drawer, so a closed till
                  // does not block it — see allowedWhileClosed.
                  TRANSFER: isWalkIn
                    ? "Indisponible en mode client de passage : un virement exige une facture"
                    : sourceOrder
                    ? "Une commande reprise se règle en espèces ou au terminal"
                    : undefined,
                }}
              />
              {method === "CASH" && (
                <CounterCashReceived id="pos-cash-received" value={cashReceived} onChange={setCashReceived} amountDue={collectedNow} />
              )}
              {method === "TRANSFER" && (
                <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-900/10 dark:text-sky-200">
                  <p className="font-semibold">Virement en attente de validation</p>
                  <p className="mt-1">
                    La vente est enregistrée sans paiement. Quand le virement arrive sur le compte, cliquez « Virement reçu » dans « Ventes en
                    attente de paiement » et saisissez sa référence : c&apos;est seulement là qu&apos;il est accepté et que la facture est émise.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {!invoiceFlow && cart.length > 0 && (
          <div className="border-t border-gray-100 pt-4 dark:border-dark-3">
            <PromoCodeField
              key={promoFieldKey}
              subtotal={cartSubtotal}
              context={promoContext}
              validate={previewCounterPromoCode}
              onApplied={setPromo}
            />
          </div>
        )}

        <div className="space-y-1 border-t border-gray-100 pt-5 dark:border-dark-3">
          {appliedPromo && (
            <>
              <div className="flex justify-between text-sm text-gray-500"><span>Sous-total</span><span>{cartSubtotal.toFixed(2)} €</span></div>
              <div className="flex justify-between text-sm text-emerald-700"><span>Code {appliedPromo.code}</span><span>−{Number(appliedPromo.discountAmount).toFixed(2)} €</span></div>
              {appliedPromo.appliedRules?.map((rule) => (
                <div key={rule.label} className="flex justify-between gap-3 pl-3 text-xs text-emerald-700/80"><span>{rule.label}</span><span>−{Number(rule.discountAmount).toFixed(2)} €</span></div>
              ))}
            </>
          )}
          <div className="flex items-end justify-between"><span className="text-sm text-gray-500">Total</span><strong className="text-3xl text-[#2f3a2e]">{total.toFixed(2)} €</strong></div>
          {invoiceFlow && (settleMode !== "NOW" || transferAwaited) && (
            <p className="text-right text-sm text-gray-500">
              Encaissé maintenant : <span className="font-semibold text-emerald-700">{collectedNow.toFixed(2)} €</span> · reste{" "}
              {(total - collectedNow).toFixed(2)} €
            </p>
          )}
        </div>
        <Button
          className="w-full"
          onClick={submitSale}
          disabled={
            isPending ||
            !attemptKey ||
            cart.length === 0 ||
            stockConflicts.length > 0 ||
            (isWalkIn && collectWalkInEmail && !walkInEmailReady) ||
            (collectsNow && method === "CASH" && (cashReceived === "" || changeDue < 0)) ||
            (invoiceFlow && (!customer.vatNumber.trim() || (settleMode === "DEPOSIT" && !depositValid))) ||
            (tillClosed && !allowedWhileClosed) ||
            (!isWalkIn && needsAddress && (!customer.addressLine1.trim() || !customer.addressCity.trim() || !customer.addressPostalCode.trim()))
          }
        >
          {isPending
            ? "Enregistrement…"
            : invoiceFlow
            ? issuesInvoiceNow
              ? "Encaisser et émettre la facture"
              : "Enregistrer la vente"
            : method === "CARD_QR"
            ? "Générer le QR de paiement"
            : "Encaisser et envoyer le ticket"}
        </Button>
        {invoiceFlow && !customer.vatNumber.trim() && (
          <p className="text-xs font-medium text-amber-700">Renseignez le numéro de TVA du client : une vente avec facture l&apos;exige.</p>
        )}
        {stockConflicts.length > 0 && (
          <p className="text-xs font-medium text-red-700 dark:text-red-300">
            Un article du panier n&apos;est plus disponible (vendu ou réservé en ligne). Corrigez le panier pour encaisser.
          </p>
        )}
      </aside>
    </div>


      {qrModal && (
        <div role="dialog" aria-modal="true" aria-labelledby="pos-qr-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-4">
          <div className="max-h-[calc(100vh-24px)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 text-center shadow-xl dark:bg-gray-dark sm:p-6">
            <h2 id="pos-qr-title" className="text-xl font-bold text-gray-900 dark:text-white">Paiement par carte</h2>
            <p className="mt-1 text-sm text-gray-500">Scannez ce QR avec le téléphone du client.</p>
            <p className="mt-4 text-3xl font-bold text-[#2f3a2e]">{Number(qrModal.totalAmount ?? total).toFixed(2)} €</p>
            <div className="relative mx-auto mt-5 flex aspect-square w-full max-w-80 items-center justify-center rounded-xl border border-gray-200 bg-white p-3">
              {qrDataUrl ? (
                <Image src={qrDataUrl} alt="QR code Stripe Checkout" fill sizes="320px" unoptimized className="object-contain p-3" />
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

      <ConfirmDialog
        open={Boolean(linkCandidate)}
        title="Associer ce code-barres ?"
        message={linkCandidate ? `Le code ${unknownBarcode} sera enregistré sur « ${linkCandidate.productName}${
          linkCandidate.variantName && linkCandidate.variantName !== "Standard" ? ` — ${linkCandidate.variantName}` : ""
        } ». Vérifiez bien le produit, la contenance et la teinte : chaque prochain scan de ce code ajoutera ce produit.${
          linkCandidate.hasInternalBarcode
            ? " Il remplace son code interne : une étiquette interne déjà imprimée pour ce produit ne sera plus reconnue."
            : ""
        }` : ""}
        confirmLabel={linkCandidate && linkCandidate.availableQuantity > 0 ? "Associer et ajouter" : "Associer"}
        loading={linkingBarcode}
        onConfirm={confirmBarcodeLink}
        onCancel={() => !linkingBarcode && setLinkCandidate(null)}
      />

      <ConfirmDialog
        open={invoiceConfirmOpen}
        title={issuesInvoiceNow ? "Encaisser et émettre la facture ?" : "Enregistrer la vente ?"}
        message={`${customer.fullName || "Client"} — ${total.toFixed(2)} € TTC. ${
          issuesInvoiceNow
            ? "La facture est émise tout de suite ; son numéro est définitif, une erreur ne se corrige ensuite que par une note de crédit."
            : `${
                transferAwaited
                  ? `Virement attendu de ${(settleMode === "DEPOSIT" ? depositAmount : total).toFixed(2)} € : rien n'est enregistré comme payé avant « Virement reçu ».`
                  : settleMode === "DEPOSIT"
                  ? `Acompte de ${collectedNow.toFixed(2)} € encaissé maintenant, solde de ${(total - collectedNow).toFixed(2)} € plus tard.`
                  : "Rien n'est encaissé maintenant."
              } Aucune facture n'est émise avant le paiement complet : la vente rejoint « Ventes en attente de paiement ».`
        }`}
        confirmLabel={issuesInvoiceNow ? "Encaisser et émettre" : "Enregistrer"}
        loading={isPending}
        onConfirm={submitSale}
        onCancel={() => !isPending && setInvoiceConfirmOpen(false)}
      />

      <DocumentDeliveryDialog
        open={Boolean(issuedInvoice)}
        onClose={() => setIssuedInvoice(null)}
        document={issuedInvoice}
        invoice={issuedInvoice}
        kind="INVOICE"
      />
    </div>
    </div>
  );
}
