"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Eye, Loader2, Mail, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { sendInvoiceByEmail } from "@/actions/invoices/send-invoice-email";
import { sendInvoiceToPeppyrus } from "@/actions/invoices/send-invoice-peppyrus";
import { sendCreditNoteByEmail } from "@/actions/invoices/send-credit-note-email";
import { sendCreditNoteToPeppyrus } from "@/actions/invoices/send-credit-note-peppyrus";
import { previewInvoicePeppyrusDocument, previewCreditNotePeppyrusDocument } from "@/actions/invoices/preview-peppyrus";
import {
  listNotificationRecipients,
  createNotificationRecipient,
  updateNotificationRecipient,
  deleteNotificationRecipient,
} from "@/actions/invoices/notification-recipients";
import { isBelgianVatNumber } from "@/lib/peppyrus";

/**
 * The one explicit delivery choice used throughout Operations. Nothing is
 * sent from a compact table row: the administrator opens this card and
 * deliberately ticks the channels a B2B invoice / credit note should go out
 * on — e-mail, the Belgian Peppol (Peppyrus) handoff, or both at once.
 * Nothing is pre-selected. Ticking Peppyrus and confirming transmits the
 * document over the live Peppol network immediately — there is no later
 * staging step to catch a mistake, unlike the old Billit integration.
 *
 * When e-mail is ticked, an internal address book (NotificationRecipient,
 * managed here) is offered alongside an "envoyer aussi au client" toggle:
 * any mix of the two receives the document, and the client's own copy can
 * be omitted when only internal copies are wanted. The client's address is
 * always the one frozen on the document — it is never retyped here.
 *
 * `issue` (Factures page, « Émettre la facture » on a staff rent): the
 * document is still a draft — no invoice exists and its number is only the
 * one it should get. The channels are chosen first; confirming issues the
 * invoice (`issue()` resolves `{ success, message, invoice }`) and then sends
 * it. Closing the card before that issues nothing.
 */
