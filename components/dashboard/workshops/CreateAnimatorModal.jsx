"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Loader2, User, Mail, Phone, Globe, FileText } from "lucide-react";
import Button from "@/components/ui/Button";
import { PhotoUpload } from "@/components/ui/PhotoUpload";
import { createAnimator, updateAnimator } from "@/actions/workshops/create-animator";
import { useTranslations } from "next-intl";

function InstagramIcon({ className = "w-4 h-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );
}

function FacebookIcon({ className = "w-4 h-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

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

export function CreateAnimatorModal({ open, onClose, onCreated, animator }) {
  const t = useTranslations("dashboardWorkshops.animators.modal");
  const isEditing = !!animator;
  const [loading, startLoading] = useTransition();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    bio: "",
    avatar: "",
    website: "",
    instagram: "",
    facebook: "",
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) return;
    if (animator) {
      setForm({
        name: animator.name ?? "",
        email: animator.email ?? "",
        phone: animator.phone ?? "",
        bio: animator.bio ?? "",
        avatar: animator.avatar ?? "",
        website: animator.website ?? "",
        instagram: animator.instagram ?? "",
        facebook: animator.facebook ?? "",
      });
    } else {
      setForm({
        name: "",
        email: "",
        phone: "",
        bio: "",
        avatar: "",
        website: "",
        instagram: "",
        facebook: "",
      });
    }
    setErrors({});
  }, [open, animator]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors({});

    startLoading(async () => {
      const payload = { ...form };
      const result = isEditing
        ? await updateAnimator({ id: animator.id, ...payload })
        : await createAnimator(payload);

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
          {/* Avatar upload */}
          <div className="flex justify-center py-2">
            <ModalField label={t("avatarLabel")}>
              <PhotoUpload
                value={form.avatar}
                onChange={(url) => setForm((prev) => ({ ...prev, avatar: url }))}
                uploadFolder="animators"
                error={errors.avatar}
              />
            </ModalField>
          </div>

          {/* Name */}
          <ModalField label={t("nameLabel")} required>
            <div className="relative">
              <User size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                placeholder={t("namePlaceholder")}
              />
            </div>
            <FieldError message={errors.name} />
          </ModalField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Email */}
            <ModalField label={t("emailLabel")}>
              <div className="relative">
                <Mail size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                  placeholder={t("emailPlaceholder")}
                />
              </div>
              <FieldError message={errors.email} />
            </ModalField>

            {/* Phone */}
            <ModalField label={t("phoneLabel")}>
              <div className="relative">
                <Phone size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                  placeholder={t("phonePlaceholder")}
                />
              </div>
              <FieldError message={errors.phone} />
            </ModalField>
          </div>

          {/* Bio */}
          <ModalField label={t("bioLabel")}>
            <div className="relative">
              <FileText size={14} className="pointer-events-none absolute left-3 top-3 text-gray-400" />
              <textarea
                value={form.bio}
                onChange={(e) => setForm((prev) => ({ ...prev, bio: e.target.value }))}
                maxLength={500}
                className="w-full rounded-lg border border-gray-200 pl-8 pr-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100 min-h-[80px] resize-none"
                placeholder={t("bioPlaceholder")}
              />
              <div className="flex justify-end mt-1">
                <span className={`text-xs ${form.bio.length > 500 ? 'text-red-600' : 'text-gray-400'}`}>
                  {form.bio.length}/500
                </span>
              </div>
            </div>
            <FieldError message={errors.bio} />
          </ModalField>

          {/* Website & Socials */}
          <div className="space-y-3 pt-2 border-t border-gray-100">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t("linksSection")}</h4>

            {/* Website */}
            <ModalField label={t("websiteLabel")}>
              <div className="relative">
                <Globe size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={form.website}
                  onChange={(e) => setForm((prev) => ({ ...prev, website: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                  placeholder={t("websitePlaceholder")}
                />
              </div>
              <FieldError message={errors.website} />
            </ModalField>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Instagram */}
              <ModalField label={t("instagramLabel")}>
                <div className="relative">
                  <InstagramIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-3.5 w-3.5" />
                  <input
                    type="text"
                    value={form.instagram}
                    onChange={(e) => setForm((prev) => ({ ...prev, instagram: e.target.value }))}
                    className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                    placeholder={t("instagramPlaceholder")}
                  />
                </div>
                <FieldError message={errors.instagram} />
              </ModalField>

              {/* Facebook */}
              <ModalField label={t("facebookLabel")}>
                <div className="relative">
                  <FacebookIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-3.5 w-3.5" />
                  <input
                    type="text"
                    value={form.facebook}
                    onChange={(e) => setForm((prev) => ({ ...prev, facebook: e.target.value }))}
                    className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                    placeholder={t("facebookPlaceholder")}
                  />
                </div>
                <FieldError message={errors.facebook} />
              </ModalField>
            </div>
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
