"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Mail, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { sendInvoiceByEmail } from "@/actions/invoices/send-invoice-email";
import { sendInvoiceToBillit } from "@/actions/invoices/send-invoice-billit";
import { sendCreditNoteByEmail } from "@/actions/invoices/send-credit-note-email";
import { sendCreditNoteToBillit } from "@/actions/invoices/send-credit-note-billit";
import {
  listNotificationRecipients,
  createNotificationRecipient,
  updateNotificationRecipient,
  deleteNotificationRecipient,
} from "@/actions/invoices/notification-recipients";
import { isBelgianVatNumber } from "@/lib/billit";

/**
 * The one explicit delivery choice used throughout Operations. Nothing is
 * sent from a compact table row: the administrator opens this card and
 * deliberately ticks the channels a B2B invoice / credit note should go out
 * on — e-mail, the Belgian Billit/Peppol handoff, or both at once. Nothing
 * is pre-selected.
 *
 * When e-mail is ticked, an internal address book (NotificationRecipient,
 * managed here) is offered alongside an "envoyer aussi au client" toggle:
 * any mix of the two receives the document, and the client's own copy can
 * be omitted when only internal copies are wanted. The client's address is
 * always the one frozen on the document — it is never retyped here.
 */
export function DocumentDeliveryDialog({ open, onClose, document: documentRecord, invoice, kind = "INVOICE", onDelivered }) {
  const closeRef = useRef(null);

  const isCreditNote = kind === "CREDIT_NOTE";
  const label = isCreditNote ? "note de crédit" : "facture";
  const number = documentRecord?.number ?? "";
  const canUseBillit = invoice?.customerType === "B2B" && isBelgianVatNumber(invoice?.customerVatNumber);
  const clientEmail = invoice?.customerEmail?.trim() || "";

  const [emailChecked, setEmailChecked] = useState(false);
  const [billitChecked, setBillitChecked] = useState(false);
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

  useEffect(() => {
    if (!open) return;
    setEmailChecked(false);
    setBillitChecked(false);
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
  }, [open]);

  const selectedEmails = useMemo(
    () => recipients.filter((r) => checkedIds.has(r.id)).map((r) => r.email),
    [recipients, checkedIds],
  );

  const emailHasRecipient = (includeClient && clientEmail) || selectedEmails.length > 0;
  const canSend = !sending && (emailChecked || billitChecked) && (!emailChecked || emailHasRecipient);

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

  async function deliver() {
    if (sending) return;
    setSending(true);
    const outcomes = {};

    if (emailChecked) {
      // Only ask for the client's copy when the document actually carries an
      // address — otherwise the send would reject an internal-only delivery.
      const opts = { extraRecipients: selectedEmails, includeClient: includeClient && Boolean(clientEmail) };
      outcomes.email = await (isCreditNote
        ? sendCreditNoteByEmail(documentRecord.id, opts)
        : sendInvoiceByEmail(documentRecord.id, opts));
    }
    if (billitChecked) {
      outcomes.billit = await (isCreditNote
        ? sendCreditNoteToBillit(documentRecord.id)
        : sendInvoiceToBillit(documentRecord.id));
    }

    setSending(false);
    setConfirming(false);

    const succeeded = [];
    const failed = [];
    if (outcomes.email) {
      if (outcomes.email.success) succeeded.push(outcomes.email.message);
      else failed.push(`E-mail : ${outcomes.email.message}`);
    }
    if (outcomes.billit) {
      if (outcomes.billit.success) succeeded.push(outcomes.billit.message);
      else failed.push(`Billit : ${outcomes.billit.message}`);
    }

    if (succeeded.length) onDelivered?.();

    if (failed.length === 0) {
      toast.success(succeeded.join(" "));
      onClose();
      return;
    }
    if (succeeded.length === 0) {
      toast.error(failed.join(" "));
      return;
    }
    // Partial success: keep the card open, but untick whatever already went
    // out so pressing "Envoyer" again doesn't re-send it.
    toast.error([...succeeded, ...failed].join(" "));
    if (outcomes.email?.success) setEmailChecked(false);
    if (outcomes.billit?.success) setBillitChecked(false);
  }

  return createPortal(
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
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Livraison B2B</p>
            <h2 id="delivery-title" className="mt-1 text-lg font-semibold text-gray-900">
              Envoyer la {label} {number}
            </h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Cochez les canaux d'envoi souhaités — e-mail, Billit/Peppol, ou les deux. Rien n'est envoyé avant votre confirmation.
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

          {/* ── Billit / Peppol channel ────────────────────────────────── */}
          <div className="rounded-xl border border-gray-200">
            <label
              className={`flex items-start gap-3 p-4 ${canUseBillit ? "cursor-pointer" : "cursor-not-allowed"}`}
              title={
                canUseBillit
                  ? "Créer dans Billit pour une livraison Peppol belge"
                  : "Billit / Peppol est réservé aux clients B2B avec TVA belge."
              }
            >
              <input
                type="checkbox"
                checked={billitChecked}
                onChange={(e) => setBillitChecked(e.target.checked)}
                disabled={!canUseBillit || sending}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#2f3a2e] focus:ring-[#2f3a2e]"
              />
              <span>
                <span className="flex items-center gap-2 font-semibold text-gray-900">
                  <Send size={17} className="text-[#2f3a2e]" /> Créer dans Billit / Peppol
                </span>
                <span className="mt-0.5 block text-xs text-gray-500">
                  Disponible uniquement pour une TVA belge; finalisez ensuite l'envoi Peppol dans Billit.
                </span>
              </span>
            </label>
          </div>
        </div>

        {/* ── Confirm / send ───────────────────────────────────────────── */}
        {confirming ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-950">Confirmer l'envoi ?</p>
            {emailChecked && (
              <p className="mt-1 text-xs leading-5 text-amber-900">E-mail à : {recipientSummary || "—"}</p>
            )}
            {billitChecked && (
              <p className="mt-1 text-xs leading-5 text-amber-900">
                Créer dans Billit — vérifiez le client et la TVA. L'envoi Peppol est ensuite finalisé manuellement dans Billit.
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
                {sending && <Loader2 size={13} className="animate-spin" />} Envoyer
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
              <Send size={15} /> Envoyer
            </button>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