export function DocumentDeliveryDialog({ open, onClose, document: draftOrDocument, invoice: draftOrInvoice, kind = "INVOICE", onDelivered, initialChannel = null, issue = null, onIssued }) {
  const closeRef = useRef(null);

  // Once `issue()` has run, the card works on the real invoice.
  const [issued, setIssued] = useState(null);
  const documentRecord = issued ?? draftOrDocument;
  const invoice = issued ?? draftOrInvoice;
  const pendingIssue = Boolean(issue) && !issued;

  const isCreditNote = kind === "CREDIT_NOTE";
  const label = isCreditNote ? "note de crédit" : "facture";
  const number = documentRecord?.number ?? "";
  const canUsePeppyrus = invoice?.customerType === "B2B" && isBelgianVatNumber(invoice?.customerVatNumber);
  const clientEmail = invoice?.customerEmail?.trim() || "";

  const [emailChecked, setEmailChecked] = useState(false);
  const [peppyrusChecked, setPeppyrusChecked] = useState(false);
  const [includeClient, setIncludeClient] = useState(true);

  const [recipients, setRecipients] = useState([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [recipientsError, setRecipientsError] = useState("");
  const [checkedIds, setCheckedIds] = useState(() => new Set());

  const [adding, setAdding] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [savingNew, setSavingNew] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editEmail, setEditEmail] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewSummary, setPreviewSummary] = useState(null);
  const [previewXml, setPreviewXml] = useState("");
  const [showRawXml, setShowRawXml] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Opérations opens the card with nothing ticked. The Factures page has
    // one explicit button per channel (`initialChannel`), so that click
    // pre-ticks its own channel — the shared confirm step still gates the send.
    setEmailChecked(initialChannel === "EMAIL");
    setPeppyrusChecked(initialChannel === "PEPPYRUS" && canUsePeppyrus);
    setIssued(null);
    setIncludeClient(true);
    setCheckedIds(new Set());
    setAdding(false);
    setNewEmail("");
    setNewLabel("");
    setEditingId(null);
    setPendingDeleteId(null);
    setConfirming(false);
    setSending(false);
    setRecipientsError("");
    setPreviewOpen(false);
    setPreviewLoading(false);
    setPreviewError("");
    setPreviewSummary(null);
    setPreviewXml("");
    setShowRawXml(false);

    let cancelled = false;
    setLoadingRecipients(true);
    listNotificationRecipients()
      .then((res) => {
        if (cancelled) return;
        if (res?.success) setRecipients(res.data ?? []);
        else setRecipientsError(res?.message ?? "Impossible de charger la liste d'adresses.");
      })
      .catch(() => !cancelled && setRecipientsError("Impossible de charger la liste d'adresses."))
      .finally(() => !cancelled && setLoadingRecipients(false));

    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the card opens
  }, [open, initialChannel]);

  const selectedEmails = useMemo(
    () => recipients.filter((r) => checkedIds.has(r.id)).map((r) => r.email),
    [recipients, checkedIds],
  );

  const emailHasRecipient = (includeClient && clientEmail) || selectedEmails.length > 0;
  const canSend = !sending && (emailChecked || peppyrusChecked) && (!emailChecked || emailHasRecipient);

  if (!open || !documentRecord || typeof documentRecord.id !== "string") return null;

  const recipientSummary = [
    includeClient && clientEmail ? `${clientEmail} (client)` : null,
    ...selectedEmails,
  ]
    .filter(Boolean)
    .join(", ");

  function toggleId(id) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submitNew() {
    if (savingNew) return;
    setSavingNew(true);
    const res = await createNotificationRecipient({ email: newEmail, label: newLabel || null });
    setSavingNew(false);
    if (res?.success && res.data) {
      setRecipients((prev) => [...prev, res.data].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)));
      setCheckedIds((prev) => new Set(prev).add(res.data.id));
      setAdding(false);
      setNewEmail("");
      setNewLabel("");
      toast.success(res.message);
    } else toast.error(res?.message ?? "Impossible d'ajouter cette adresse.");
  }

  function startEdit(recipient) {
    setEditingId(recipient.id);
    setEditEmail(recipient.email);
    setEditLabel(recipient.label ?? "");
    setPendingDeleteId(null);
  }

  async function submitEdit() {
    if (savingEdit) return;
    setSavingEdit(true);
    const res = await updateNotificationRecipient(editingId, { email: editEmail, label: editLabel || null });
    setSavingEdit(false);
    if (res?.success && res.data) {
      setRecipients((prev) => prev.map((r) => (r.id === res.data.id ? res.data : r)));
      setEditingId(null);
      toast.success(res.message);
    } else toast.error(res?.message ?? "Impossible de modifier cette adresse.");
  }

  async function confirmDelete(id) {
    if (deleteBusy) return;
    setDeleteBusy(true);
    const res = await deleteNotificationRecipient(id);
    setDeleteBusy(false);
    if (res?.success) {
      setRecipients((prev) => prev.filter((r) => r.id !== id));
      setCheckedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setPendingDeleteId(null);
      toast.success(res.message);
    } else toast.error(res?.message ?? "Impossible de supprimer cette adresse.");
  }

  async function openPreview() {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewSummary(null);
    setPreviewXml("");
    const res = await (isCreditNote
      ? previewCreditNotePeppyrusDocument(documentRecord.id)
      : previewInvoicePeppyrusDocument(documentRecord.id));
    setPreviewLoading(false);
    if (res?.success) {
      setPreviewSummary(res.summary);
      setPreviewXml(res.xml);
    } else {
      setPreviewError(res?.message ?? "Impossible de générer l'aperçu du document.");
    }
  }

  async function deliver() {
    if (sending) return;
    setSending(true);
    const outcomes = {};

    // A draft is issued now — only now, the channels being confirmed.
    let documentId = documentRecord.id;
    let issuedNumber = null;
    if (pendingIssue) {
      const result = await issue();
      if (!result?.success || !result.invoice?.id) {
        setSending(false);
        setConfirming(false);
        toast.error(result?.message ?? "Facture non émise.");
        return;
      }
      setIssued(result.invoice);
      onIssued?.(result.invoice);
      documentId = result.invoice.id;
      issuedNumber = result.invoice.number;
    }

    if (emailChecked) {
      // Only ask for the client's copy when the document actually carries an
      // address — otherwise the send would reject an internal-only delivery.
      const opts = { extraRecipients: selectedEmails, includeClient: includeClient && Boolean(clientEmail) };
      outcomes.email = await (isCreditNote
        ? sendCreditNoteByEmail(documentId, opts)
        : sendInvoiceByEmail(documentId, opts));
    }
    if (peppyrusChecked) {
      outcomes.peppyrus = await (isCreditNote
        ? sendCreditNoteToPeppyrus(documentId)
        : sendInvoiceToPeppyrus(documentId));
    }

    setSending(false);
    setConfirming(false);

    const succeeded = [];
    const failed = [];
    if (outcomes.email) {
      if (outcomes.email.success) succeeded.push(outcomes.email.message);
      else failed.push(`E-mail : ${outcomes.email.message}`);
    }
    if (outcomes.peppyrus) {
      if (outcomes.peppyrus.success) succeeded.push(outcomes.peppyrus.message);
      else failed.push(`Peppyrus : ${outcomes.peppyrus.message}`);
    }

    if (succeeded.length) onDelivered?.();

    if (failed.length === 0) {
      toast.success(succeeded.join(" "));
      onClose();
      return;
    }
    if (succeeded.length === 0) {
      // Issued but not sent: the card stays open on the real invoice to retry.
      toast.error(issuedNumber ? `Facture ${issuedNumber} émise, mais non envoyée — ${failed.join(" ")}` : failed.join(" "));
      return;
    }
    // Partial success: keep the card open, but untick whatever already went
    // out so pressing "Envoyer" again doesn't re-send it.
    toast.error([...succeeded, ...failed].join(" "));
    if (outcomes.email?.success) setEmailChecked(false);
    if (outcomes.peppyrus?.success) setPeppyrusChecked(false);
  }

  return (
    <>
    {createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={(event) => event.target === event.currentTarget && !sending && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-title"
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
              {pendingIssue ? "Émission et envoi" : "Livraison B2B"}
            </p>
            <h2 id="delivery-title" className="mt-1 text-lg font-semibold text-gray-900">
              {pendingIssue ? `Émettre et envoyer la facture ${number}` : `Envoyer la ${label} ${number}`}
            </h2>
            {pendingIssue && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                Pas encore émise : choisissez d'abord comment l'envoyer. La facture reçoit son numéro (prévu : {number}) à la
                confirmation, puis part aussitôt. Elle reste « en attente de paiement » jusqu'à ce que vous l'acceptiez.
              </p>
            )}
            <p className="mt-2 text-sm leading-6 text-gray-600">
              {canUsePeppyrus
                ? "Cochez les canaux d'envoi souhaités — e-mail, Peppol (Peppyrus), ou les deux. Rien n'est envoyé avant votre confirmation."
                : "Cochez pour envoyer le document par e-mail. Rien n'est envoyé avant votre confirmation."}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={sending}
            aria-label="Fermer"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 flex-1 space-y-3 overflow-y-auto">
          {/* ── E-mail channel ─────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-200">
            <label className="flex cursor-pointer items-start gap-3 p-4">
              <input
                type="checkbox"
                checked={emailChecked}
                onChange={(e) => setEmailChecked(e.target.checked)}
                disabled={sending}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#2f3a2e] focus:ring-[#2f3a2e]"
              />
              <span>
                <span className="flex items-center gap-2 font-semibold text-gray-900">
                  <Mail size={17} className="text-[#2f3a2e]" /> Envoyer par e-mail
                </span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  Le PDF est envoyé au client et/ou aux adresses internes choisies ci-dessous.
                </span>
              </span>
            </label>

            {emailChecked && (
              <div className="border-t border-gray-100 px-4 py-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={includeClient && Boolean(clientEmail)}
                    onChange={(e) => setIncludeClient(e.target.checked)}
                    disabled={sending || !clientEmail}
                    className="h-4 w-4 rounded border-gray-300 text-[#2f3a2e] focus:ring-[#2f3a2e]"
                  />
                  {clientEmail ? (
                    <span>
                      Envoyer aussi au client <span className="text-gray-500">({clientEmail})</span>
                    </span>
                  ) : (
                    <span className="text-gray-400">Aucune adresse client sur le document</span>
                  )}
                </label>

                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Adresses internes</p>

                {loadingRecipients && (
                  <p className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 size={13} className="animate-spin" /> Chargement…
                  </p>
                )}
                {recipientsError && <p className="mt-2 text-xs text-red-600">{recipientsError}</p>}

                {!loadingRecipients && !recipientsError && (
                  <ul className="mt-2 space-y-1">
                    {recipients.length === 0 && (
                      <li className="text-xs text-gray-400">Aucune adresse enregistrée.</li>
                    )}
                    {recipients.map((recipient) => (
                      <li key={recipient.id} className="group rounded-lg px-1 py-1 hover:bg-gray-50">
                        {editingId === recipient.id ? (
                          <div className="flex flex-col gap-2 p-1">
                            <input
                              type="email"
                              value={editEmail}
                              onChange={(e) => setEditEmail(e.target.value)}
                              placeholder="adresse@exemple.com"
                              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                            />
                            <input
                              type="text"
                              value={editLabel}
                              onChange={(e) => setEditLabel(e.target.value)}
                              placeholder="Libellé (facultatif)"
                              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                disabled={savingEdit}
                                className="rounded-md px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                              >
                                Annuler
                              </button>
                              <button
                                type="button"
                                onClick={submitEdit}
                                disabled={savingEdit}
                                className="inline-flex items-center gap-1 rounded-md bg-[#2f3a2e] px-2 py-1 text-xs font-semibold text-white hover:bg-[#1f291f] disabled:opacity-50"
                              >
                                {savingEdit && <Loader2 size={12} className="animate-spin" />} Enregistrer
                              </button>
                            </div>
                          </div>
                        ) : pendingDeleteId === recipient.id ? (
                          <div className="flex items-center justify-between gap-2 p-1 text-xs">
                            <span className="text-amber-900">Supprimer {recipient.email} ?</span>
                            <span className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => setPendingDeleteId(null)}
                                disabled={deleteBusy}
                                className="rounded-md px-2 py-1 font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                              >
                                Annuler
                              </button>
                              <button
                                type="button"
                                onClick={() => confirmDelete(recipient.id)}
                                disabled={deleteBusy}
                                className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                              >
                                {deleteBusy && <Loader2 size={12} className="animate-spin" />} Confirmer
                              </button>
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={checkedIds.has(recipient.id)}
                                onChange={() => toggleId(recipient.id)}
                                disabled={sending}
                                className="h-4 w-4 rounded border-gray-300 text-[#2f3a2e] focus:ring-[#2f3a2e]"
                              />
                              <span className="truncate">
                                {recipient.email}
                                {recipient.label ? <span className="ml-1 text-gray-400">· {recipient.label}</span> : null}
                              </span>
                            </label>
                            <span className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                type="button"
                                onClick={() => startEdit(recipient)}
                                aria-label={`Modifier ${recipient.email}`}
                                className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setPendingDeleteId(recipient.id);
                                  setEditingId(null);
                                }}
                                aria-label={`Supprimer ${recipient.email}`}
                                className="rounded p-1 text-gray-400 hover:bg-red-100 hover:text-red-700"
                              >
                                <Trash2 size={13} />
                              </button>
                            </span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {adding ? (
                  <div className="mt-2 flex flex-col gap-2 rounded-lg border border-gray-200 p-2">
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="adresse@exemple.com"
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                    />
                    <input
                      type="text"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder="Libellé (facultatif)"
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setAdding(false);
                          setNewEmail("");
                          setNewLabel("");
                        }}
                        disabled={savingNew}
                        className="rounded-md px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={submitNew}
                        disabled={savingNew}
                        className="inline-flex items-center gap-1 rounded-md bg-[#2f3a2e] px-2 py-1 text-xs font-semibold text-white hover:bg-[#1f291f] disabled:opacity-50"
                      >
                        {savingNew ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Ajouter
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#2f3a2e] hover:underline"
                  >
                    <Plus size={13} /> Ajouter une adresse
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Peppol (Peppyrus) channel ─────────────────────────────── */}
          {/* Only offered for a Belgian B2B customer — the same rule the
              server enforces. Hidden (not merely disabled) for anyone else so
              the card shows a single, unambiguous channel. */}
          {canUsePeppyrus && (
          <div className="rounded-xl border border-gray-200">
            <label
              className="flex cursor-pointer items-start gap-3 p-4"
              title="Envoyer sur le réseau Peppol via Peppyrus"
            >
              <input
                type="checkbox"
                checked={peppyrusChecked}
                onChange={(e) => setPeppyrusChecked(e.target.checked)}
                disabled={sending}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#2f3a2e] focus:ring-[#2f3a2e]"
              />
              <span>
                <span className="flex items-center gap-2 font-semibold text-gray-900">
                  <Send size={17} className="text-[#2f3a2e]" /> Envoyer via Peppol (Peppyrus)
                </span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  Disponible uniquement pour une TVA belge; l'envoi transmet immédiatement le document sur le réseau Peppol réel.
                </span>
              </span>
            </label>
            {/* The Peppol document is built from an issued invoice only. */}
            {!pendingIssue && (
            <div className="border-t border-gray-100 px-4 py-2">
              <button
                type="button"
                onClick={openPreview}
                disabled={sending}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2f3a2e] hover:underline disabled:opacity-50"
              >
                <Eye size={14} /> Aperçu du document avant envoi
              </button>
            </div>
            )}
          </div>
          )}
        </div>

        {/* ── Confirm / send ───────────────────────────────────────────── */}
        {confirming ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-950">
              {pendingIssue ? `Émettre la facture ${number} et l'envoyer ?` : "Confirmer l'envoi ?"}
            </p>
            {emailChecked && (
              <p className="mt-1 text-xs leading-5 text-amber-900">E-mail à : {recipientSummary || "—"}</p>
            )}
            {peppyrusChecked && (
              <p className="mt-1 text-xs leading-5 text-amber-900">
                Cet envoi transmet immédiatement le document sur le réseau Peppol réel — vérifiez le client et la TVA avant de confirmer.
              </p>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={sending}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-amber-100 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={deliver}
                disabled={sending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2f3a2e] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1f291f] disabled:opacity-50"
              >
                {sending && <Loader2 size={13} className="animate-spin" />} {pendingIssue ? "Émettre et envoyer" : "Envoyer"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={!canSend}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f291f] disabled:opacity-40"
            >
              <Send size={15} /> {pendingIssue ? "Émettre et envoyer" : "Envoyer"}
            </button>
          </div>
        )}
      </section>
    </div>,
    document.body,
    )}
    {previewOpen &&
      createPortal(
        <div
          className="fixed inset-0 z-70 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={(event) => event.target === event.currentTarget && setPreviewOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-title"
            className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Aperçu — rien n'est envoyé</p>
                <h2 id="preview-title" className="mt-1 text-lg font-semibold text-gray-900">
                  Document Peppol {number}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                aria-label="Fermer l'aperçu"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto">
              {previewLoading && (
                <p className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 size={15} className="animate-spin" /> Génération de l'aperçu…
                </p>
              )}

              {!previewLoading && previewError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  {previewError}
                </div>
              )}

              {!previewLoading && previewSummary && (
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-gray-200 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Émetteur</p>
                      <p className="mt-1 font-semibold text-gray-900">{previewSummary.seller.name}</p>
                      <p className="text-xs text-gray-600">{previewSummary.seller.address}</p>
                      <p className="mt-1 text-xs text-gray-600">TVA : {previewSummary.seller.vatNumber}</p>
                      <p className="text-xs text-gray-600">N° entreprise : {previewSummary.seller.companyRegistrationNo}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Client</p>
                      <p className="mt-1 font-semibold text-gray-900">{previewSummary.buyer.name}</p>
                      <p className="text-xs text-gray-600">{previewSummary.buyer.address}</p>
                      <p className="mt-1 text-xs text-gray-600">TVA : {previewSummary.buyer.vatNumber}</p>
                      <p className="text-xs text-gray-600">N° entreprise : {previewSummary.buyer.companyRegistrationNo}</p>
                      <p className="mt-1 truncate text-xs text-gray-500" title={previewSummary.buyer.peppolParticipantId}>
                        Peppol : {previewSummary.buyer.peppolParticipantId}
                      </p>
                      {previewSummary.buyer.recipientWarning && (
                        <p className="mt-1 text-xs font-medium text-amber-700">{previewSummary.buyer.recipientWarning}</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-200 text-gray-500">
                          <th className="p-2 text-left font-semibold">Description</th>
                          <th className="p-2 text-right font-semibold">Qté</th>
                          <th className="p-2 text-right font-semibold">PU HT</th>
                          <th className="p-2 text-right font-semibold">TVA</th>
                          <th className="p-2 text-right font-semibold">Total HT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewSummary.lines.map((line, i) => (
                          <tr key={i} className="border-b border-gray-100 last:border-0">
                            <td className="p-2 text-gray-800">{line.description}</td>
                            <td className="p-2 text-right text-gray-600">{line.quantity}</td>
                            <td className="p-2 text-right text-gray-600">{line.unitPriceExclVat.toFixed(2)} €</td>
                            <td className="p-2 text-right text-gray-600">{line.vatRate}%</td>
                            <td className="p-2 text-right text-gray-800">{line.lineTotalExclVat.toFixed(2)} €</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="space-y-1 border-t border-gray-200 p-3 text-right text-xs">
                      <p className="text-gray-600">Sous-total HT : {previewSummary.subtotalExclVat.toFixed(2)} €</p>
                      <p className="text-gray-600">TVA ({previewSummary.vatRate}%) : {previewSummary.vatAmount.toFixed(2)} €</p>
                      <p className="font-semibold text-gray-900">Total TTC : {previewSummary.totalInclVat.toFixed(2)} €</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 p-3 text-xs text-gray-600">
                    <p>Référence acheteur : {previewSummary.buyerReference}</p>
                    {previewSummary.dueDate ? (
                      <p>Échéance : {previewSummary.dueDate}</p>
                    ) : (
                      <p>Conditions de paiement : {previewSummary.paymentTermsNote}</p>
                    )}
                    {previewSummary.relatesToInvoiceNumber && (
                      <p>Facture d'origine : {previewSummary.relatesToInvoiceNumber}</p>
                    )}
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => setShowRawXml((v) => !v)}
                      className="text-xs font-semibold text-[#2f3a2e] hover:underline"
                    >
                      {showRawXml ? "Masquer le XML brut" : "Afficher le XML brut (UBL)"}
                    </button>
                    {showRawXml && (
                      <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-gray-900 p-3 text-[10px] leading-4 text-gray-100">
                        {previewXml}
                      </pre>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f291f]"
              >
                Fermer
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
