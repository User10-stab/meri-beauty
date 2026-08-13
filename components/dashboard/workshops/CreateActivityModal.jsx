"use client";

import { useEffect, useState, useRef, useTransition } from "react";
import { toast } from "sonner";
import { X, Loader2, Calendar, Euro, Clock, Users, Globe2, BookOpen, Camera } from "lucide-react";
import Button from "@/components/ui/Button";
import { createActivity, updateActivity } from "@/actions/workshops/create-activity";
import { useTranslations } from "next-intl";

function FieldError({ message }) {
  if (!message) return null;
  return <p className="mt-1 text-xs font-medium text-red-600">{message}</p>;
}

function ModalField({ label, children, required = false }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
        {label}
        {required ? <span className="ml-1 text-red-400">*</span> : null}
      </label>
      {children}
    </div>
  );
}

function CoverUpload({ value, onChange, error, t }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(value ?? null);

  useEffect(() => {
    setPreview(value);
  }, [value]);

  async function handleFile(file) {
    if (!file) return;

    // Client-side guard
    const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!ALLOWED.includes(file.type)) {
      toast.error(t("errorFormat"));
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error(t("errorFileSize"));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setUploading(true);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "activities");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.success) {
        onChange(data.url);
      } else {
        toast.error(data.message ?? t("errorUpload"));
        setPreview(null);
        onChange(null);
      }
    } catch {
      toast.error(t("errorNetwork"));
      setPreview(null);
      onChange(null);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1">
      <div
        onClick={() => inputRef.current?.click()}
        className={`relative flex h-40 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed bg-gray-50/50 hover:bg-gray-50 hover:border-indigo-400 transition-all overflow-hidden ${
          error ? "border-red-300" : "border-gray-300"
        }`}
      >
        {preview ? (
          <>
            <img src={preview} alt="Couverture" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPreview(null);
                onChange(null);
              }}
              className="absolute top-2 right-2 p-1.5 bg-red-500 hover:bg-red-600 rounded-full text-white shadow transition-colors"
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-1.5 text-gray-500">
            {uploading ? (
              <Loader2 className="animate-spin text-indigo-600" size={24} />
            ) : (
              <>
                <Camera size={24} className="text-gray-400" />
                <span className="text-sm font-medium">{t("coverLabel")}</span>
                <span className="text-xs text-gray-400">{t("coverHint")}</span>
              </>
            )}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function CreateActivityModal({ open, onClose, onCreated, activity, animators = [] }) {
  const t = useTranslations("dashboardWorkshops.activities.modal");
  const isEditing = !!activity;
  const [loading, startLoading] = useTransition();
  const [form, setForm] = useState({
    type: "WORKSHOP",
    title: "",
    description: "",
    cover: "",
    price: "",
    duration: "",
    capacity: "",
    language: "Français",
    animatorId: "",
    status: "DRAFT",
    startDate: "",
    endDate: "",
    allowMultipleSessions: false,
    depositPercentage: 50,
  });
  const [sessions, setSessions] = useState([]);
  const [errors, setErrors] = useState({});

  function addSession(session = { startDate: "", endDate: "", capacity: "", animatorId: "", registrationDeadline: "" }) {
    setSessions((prev) => [...prev, session]);
  }

  function removeSession(index) {
    setSessions((prev) => prev.filter((_, i) => i !== index));
  }

  function updateSession(index, field, value) {
    setSessions((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  useEffect(() => {
    if (!open) return;
    if (activity) {
      const firstSession = activity.sessions?.[0];
      setForm({
        type: activity.type ?? "WORKSHOP",
        title: activity.title ?? "",
        description: activity.description ?? "",
        cover: activity.cover ?? "",
        price: activity.price ?? "",
        duration: activity.duration ?? "",
        capacity: activity.capacity ?? "",
        language: activity.language ?? "Français",
        animatorId: activity.animatorId ?? "",
        status: activity.status ?? "DRAFT",
        startDate: firstSession?.startDate ? new Date(firstSession.startDate).toISOString().slice(0, 16) : "",
        endDate: firstSession?.endDate ? new Date(firstSession.endDate).toISOString().slice(0, 16) : "",
        allowMultipleSessions: activity.allowMultipleSessions ?? false,
        depositPercentage: activity.depositPercentage ?? 50,
      });
      if (activity.allowMultipleSessions && activity.sessions?.length > 0) {
        setSessions(
          activity.sessions.map((s) => ({
            id: s.id,
            startDate: s.startDate ? new Date(s.startDate).toISOString().slice(0, 16) : "",
            endDate: s.endDate ? new Date(s.endDate).toISOString().slice(0, 16) : "",
            capacity: String(s.capacity ?? ""),
            animatorId: s.animatorId ?? "",
            registrationDeadline: s.registrationDeadline
              ? new Date(s.registrationDeadline).toISOString().slice(0, 16)
              : "",
          }))
        );
      } else {
        setSessions([]);
      }
    } else {
      setForm({
        type: "WORKSHOP",
        title: "",
        description: "",
        cover: "",
        price: "",
        duration: "",
        capacity: "",
        language: "Français",
        animatorId: "",
        status: "DRAFT",
        startDate: "",
        endDate: "",
        allowMultipleSessions: false,
        depositPercentage: 50,
      });
      setSessions([]);
    }
    setErrors({});
  }, [open, activity]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors({});

    startLoading(async () => {
      const payload = {
        ...form,
        price: form.price === "" ? 0 : parseFloat(form.price),
        duration: form.duration === "" ? 0 : parseInt(form.duration, 10),
        capacity: form.capacity === "" ? 0 : parseInt(form.capacity, 10),
        startDate: form.startDate,
        endDate: form.endDate,
        sessions: form.allowMultipleSessions
          ? sessions.map((s) => ({
              ...(s.id ? { id: s.id } : {}),
              startDate: s.startDate,
              endDate: s.endDate || null,
              capacity: s.capacity === "" ? parseInt(form.capacity, 10) || 0 : parseInt(s.capacity, 10),
              animatorId: s.animatorId || null,
              registrationDeadline: s.registrationDeadline || null,
            }))
          : form.startDate
            ? [
                {
                  startDate: form.startDate,
                  endDate: form.endDate || null,
                  capacity: parseInt(form.capacity, 10) || 0,
                  animatorId: null,
                  registrationDeadline: null,
                },
              ]
            : [],
      };

      const result = isEditing
        ? await updateActivity({ id: activity.id, ...payload })
        : await createActivity(payload);

      if (result.success) {
        toast.success(result.message);
        onCreated?.();
        onClose();
      } else {
        setErrors(result.errors ?? {});
        toast.error(result.message || t("errorGeneric"));
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative flex w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl my-8">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {isEditing ? t("editTitle") : t("newTitle")}
            </h2>
            <p className="text-xs text-gray-500">
              {isEditing ? t("editSubtitle") : t("newSubtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5 max-h-[75vh] overflow-y-auto">
          {/* Cover upload */}
          <CoverUpload
            value={form.cover}
            onChange={(url) => setForm((prev) => ({ ...prev, cover: url }))}
            error={errors.cover}
            t={t}
          />

          {/* Type Selector */}
          <ModalField label={t("typeLabel")} required>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, type: "WORKSHOP" }))}
                className={`flex items-center justify-center py-2 px-4 border rounded-lg text-sm font-medium transition-all ${
                  form.type === "WORKSHOP"
                    ? "bg-amber-50 border-amber-500 text-amber-900 shadow-sm"
                    : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {t("typeWorkshop")}
              </button>
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, type: "EVENT" }))}
                className={`flex items-center justify-center py-2 px-4 border rounded-lg text-sm font-medium transition-all ${
                  form.type === "EVENT"
                    ? "bg-sky-50 border-sky-500 text-sky-900 shadow-sm"
                    : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {t("typeEvent")}
              </button>
            </div>
            <FieldError message={errors.type} />
          </ModalField>

          {/* Title */}
          <ModalField label={t("titleLabel")} required>
            <div className="relative">
              <BookOpen size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                required
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                placeholder={t("titlePlaceholder")}
              />
            </div>
            <FieldError message={errors.title} />
          </ModalField>

          {/* Description */}
          <ModalField label={t("descriptionLabel")}>
            <textarea
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100 min-h-[80px] resize-none"
              placeholder={t("descriptionPlaceholder")}
            />
            <FieldError message={errors.description} />
          </ModalField>

          {/* Pricing, Duration & Capacity */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Price */}
            <ModalField label={t("priceLabel")} required>
              <div className="relative">
                <Euro size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="number"
                  step="0.01"
                  required
                  value={form.price}
                  onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                  placeholder="0.00"
                />
              </div>
              <FieldError message={errors.price} />
            </ModalField>

            {/* Duration */}
            <ModalField label={t("durationLabel")} required>
              <div className="relative">
                <Clock size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="number"
                  required
                  value={form.duration}
                  onChange={(e) => setForm((prev) => ({ ...prev, duration: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                  placeholder="120"
                />
              </div>
              <FieldError message={errors.duration} />
            </ModalField>

            {/* Capacity */}
            <ModalField label={t("capacityLabel")} required>
              <div className="relative">
                <Users size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="number"
                  required
                  min={1}
                  max={8}
                  value={form.capacity}
                  onChange={(e) => setForm((prev) => ({ ...prev, capacity: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                  placeholder="8"
                />
              </div>
              <p className="mt-1 text-xs text-gray-400">{t("capacityHint")}</p>
              <FieldError message={errors.capacity} />
            </ModalField>
          </div>

          {/* Deposit Percentage */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ModalField label={t("depositLabel")}>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={form.depositPercentage}
                  onChange={(e) => setForm((prev) => ({ ...prev, depositPercentage: parseInt(e.target.value, 10) || 0 }))}
                  className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                  placeholder="50"
                />
              </div>
              <p className="mt-1 text-xs text-gray-400">{t("depositHint")}</p>
              <FieldError message={errors.depositPercentage} />
            </ModalField>

            {/* Language */}
            <ModalField label={t("languageLabel")}>
              <div className="relative">
                <Globe2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={form.language}
                  onChange={(e) => setForm((prev) => ({ ...prev, language: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                  placeholder={t("languagePlaceholder")}
                />
              </div>
              <FieldError message={errors.language} />
            </ModalField>

            {/* Animator */}
            <ModalField label={t("animatorLabel")}>
              <select
                value={form.animatorId}
                onChange={(e) => setForm((prev) => ({ ...prev, animatorId: e.target.value }))}
                className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 bg-white outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="">{t("animatorPlaceholder")}</option>
                {animators.map((animator) => (
                  <option key={animator.id} value={animator.id}>
                    {animator.name}
                  </option>
                ))}
              </select>
              <FieldError message={errors.animatorId} />
            </ModalField>
          </div>

          {/* Status & Options */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2 border-t border-gray-100">
            {/* Status */}
            <ModalField label={t("statusLabel")} required>
              <select
                value={form.status}
                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 bg-white outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="DRAFT">{t("statusDraft")}</option>
                <option value="PUBLISHED">{t("statusPublished")}</option>
                <option value="CANCELLED">{t("statusCancelled")}</option>
                <option value="ARCHIVED">{t("statusArchived")}</option>
              </select>
              <FieldError message={errors.status} />
            </ModalField>

            {/* Allow Multiple Sessions */}
            <div className="flex items-center pt-6">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.allowMultipleSessions}
                  onChange={(e) => setForm((prev) => ({ ...prev, allowMultipleSessions: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-medium text-gray-700">{t("allowMultipleSessions")}</span>
              </label>
            </div>
          </div>

          {/* Date / Sessions */}
          <div className="pt-2 border-t border-gray-100 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">
                {form.allowMultipleSessions ? t("sessionsLabel", { count: sessions.length }) : t("dateLabel")}
              </h3>
              {form.allowMultipleSessions && (
                <button
                  type="button"
                  onClick={() => addSession()}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
                >
                  {t("addSession")}
                </button>
              )}
            </div>

            {form.allowMultipleSessions ? (
              <>
                {sessions.length === 0 && (
                  <p className="text-xs text-gray-400 italic">
                    {t("noSessions")}
                  </p>
                )}

                {sessions.map((session, index) => (
                  <div
                    key={index}
                    className="rounded-lg border border-gray-200 p-3 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {t("sessionNumber", { number: index + 1 })}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeSession(index)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <ModalField label={t("startDateLabel")} required>
                        <input
                          type="datetime-local"
                          required
                          value={session.startDate}
                          onChange={(e) => updateSession(index, "startDate", e.target.value)}
                          className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                        />
                      </ModalField>
                      <ModalField label={t("endDateLabel")}>
                        <input
                          type="datetime-local"
                          value={session.endDate}
                          onChange={(e) => updateSession(index, "endDate", e.target.value)}
                          className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                        />
                      </ModalField>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <ModalField label={t("sessionCapacityLabel")}>
                        <input
                          type="number"
                          min={1}
                          max={8}
                          value={session.capacity}
                          onChange={(e) => updateSession(index, "capacity", e.target.value)}
                          placeholder={t("sessionCapacityPlaceholder", { default: form.capacity || "8" })}
                          className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                        />
                      </ModalField>
                      <ModalField label={t("deadlineLabel")}>
                        <input
                          type="datetime-local"
                          value={session.registrationDeadline}
                          onChange={(e) => updateSession(index, "registrationDeadline", e.target.value)}
                          className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                        />
                      </ModalField>
                    </div>

                    <ModalField label={t("sessionAnimatorLabel")}>
                      <select
                        value={session.animatorId}
                        onChange={(e) => updateSession(index, "animatorId", e.target.value)}
                        className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 bg-white outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                      >
                        <option value="">{t("sessionAnimatorPlaceholder")}</option>
                        {animators.map((animator) => (
                          <option key={animator.id} value={animator.id}>
                            {animator.name}
                          </option>
                        ))}
                      </select>
                    </ModalField>
                  </div>
                ))}
              </>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ModalField label={t("startDateLabel")} required>
                  <input
                    type="datetime-local"
                    required
                    value={form.startDate}
                    onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
                    className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                  />
                </ModalField>
                <ModalField label={t("endDateLabel")}>
                  <input
                    type="datetime-local"
                    value={form.endDate}
                    onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
                    className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                  />
                </ModalField>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t("cancel")}
            </button>
            <Button type="submit" disabled={loading} className="bg-[#2f3a2e]">
              {loading ? <Loader2 size={15} className="animate-spin mr-1.5" /> : null}
              {isEditing ? t("update") : t("create")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
