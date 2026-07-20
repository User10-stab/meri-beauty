"use client";

import { useState, useEffect, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Building2,
  Phone,
  Mail,
  MapPin,
  ExternalLink,
  Share2,
  Music,
  Clock,
  CalendarX2,
  Plus,
  Trash2,
  Loader2,
  Save,
  Calendar,
  Pencil,
} from "lucide-react";
import { updateSalon } from "@/actions/salon/update-salon";
import { updateWorkingDays } from "@/actions/salon/update-working-days";
import { createClosure } from "@/actions/salon/create-closure";
import { deleteClosure } from "@/actions/salon/delete-closure";
import { updateSalonSchema } from "@/lib/validations/salon";
import Button from "@/components/ui/Button";

const DAY_LABELS = {
  MONDAY:    "Lundi",
  TUESDAY:   "Mardi",
  WEDNESDAY: "Mercredi",
  THURSDAY:  "Jeudi",
  FRIDAY:    "Vendredi",
  SATURDAY:  "Samedi",
  SUNDAY:    "Dimanche",
};

const DAY_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

/* ─── Reusable UI Primitives ─── */

function FieldError({ message }) {
  if (!message) return null;
  return <p role="alert" className="mt-1 text-xs font-medium text-red-600">{message}</p>;
}

function Label({ icon: Icon, required, children }) {
  return (
    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-dark-6">
      {Icon && <Icon size={13} className="text-gray-400 dark:text-dark-5" />}
      {children}
      {required && <span className="ml-0.5 text-red-400">*</span>}
    </label>
  );
}

function TextInput({ id, error, className = "", ...props }) {
  return (
    <input
      id={id}
      className={`h-10 w-full rounded-xl border px-4 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:ring-2 dark:bg-dark-2 dark:text-white dark:placeholder:text-dark-5 ${
        error
          ? "border-red-300 focus:border-red-400 focus:ring-red-100 dark:border-red-700"
          : "border-gray-200 focus:border-[#2f3a2e] focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:focus:border-primary"
      } ${className}`}
      {...props}
    />
  );
}

