"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/lib/api-client";
import { renderCampaignContent } from "@/lib/campaigns/render-content";

const STATUS_LABELS = {
  DRAFT: "Brouillon",
  SCHEDULED: "Planifiée",
  SENT: "Envoyée",
  CANCELLED: "Annulée",
};

export function CampaignsClient() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showWizard, setShowWizard] = useState(false);
  const [sendingId, setSendingId] = useState(null);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const json = await fetchJson("/api/campaigns");
      if (!json?.success) throw new Error(json?.message || "Chargement impossible.");
      setCampaigns(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  async function handleSend(id) {
    if (!confirm("Envoyer cette campagne maintenant à tout le segment ?")) return;
    setSendingId(id);
    try {
      const json = await fetchJson(`/api/campaigns/${id}/send`, { method: "POST" });
      alert(json?.message || (json?.success ? "Campagne envoyée." : "Échec de l'envoi."));
      await fetchCampaigns();
    } catch (err) {
      alert(err.message);
    } finally {
      setSendingId(null);
    }
  }

  async function handleDelete(id, title) {
    if (!confirm(`Supprimer la campagne « ${title} » ? (impossible si déjà envoyée)`)) return;
    try {
      const json = await fetchJson(`/api/campaigns/${id}`, { method: "DELETE" });
      if (!json?.success) throw new Error(json?.message || "Suppression impossible.");
      await fetchCampaigns();
    } catch (err) {
      alert(err.message);
    }
  }

  const totals = campaigns.reduce(
    (acc, c) => ({
      count: acc.count + 1,
      sent: acc.sent + (c.totalSenders || 0),
      opened: acc.opened + (c.openedCount || 0),
      clicked: acc.clicked + (c.clickedCount || 0),
    }),
    { count: 0, sent: 0, opened: 0, clicked: 0 }
  );
  const avgOpenRate = totals.sent > 0 ? Math.round((totals.opened / totals.sent) * 1000) / 10 : 0;

  return (
    <div className="space-y-6">
      {/* Statistiques */}
      <div className="flex flex-wrap items-center gap-3">
        <StatBadge label="Campagnes" value={totals.count} color="bg-[rgba(47,58,46,0.08)] text-[#2f3a2e] dark:bg-[#FFFFFF1A] dark:text-white" />
        <StatBadge label="E-mails envoyés" value={totals.sent} color="bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" />
        <StatBadge label="Ouvertures" value={totals.opened} color="bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400" />
        <StatBadge label="Clics" value={totals.clicked} color="bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400" />
        <StatBadge label="Taux ouv. moyen" value={`${avgOpenRate} %`} color="bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400" />
        <div className="ml-auto">
          <button
            onClick={() => setShowWizard(true)}
            className="h-10 rounded-lg bg-[#2f3a2e] px-4 text-sm font-semibold text-white hover:bg-[#3d4d3c]"
          >
            + Nouvelle campagne
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark">
        <div className="divide-y divide-stroke dark:divide-dark-3">
          {loading ? (
            <p className="px-6 py-10 text-center text-sm text-gray-500">Chargement…</p>
          ) : campaigns.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-gray-500">
              Aucune campagne. Créez votre première campagne avec le bouton ci-dessus.
            </p>
          ) : (
            campaigns.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 px-6 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-dark dark:text-white">{c.title}</p>
                  <p className="truncate text-xs text-gray-500">
                    {c.subject} · Segment : {c.targetSegment}
                    {c.sentAt ? ` · Envoyée le ${new Date(c.sentAt).toLocaleDateString("fr-BE")}` : ""}
                    {c.status === "SCHEDULED" && c.scheduledDate
                      ? ` · Planifiée le ${new Date(c.scheduledDate).toLocaleString("fr-BE")}`
                      : ""}
                  </p>
                  {c.status === "SENT" && (
                    <p className="mt-1 text-xs font-medium text-gray-500">
                      👁️ {c.openedCount}/{c.totalSenders} ouvertures ({c.openRate} %) · 👆 {c.clickedCount} clics ({c.clickRate} %)
                    </p>
                  )}
                  {c.status === "SCHEDULED" && (c.totalSenders || 0) > 0 && (
                    <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                      ⏳ File d'attente : {c.sentCount || 0}/{c.totalSenders} envoyés
                      {c.scheduledDate ? ` · reprise auto le ${new Date(c.scheduledDate).toLocaleDateString("fr-BE")}` : ""}
                    </p>
                  )}
                </div>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700 dark:bg-dark-2 dark:text-dark-6">
                  {STATUS_LABELS[c.status] ?? c.status}
                </span>
                {(c.status === "DRAFT" || c.status === "SCHEDULED") && (
                  <button
                    disabled={sendingId === c.id}
                    onClick={() => handleSend(c.id)}
                    className="rounded-lg bg-[#2f3a2e] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {sendingId === c.id ? "Envoi…" : "Envoyer"}
                  </button>
                )}
                {c.status !== "SENT" && (
                  <button
                    onClick={() => handleDelete(c.id, c.title)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:hover:bg-red-900/10"
                  >
                    Supprimer
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {showWizard && (
        <CampaignWizard
          onClose={() => setShowWizard(false)}
          onDone={() => {
            setShowWizard(false);
            fetchCampaigns();
          }}
        />
      )}
    </div>
  );
}

const EMPTY_FORM = {
  title: "",
  subject: "",
  preheader: "",
  content: "",
  imageUrl: "",
  attachmentUrl: "",
  targetSegment: "newsletter",
  ctaText: "Découvrir",
  ctaUrl: "",
  utmCampaign: "",
  scheduledDate: "",
};

function CampaignWizard({ onClose, onDone }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(EMPTY_FORM);
  const [counts, setCounts] = useState(null);
  const [segments, setSegments] = useState([]);
  const [previewEmails, setPreviewEmails] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchJson("/api/campaigns/audience-counts")
      .then((json) => {
        if (json?.success) {
          setCounts(json.data.counts);
          setSegments(json.data.segments);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPreviewEmails(null);
    fetchJson(`/api/campaigns/segment-emails/${form.targetSegment}`)
      .then((json) => {
        if (json?.success) setPreviewEmails(json.data);
      })
      .catch(() => {});
  }, [form.targetSegment]);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(schedule) {
    setSaving(true);
    setError("");
    try {
      const json = await fetchJson("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          scheduledDate: schedule && form.scheduledDate ? new Date(form.scheduledDate).toISOString() : undefined,
        }),
      });
      if (!json?.success) throw new Error(json?.message || "Création impossible.");

      if (schedule && form.scheduledDate) {
        const json2 = await fetchJson(`/api/campaigns/${json.data.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "SCHEDULED", scheduledDate: new Date(form.scheduledDate).toISOString() }),
        });
        if (!json2?.success) throw new Error(json2?.message || "Planification impossible.");
      }
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const audienceCount = counts?.[form.targetSegment] ?? "?";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-2xl space-y-4 rounded-2xl bg-white p-6 dark:bg-gray-dark"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-dark dark:text-white">
            Nouvelle campagne — étape {step}/3
          </h2>
          <button onClick={onClose} className="text-sm text-gray-500">✕</button>
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        {step === 1 && (
          <div className="space-y-3">
            <WizardField label="Segment d'audience">
              <select
                value={form.targetSegment}
                onChange={(e) => set("targetSegment", e.target.value)}
                className="h-10 w-full rounded-lg border border-stroke bg-transparent px-3 text-sm dark:border-dark-3"
              >
                {(segments.length > 0 ? segments : [{ value: "newsletter", label: "Abonnés newsletter" }]).map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label} ({counts?.[s.value] ?? "…"})
                  </option>
                ))}
              </select>
            </WizardField>
            {previewEmails && (
              <p className="text-xs text-gray-500">
                {previewEmails.count} destinataire(s)
                {previewEmails.emails?.length > 0 ? ` — ex. ${previewEmails.emails.slice(0, 3).join(", ")}` : ""}
              </p>
            )}
            <WizardField label="Titre (interne)">
              <input value={form.title} onChange={(e) => set("title", e.target.value)} className={inputCls} placeholder="Promo printemps…" />
            </WizardField>
            <WizardField label="Objet de l'e-mail">
              <input value={form.subject} onChange={(e) => set("subject", e.target.value)} className={inputCls} placeholder="Nos nouveautés vous attendent" />
            </WizardField>
            <WizardField label="Pré-header (texte d'aperçu)">
              <input value={form.preheader} onChange={(e) => set("preheader", e.target.value)} className={inputCls} />
            </WizardField>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <WizardField label="Contenu (ne mets pas de « Bonjour », il est ajouté automatiquement en haut de l'e-mail)">
              <textarea
                value={form.content}
                onChange={(e) => set("content", e.target.value)}
                rows={8}
                className={`${inputCls} min-h-32`}
                placeholder="Découvrez nos nouveautés…

- ligne 1
- ligne 2"
              />
            </WizardField>
            <ImageField value={form.imageUrl} onChange={(url) => set("imageUrl", url)} />
            <AttachmentField value={form.attachmentUrl} onChange={(url) => set("attachmentUrl", url)} />
            <div className="grid grid-cols-2 gap-3">
              <WizardField label="Texte du bouton">
                <input value={form.ctaText} onChange={(e) => set("ctaText", e.target.value)} className={inputCls} />
              </WizardField>
              <WizardField label="Lien du bouton (CTA)">
                <input value={form.ctaUrl} onChange={(e) => set("ctaUrl", e.target.value)} className={inputCls} placeholder="https://meribeautystudio.com/…" />
              </WizardField>
            </div>
            <WizardField label="UTM campaign (suivi)">
              <input value={form.utmCampaign} onChange={(e) => set("utmCampaign", e.target.value)} className={inputCls} placeholder="promo_printemps" />
            </WizardField>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-stroke p-4 text-sm dark:border-dark-3">
              <p className="font-bold">{form.title || "—"}</p>
              <p className="text-gray-500">Objet : {form.subject || "—"}</p>
              <p className="text-gray-500">Segment : {form.targetSegment} ({audienceCount} destinataire(s))</p>
              {form.attachmentUrl && (
                <p className="text-gray-500">📎 Pièce jointe : {form.attachmentUrl.split("/").pop()}</p>
              )}
              {/* Aperçu fidèle du corps envoyé : bonjour auto + image + contenu + bouton */}
              <div className="mt-3 rounded-lg bg-gray-50 p-4 dark:bg-dark-2">
                <p className="mb-1 text-gray-700 dark:text-dark-6">
                  Bonjour {"{entreprise ou nom du destinataire}"},
                </p>
                <p className="mb-2 text-[11px] italic text-gray-400">
                  (personnalisé à l'envoi : entreprise, sinon prénom + nom — ne l'écris pas dans le contenu)
                </p>
                {form.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.imageUrl} alt="" className="mb-2 max-h-48 rounded-xl" />
                )}
                <div className="text-gray-700 dark:text-dark-6" dangerouslySetInnerHTML={{ __html: renderCampaignContent(form.content) || "<p>(contenu vide)</p>" }} />
                {form.ctaUrl && (
                  <p className="mt-4 text-center">
                    <span className="inline-block rounded-full bg-[#2f3a2e] px-6 py-2.5 font-semibold text-white">
                      {form.ctaText || "Découvrir"}
                    </span>
                  </p>
                )}
              </div>
              <p className="mt-3 text-xs text-gray-400">
                L'e-mail contiendra automatiquement le pixel de suivi d'ouverture, le lien de tracking sur le bouton et un lien de désinscription.
              </p>
            </div>
            <WizardField label="Planifier l'envoi (optionnel — vide = brouillon)">
              <input
                type="datetime-local"
                value={form.scheduledDate}
                onChange={(e) => set("scheduledDate", e.target.value)}
                className={inputCls}
              />
            </WizardField>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <button
            onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
            className="rounded-lg border border-stroke px-4 py-2 text-sm dark:border-dark-3"
          >
            {step === 1 ? "Annuler" : "← Retour"}
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={step === 1 && (!form.title.trim() || !form.subject.trim())}
              className="rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Continuer →
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                disabled={saving || !form.content.trim()}
                onClick={() => handleSubmit(false)}
                className="rounded-lg border border-stroke px-4 py-2 text-sm font-semibold disabled:opacity-50 dark:border-dark-3"
              >
                {saving ? "…" : "Enregistrer en brouillon"}
              </button>
              <button
                disabled={saving || !form.content.trim()}
                onClick={() => handleSubmit(true)}
                className="rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "…" : form.scheduledDate ? "Planifier" : "Enregistrer"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "h-10 w-full rounded-lg border border-stroke bg-transparent px-3 text-sm text-dark outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:text-white";

function StatBadge({ label, value, color }) {
  return (
    <div className={`flex items-center gap-2 rounded-xl px-3.5 py-2 ${color}`}>
      <span className="text-xl font-bold leading-none">{value}</span>
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}

function ImageField({ value, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const json = await fetchJson("/api/campaigns/attachments", { method: "POST", body });
      if (!json?.success) throw new Error(json?.message || "Téléversement impossible.");
      onChange(json.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">
        Image du corps de l'e-mail (JPEG, PNG, WebP ou GIF — affichée sous le bonjour)
      </span>
      {value ? (
        <div className="space-y-2 rounded-lg border border-stroke p-3 dark:border-dark-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="max-h-40 rounded-lg" />
          <div className="flex items-center gap-2">
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="https://…"
              className="h-9 min-w-0 flex-1 rounded-lg border border-stroke bg-transparent px-3 text-xs outline-none focus:border-[#2f3a2e] dark:border-dark-3"
            />
            <button type="button" onClick={() => onChange("")} className="shrink-0 text-xs text-red-600 underline">
              Retirer
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.gif"
            onChange={handleFile}
            disabled={uploading}
            className="block w-full text-sm text-gray-500 file:mr-3 file:rounded-lg file:border file:border-stroke file:bg-transparent file:px-3 file:py-2 file:text-sm file:font-medium disabled:opacity-50 dark:file:border-dark-3"
          />
          <input
            placeholder="…ou coller une URL d'image https://"
            onBlur={(e) => {
              if (e.target.value.trim()) onChange(e.target.value.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.target.value.trim()) onChange(e.target.value.trim());
              }
            }}
            className="h-9 w-full rounded-lg border border-stroke bg-transparent px-3 text-xs outline-none focus:border-[#2f3a2e] dark:border-dark-3"
          />
        </div>
      )}
      {uploading && <p className="mt-1 text-xs text-gray-500">Téléversement…</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function AttachmentField({ value, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/campaigns/attachments", { method: "POST", body });
      const json = await res.json();
      if (!json?.success) throw new Error(json?.message || "Téléversement impossible.");
      onChange(json.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <div className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">
        Pièce jointe (PDF ou image, max 10 Mo — envoyée avec chaque e-mail)
      </span>
      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-stroke px-3 py-2 text-sm dark:border-dark-3">
          <span className="min-w-0 flex-1 truncate">📎 {value.split("/").pop()}</span>
          <button type="button" onClick={() => onChange("")} className="shrink-0 text-xs text-red-600 underline">
            Retirer
          </button>
        </div>
      ) : (
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.gif"
          onChange={handleFile}
          disabled={uploading}
          className="block w-full text-sm text-gray-500 file:mr-3 file:rounded-lg file:border file:border-stroke file:bg-transparent file:px-3 file:py-2 file:text-sm file:font-medium disabled:opacity-50 dark:file:border-dark-3"
        />
      )}
      {uploading && <p className="mt-1 text-xs text-gray-500">Téléversement…</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function WizardField({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}
