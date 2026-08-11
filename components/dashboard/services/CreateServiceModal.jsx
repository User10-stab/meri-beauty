"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Loader2, Tag, Layers, FileText, Plus, Trash2, Check, Package } from "lucide-react";
import Button from "@/components/ui/Button";
import { PhotoUpload } from "@/components/ui/PhotoUpload";
import { createService, updateService, getCategories, getStaffOptions, getCurrentStaffProfile } from "@/actions/services/create-service";
import { assignServiceToMe } from "@/actions/services/assign-service-to-me";
import { InlineCategoryCreate } from "@/components/dashboard/services/InlineCategoryCreate";

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

function StaffAssignmentCard({ staff, index, assignment, onChange, onRemove, canRemove, errors }) {
  const handleChange = (field, value) => {
    onChange(index, { ...assignment, [field]: value });
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 uppercase">
            {staff.user.fullName.slice(0, 2)}
          </div>
          <div>
            <span className="block text-sm font-medium text-gray-800">{staff.user.fullName}</span>
            <span className="text-xs text-gray-400">{staff.user.email}</span>
          </div>
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
            title="Retirer ce professionnel"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Price */}
        <ModalField label="Prix (€)" required>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">€</span>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={assignment.price}
              onChange={(e) => handleChange("price", e.target.value)}
              className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              placeholder="0.00"
            />
          </div>
          <FieldError message={errors?.price} />
        </ModalField>

        {/* Duration */}
        <ModalField label="Durée (minutes)" required>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">⏱</span>
            <input
              type="number"
              min="1"
              required
              value={assignment.duration}
              onChange={(e) => handleChange("duration", e.target.value)}
              className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              placeholder="30"
            />
          </div>
          <FieldError message={errors?.duration} />
        </ModalField>
      </div>

      {/* Margin */}
      <ModalField label="Marge (minutes)">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">⏱</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={assignment.margin}
            onChange={(e) => handleChange("margin", e.target.value)}
            className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            placeholder="Optionnel"
          />
        </div>
        <FieldError message={errors?.margin} />
      </ModalField>

      {/* Photo */}
      <ModalField label="Photo du service">
        <div className="flex items-center gap-3">
          <PhotoUpload
            value={assignment.photo}
            onChange={(url) => handleChange("photo", url ?? "")}
            uploadFolder="services"
          />
          <div className="text-xs text-gray-400">
            <p>Photo illustrant le service</p>
            <p>JPEG, PNG, WebP ou GIF (max 20 Mo)</p>
          </div>
        </div>
        <FieldError message={errors?.photo} />
      </ModalField>
    </div>
  );
}