function SectionCard({ icon: Icon, title, description, children }) {
  return (
    <div className="rounded-2xl border border-stroke bg-white shadow-sm dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex items-center gap-3 border-b border-stroke px-8 py-5 dark:border-dark-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#2f3a2e]/10 dark:bg-[#FFFFFF1A]">
          <Icon size={18} className="text-[#2f3a2e] dark:text-white" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-dark dark:text-white">{title}</h2>
          {description && (
            <p className="text-sm text-gray-500 dark:text-dark-6">{description}</p>
          )}
        </div>
      </div>
      <div className="p-8">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2f3a2e] focus-visible:ring-offset-2 ${
        checked ? "bg-[#2f3a2e]" : "bg-gray-200 dark:bg-dark-3"
      }`}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

/* ─── Main Export ─── */

export function SalonSettingsClient({ initialData }) {
  const [salonData, setSalonData] = useState(initialData);

  return (
    <div className="space-y-8">
      <BusinessInfoSection salon={salonData} onSuccess={setSalonData} />
      <WorkingDaysSection salon={salonData} setSalonData={setSalonData} />
      <ClosuresSection salon={salonData} setSalonData={setSalonData} />
    </div>
  );
}

/* ─── Section 1: Business Information (merged with social) ─── */

function BusinessInfoSection({ salon, onSuccess }) {
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(updateSalonSchema),
    defaultValues: {
      name: salon?.name ?? "",
      description: salon?.description ?? "",
      phone: salon?.phone ?? "",
      email: salon?.email ?? "",
      address: salon?.address ?? "",
      instagram: salon?.instagram ?? "",
      facebook: salon?.facebook ?? "",
      tiktok: salon?.tiktok ?? "",
    },
  });

  function onSubmit(data) {
    startTransition(async () => {
      const res = await updateSalon(data);
      if (res.success) {
        toast.success(res.message);
        // Update the entire salon data with the returned data
        onSuccess(res.data);
      } else {
        if (res.errors) {
          const first = Object.values(res.errors).find(Boolean);
          if (first) toast.error(first);
        } else {
          toast.error(res.message);
        }
      }
    });
  }

  return (
    <SectionCard
      icon={Building2}
      title="Informations commerciales"
      description="Coordonnées et réseaux sociaux du salon."
    >
      <form id="business-info-form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2">
          {/* Left column — Contact */}
          <div className="space-y-5">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-dark-5">
              Contact
            </h3>
            <div>
              <Label icon={Phone} required>Téléphone</Label>
              <TextInput id="phone" type="tel" placeholder="+33 1 23 45 67 89" error={errors.phone} {...register("phone")} />
              <FieldError message={errors.phone?.message} />
            </div>
            <div>
              <Label icon={Mail} required>Email</Label>
              <TextInput id="email" type="email" placeholder="contact@meribeauty.com" error={errors.email} {...register("email")} />
              <FieldError message={errors.email?.message} />
            </div>
            <div>
              <Label icon={MapPin}>Adresse</Label>
              <TextInput id="address" placeholder="123 Rue de la Beauté, Paris" error={errors.address} {...register("address")} />
              <FieldError message={errors.address?.message} />
            </div>
          </div>

          {/* Right column — Social */}
          <div className="space-y-5">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-dark-5">
              Réseaux sociaux
            </h3>
            <div>
              <Label icon={ExternalLink}>Instagram</Label>
              <TextInput
                id="instagram"
                placeholder="https://instagram.com/votre-salon"
                error={errors.instagram}
                {...register("instagram")}
              />
              <FieldError message={errors.instagram?.message} />
            </div>
            <div>
              <Label icon={Share2}>Facebook</Label>
              <TextInput
                id="facebook"
                placeholder="https://facebook.com/votre-salon"
                error={errors.facebook}
                {...register("facebook")}
              />
              <FieldError message={errors.facebook?.message} />
            </div>
            <div>
              <Label icon={Music}>TikTok</Label>
              <TextInput
                id="tiktok"
                placeholder="https://tiktok.com/@votre-salon"
                error={errors.tiktok}
                {...register("tiktok")}
              />
              <FieldError message={errors.tiktok?.message} />
            </div>
          </div>
        </div>

        {/* Hidden fields required by schema */}
        <input type="hidden" {...register("name")} />
        <input type="hidden" {...register("description")} />

        <div className="mt-8 flex justify-end border-t border-stroke pt-6 dark:border-dark-3">
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <><Loader2 size={16} className="animate-spin" /> Enregistrement…</>
            ) : (
              <><Save size={16} /> Enregistrer les modifications</>
            )}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

/* ─── Section 2: Working Hours (card per day) ─── */

function WorkingDaysSection({ salon, setSalonData }) {
  const [isPending, startTransition] = useTransition();

  const defaultDays = DAY_ORDER.map((day) => {
    const existing = salon?.workingDays?.find((wd) => wd.day === day);
    return {
      day,
      isOpen: existing?.isOpen ?? true,
      openingTime: existing?.openingTime ?? "09:00",
      closingTime: existing?.closingTime ?? "19:00",
    };
  });

  const [days, setDays] = useState(defaultDays);

  function toggleDay(index) {
    setDays((prev) =>
      prev.map((d, i) => (i === index ? { ...d, isOpen: !d.isOpen } : d)),
    );
  }

  function updateTime(index, field, value) {
    setDays((prev) =>
      prev.map((d, i) => (i === index ? { ...d, [field]: value } : d)),
    );
  }

  function handleSave() {
    startTransition(async () => {
      const res = await updateWorkingDays({ days });
      if (res.success) {
        toast.success(res.message);
        // Update working days in salon data
        setSalonData(prev => ({
          ...prev,
          workingDays: res.data,
        }));
      } else {
        toast.error(res.message);
      }
    });
  }

  function applySameHours() {
    const firstOpenDay = days.find(d => d.isOpen);
    if (firstOpenDay) {
      setDays((prev) =>
        prev.map((d) => (d.isOpen ? { ...d, openingTime: firstOpenDay.openingTime, closingTime: firstOpenDay.closingTime } : d)),
      );
      toast.success("Horaires appliqués à tous les jours ouverts");
    }
  }

  return (
    <SectionCard
      icon={Clock}
      title="Horaires d'ouverture hebdomadaires"
      description="Définissez les horaires pour chaque jour de la semaine."
    >
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={applySameHours}
          className="rounded-lg border border-stroke bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6 dark:hover:bg-dark-3"
        >
          Appliquer les mêmes horaires
        </button>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-stroke dark:border-dark-3">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-dark-6">
                Jour
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-dark-6">
                Statut
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-dark-6">
                Ouverture
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-dark-6">
                Fermeture
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map((day, i) => (
              <tr key={day.day} className="border-b border-stroke dark:border-dark-3">
                <td className="px-4 py-3">
                  <span className={`text-sm font-medium ${day.isOpen ? "text-dark dark:text-white" : "text-gray-400 dark:text-dark-5"}`}>
                    {DAY_LABELS[day.day]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Toggle
                      checked={day.isOpen}
                      onChange={() => toggleDay(i)}
                    />
                    <span className={`text-sm ${day.isOpen ? "text-dark dark:text-white" : "text-gray-400 dark:text-dark-5"}`}>
                      {day.isOpen ? "Ouvert" : "Fermé"}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {day.isOpen ? (
                    <input
                      type="time"
                      value={day.openingTime}
                      onChange={(e) => updateTime(i, "openingTime", e.target.value)}
                      className="h-9 w-full rounded-lg border border-stroke bg-transparent px-3 text-sm text-dark outline-none transition focus:border-[#2f3a2e] dark:border-dark-3 dark:text-white"
                    />
                  ) : (
                    <span className="text-gray-400 dark:text-dark-5">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {day.isOpen ? (
                    <input
                      type="time"
                      value={day.closingTime}
                      onChange={(e) => updateTime(i, "closingTime", e.target.value)}
                      className="h-9 w-full rounded-lg border border-stroke bg-transparent px-3 text-sm text-dark outline-none transition focus:border-[#2f3a2e] dark:border-dark-3 dark:text-white"
                    />
                  ) : (
                    <span className="text-gray-400 dark:text-dark-5">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8 flex justify-end border-t border-stroke pt-6 dark:border-dark-3">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? (
            <><Loader2 size={16} className="animate-spin" /> Enregistrement…</>
          ) : (
            <><Save size={16} /> Enregistrer les horaires</>
          )}
        </Button>
      </div>
    </SectionCard>
  );
}

/* ─── Section 3: Exceptional Closures ─── */

function ClosuresSection({ salon, setSalonData }) {
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isFullDay, setIsFullDay] = useState(true);
  const [openingTime, setOpeningTime] = useState("09:00");
  const [closingTime, setClosingTime] = useState("19:00");

  const closures = salon?.closures ?? [];

  function resetForm() {
    setTitle("");
    setStartDate("");
    setEndDate("");
    setIsFullDay(true);
    setOpeningTime("09:00");
    setClosingTime("19:00");
    setShowForm(false);
  }

  function handleAdd() {
    if (!title.trim() || !startDate) {
      toast.error("Veuillez remplir le titre et la date de début.");
      return;
    }

    startTransition(async () => {
      const res = await createClosure({
        title: title.trim(),
        startDate,
        endDate: endDate || null,
        isFullDay,
        openingTime: isFullDay ? null : openingTime,
        closingTime: isFullDay ? null : closingTime,
      });
      if (res.success) {
        toast.success(res.message);
        // Update closures in salon data
        setSalonData(prev => ({
          ...prev,
          closures: res.data,
        }));
        resetForm();
      } else {
        if (res.errors) {
          const first = Object.values(res.errors).find(Boolean);
          if (first) toast.error(first);
        } else {
          toast.error(res.message);
        }
      }
    });
  }

  function handleDelete(id) {
    startTransition(async () => {
      const res = await deleteClosure({ id });
      if (res.success) {
        toast.success(res.message);
        // Update closures in salon data
        setSalonData(prev => ({
          ...prev,
          closures: res.data,
        }));
      } else {
        toast.error(res.message);
      }
    });
  }

  function formatShortDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  return (
    <SectionCard
      icon={CalendarX2}
      title="Jours fériés / Fermetures exceptionnelles"
      description="Ajoutez les jours ou périodes où le salon sera fermé."
    >
      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-lg border border-stroke bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6 dark:hover:bg-dark-3"
        >
          Ajouter une fermeture
        </button>
      </div>

      {/* Closure table */}
      {closures.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-stroke dark:border-dark-3">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-dark-6">
                  Titre
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-dark-6">
                  Date de début
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-dark-6">
                  Date de fin
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-dark-6">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {closures.map((c) => (
                <tr key={c.id} className="border-b border-stroke dark:border-dark-3">
                  <td className="px-4 py-3">
                    <span className="text-sm font-medium text-dark dark:text-white">
                      {c.title}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-600 dark:text-dark-6">
                      {formatShortDate(c.startDate)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-600 dark:text-dark-6">
                      {c.endDate ? formatShortDate(c.endDate) : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-dark-3 dark:hover:text-dark-5"
                        title="Modifier"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(c.id)}
                        disabled={isPending}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                        title="Supprimer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* Empty state */
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stroke bg-gray-50/50 px-6 py-12 dark:border-dark-3 dark:bg-dark-2/50">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 dark:bg-dark-3">
            <Calendar size={24} className="text-gray-400 dark:text-dark-5" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-dark dark:text-white">
            Aucune fermeture exceptionnelle
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-dark-6">
            Ajoutez des périodes de fermeture pour les vacances ou les jours fériés.
          </p>
        </div>
      )}

      {/* Add closure form */}
      {showForm && (
        <div className="mt-6 rounded-2xl border border-stroke bg-gray-50/80 p-6 dark:border-dark-3 dark:bg-dark-2/80">
          <div className="space-y-5">
            {/* Title */}
            <div>
              <Label required>Titre</Label>
              <TextInput
                placeholder="ex. Vacances d'été"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* Dates */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label required>Date de début</Label>
                <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label>Date de fin</Label>
                <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>

            {/* Full day toggle */}
            <div className="flex items-center gap-3 rounded-xl border border-stroke bg-white px-4 py-3 dark:border-dark-3 dark:bg-gray-dark">
              <Toggle
                checked={isFullDay}
                onChange={() => setIsFullDay((prev) => !prev)}
              />
              <span className="text-sm font-medium text-dark dark:text-white">
                Journée entière
              </span>
            </div>

            {/* Partial hours */}
            {!isFullDay && (
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-dark-5">
                    Ouverture
                  </label>
                  <input
                    type="time"
                    value={openingTime}
                    onChange={(e) => setOpeningTime(e.target.value)}
                    className="h-10 w-full rounded-xl border border-stroke bg-white px-3 text-sm text-dark outline-none transition focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                  />
                </div>
                <span className="mb-2 text-xs text-gray-400">→</span>
                <div className="flex-1">
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-dark-5">
                    Fermeture
                  </label>
                  <input
                    type="time"
                    value={closingTime}
                    onChange={(e) => setClosingTime(e.target.value)}
                    className="h-10 w-full rounded-xl border border-stroke bg-white px-3 text-sm text-dark outline-none transition focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-gray-dark dark:text-white"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Form actions */}
          <div className="mt-6 flex items-center justify-end gap-3 border-t border-stroke pt-5 dark:border-dark-3">
            <button
              type="button"
              onClick={resetForm}
              className="rounded-xl border border-stroke bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6 dark:hover:bg-dark-3"
            >
              Annuler
            </button>
            <Button onClick={handleAdd} disabled={isPending}>
              {isPending ? (
                <><Loader2 size={16} className="animate-spin" /> Ajout…</>
              ) : (
                <><Plus size={16} /> Ajouter la fermeture</>
              )}
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}