export function CreateServiceModal({ open, onClose, onCreated, service, userRole }) {
  const isEditing = !!service;
  const isStaff = userRole === "STAFF";
  const [categories, setCategories] = useState([]);
  const [staffOptions, setStaffOptions] = useState([]);
  const [loading, startLoading] = useTransition();
  const [showCategoryCreate, setShowCategoryCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    categoryId: "",
    description: "",
  });
  const [staffAssignments, setStaffAssignments] = useState([]);
  const [errors, setErrors] = useState({});
  const [assigningServiceId, setAssigningServiceId] = useState(null);
  const [assignedServiceIds, setAssignedServiceIds] = useState([]);
  const [currentStaffId, setCurrentStaffId] = useState(null);

  useEffect(() => {
    if (!open) return;
    
    startLoading(async () => {
      const [catsRes, staffRes, staffProfileRes] = await Promise.all([
        getCategories(),
        getStaffOptions(),
        getCurrentStaffProfile(),
      ]);

      if (catsRes.success) {
        setCategories(catsRes.data ?? []);
        // Initialize assigned service IDs from the fetched data
        const assigned = [];
        (catsRes.data ?? []).forEach((cat) => {
          (cat.services ?? []).forEach((svc) => {
            if (svc.isAssignedToMe) assigned.push(svc.id);
          });
        });
        setAssignedServiceIds(assigned);
      }
      if (staffRes.success) {
        setStaffOptions((prev) => {
          // Merge freshly loaded staff with any staff that may have been
          // added during pre-fill (e.g. existing assignments from editing).
          const fetchedIds = new Set(staffRes.data.map((s) => s.id));
          const fromPrev = prev.filter((s) => !fetchedIds.has(s.id));
          return [...staffRes.data, ...fromPrev];
        });
      }
      // Get current staff ID for staff members
      if (staffProfileRes.success && staffProfileRes.data) {
        setCurrentStaffId(staffProfileRes.data.id);
      }
    });
  }, [open]);

  // Pre-fill form when editing or reset when creating
  useEffect(() => {
    if (!open) return;

    if (!service) {
      // Reset form for create mode
      setForm({
        name: "",
        categoryId: "",
        description: "",
      });
      // For staff: auto-add their own assignment so they can set price/duration
      if (isStaff && currentStaffId) {
        setStaffAssignments([{ staffId: currentStaffId, price: "", duration: "", margin: "", photo: "" }]);
      } else {
        setStaffAssignments([]);
      }
      setErrors({});
      return;
    }

    // Editing mode — pre-fill from service data
    setForm({
      name: service.name ?? "",
      categoryId: service.category?.id ?? "",
      description: service.description ?? "",
    });

    // Map existing staffServices into assignments
    const existingAssignments = (service.staffServices || []).map((ss) => ({
      staffId: ss.staffId,
      price: ss.price ? String(ss.price) : "",
      duration: ss.duration ? String(ss.duration) : "",
      margin: ss.margin != null ? String(ss.margin) : "",
      photo: ss.photo ?? "",
    }));
    setStaffAssignments(existingAssignments);

    // Ensure staff from existing assignments are in staffOptions
    // so their assignment cards render correctly
    setStaffOptions((prev) => {
      const existingStaff = (service.staffServices || [])
        .filter((ss) => ss.staff?.user)
        .map((ss) => ({
          id: ss.staff.id,
          user: {
            id: ss.staff.user.id,
            fullName: ss.staff.user.fullName,
            email: ss.staff.user.email,
          },
        }));
      const currentIds = new Set(prev.map((s) => s.id));
      const toAdd = existingStaff.filter((s) => !currentIds.has(s.id));
      return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
    });

    setErrors({});
  }, [open, service]);

  if (!open) return null;

  const selectedStaffIds = staffAssignments.map((a) => a.staffId);

  function handleAddStaff(staffId) {
    if (selectedStaffIds.includes(staffId)) return;
    setStaffAssignments((prev) => [
      ...prev,
      { staffId, price: "", duration: "", margin: "", photo: "" },
    ]);
  }

  function handleRemoveStaff(index) {
    setStaffAssignments((prev) => prev.filter((_, i) => i !== index));
  }

  function handleAssignmentChange(index, updated) {
    setStaffAssignments((prev) => {
      const next = [...prev];
      next[index] = updated;
      return next;
    });
  }

  async function handleAssignExistingService(serviceId) {
    if (assigningServiceId) return;
    setAssigningServiceId(serviceId);
    try {
      const res = await assignServiceToMe(serviceId);
      if (res.success) {
        toast.success(res.message);
        setAssignedServiceIds((prev) => [...prev, serviceId]);
        onCreated?.();
      } else {
        toast.error(res.message);
      }
    } catch {
      toast.error("Une erreur est survenue.");
    } finally {
      setAssigningServiceId(null);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors({});

    // Client-side validation
    let hasError = false;
    const newErrors = {};
    const assignmentErrors = [];

    staffAssignments.forEach((assignment, i) => {
      const aErr = {};
      if (!assignment.price) {
        aErr.price = "Le prix est obligatoire.";
        hasError = true;
      }
      if (!assignment.duration) {
        aErr.duration = "La durée est obligatoire.";
        hasError = true;
      }
      assignmentErrors[i] = aErr;
    });

    if (hasError) {
      setErrors({ assignments: assignmentErrors });
      return;
    }

    const payload = {
      name: form.name,
      categoryId: form.categoryId,
      description: form.description || null,
      staffAssignments: staffAssignments.map((a) => ({
        staffId: a.staffId,
        price: parseFloat(a.price),
        duration: parseInt(a.duration),
        margin: a.margin ? parseFloat(a.margin) : null,
        photo: a.photo || null,
      })),
    };

    const result = isEditing
      ? await updateService({ id: service.id, ...payload })
      : await createService(payload);

    if (result.success) {
      toast.success(result.message);
      onCreated?.();
      onClose();
    } else {
      if (result.errors?.assignments) {
        setErrors({ assignments: result.errors.assignments });
      } else {
        setErrors(result.errors ?? {});
      }
      toast.error(result.message || "Impossible de sauvegarder le service.");
    }
  }

  const staffNotSelected = staffOptions.filter(
    (s) => !selectedStaffIds.includes(s.id)
  );

  // For staff: find existing services in the selected category
  const selectedCategory = categories.find((c) => c.id === form.categoryId);
  const existingServicesInCategory = selectedCategory?.services ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {isEditing ? "Modifier le service" : "Nouveau service"}
            </h2>
            <p className="text-xs text-gray-500">
              {isEditing ? "Modifier les informations du service" : "Ajouter un service et l'associer à des professionnels"}
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
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {/* Catégorie */}
            <ModalField label="Catégorie" required>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Layers size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <select
                    required
                    value={form.categoryId}
                    onChange={(e) => setForm((prev) => ({ ...prev, categoryId: e.target.value }))}
                    className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white"
                  >
                    <option value="">Sélectionner une catégorie…</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCategoryCreate((p) => !p)}
                  title="Créer une nouvelle catégorie"
                  aria-label="Créer une nouvelle catégorie"
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border transition-colors ${
                    showCategoryCreate
                      ? "border-indigo-400 bg-indigo-100 text-indigo-700"
                      : "border-gray-200 bg-white text-gray-500 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
                  }`}
                >
                  <Plus size={16} />
                </button>
              </div>
              {showCategoryCreate && (
                <InlineCategoryCreate
                  onCreated={(newCat) => {
                    setCategories((prev) => [...prev, newCat].sort((a, b) => a.name.localeCompare(b.name, "fr")));
                    setForm((prev) => ({ ...prev, categoryId: newCat.id }));
                    setShowCategoryCreate(false);
                  }}
                  onCancel={() => setShowCategoryCreate(false)}
                />
              )}
              <FieldError message={errors.categoryId} />
            </ModalField>

            {/* Existing services in selected category (staff only) */}
            {isStaff && !isEditing && form.categoryId && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
                <div className="mb-2.5 flex items-center gap-2">
                  <Package size={14} className="text-indigo-600" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                    Services existants dans « {selectedCategory?.name} »
                  </h3>
                </div>

                {existingServicesInCategory.length === 0 ? (
                  <p className="text-xs text-gray-500 italic">
                    Aucun service existant dans cette catégorie. Vous pouvez en créer un ci-dessous.
                  </p>
                ) : (
                  <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                    {existingServicesInCategory.map((svc) => {
                      const isAssigned = assignedServiceIds.includes(svc.id);
                      const isAssigning = assigningServiceId === svc.id;
                      return (
                        <div
                          key={svc.id}
                          className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                            isAssigned
                              ? "border-emerald-200 bg-emerald-50"
                              : "border-gray-200 bg-white"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${
                              isAssigned ? "bg-emerald-100 text-emerald-600" : "bg-gray-100 text-gray-400"
                            }`}>
                              {isAssigned ? <Check size={12} /> : <Package size={12} />}
                            </span>
                            <span className={`truncate font-medium ${isAssigned ? "text-emerald-700" : "text-gray-700"}`}>
                              {svc.name}
                            </span>
                            {svc.staffServicesCount > 0 && (
                              <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                                {svc.staffServicesCount} pro(s)
                              </span>
                            )}
                          </div>
                          {isAssigned ? (
                            <span className="flex-shrink-0 text-xs font-medium text-emerald-600">
                              Ajouté ✓
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleAssignExistingService(svc.id)}
                              disabled={isAssigning}
                              className="flex-shrink-0 inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {isAssigning ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <Plus size={11} />
                              )}
                              Ajouter
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <p className="mt-2.5 border-t border-indigo-100 pt-2 text-[11px] text-indigo-500">
                  Un service peut être proposé par plusieurs professionnels. Sélectionnez un service existant
                  pour l'ajouter à votre profil, ou créez un nouveau service ci-dessous.
                </p>
              </div>
            )}

            {/* Nom */}
            <ModalField label="Nom du service" required>
              <div className="relative">
                <Tag size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="ex. Coupe Homme"
                />
              </div>
              <FieldError message={errors.name} />
            </ModalField>

            {/* Description */}
            <ModalField label="Description">
              <div className="relative">
                <FileText size={14} className="pointer-events-none absolute left-3 top-4 text-gray-400" />
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 pl-8 pr-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 min-h-[80px] resize-none"
                  placeholder="Description du service..."
                />
              </div>
              <FieldError message={errors.description} />
            </ModalField>

            {/* Staff Assignments — shown for both admin/owner and staff */}
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                  {isStaff ? "Mes informations de service" : "Professionnels associés"}
                </h3>
                {!isStaff && staffNotSelected.length > 0 && (
                  <div className="relative">
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) handleAddStaff(e.target.value);
                      }}
                      className="h-8 rounded-lg border border-dashed border-gray-300 px-3 text-xs text-gray-500 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 bg-white cursor-pointer appearance-none"
                    >
                      <option value="">+ Ajouter un professionnel</option>
                      {staffNotSelected.map((staff) => (
                        <option key={staff.id} value={staff.id}>
                          {staff.user.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {staffAssignments.length === 0 ? (
                <p className="text-xs text-gray-400 italic py-3 text-center border border-dashed border-gray-200 rounded-lg">
                  {isStaff
                    ? "Vos informations de service seront configurées après la création."
                    : "Aucun professionnel associé. Ajoutez-en un depuis le menu déroulant ci-dessus."}
                </p>
              ) : (
                <div className="space-y-3">
                  {staffAssignments.map((assignment, index) => {
                    const staff = staffOptions.find((s) => s.id === assignment.staffId);
                    if (!staff) return null;
                    return (
                      <StaffAssignmentCard
                        key={assignment.staffId}
                        staff={staff}
                        index={index}
                        assignment={assignment}
                        onChange={handleAssignmentChange}
                        onRemove={handleRemoveStaff}
                        canRemove={!isStaff && staffAssignments.length > 1}
                        errors={errors.assignments?.[index]}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Annuler
            </button>
            <Button type="submit" disabled={loading} className="bg-[#2f3a2e]">
              {loading ? <Loader2 size={15} className="animate-spin mr-1.5" /> : null}
              {isEditing ? "Mettre à jour" : "Créer le service"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}