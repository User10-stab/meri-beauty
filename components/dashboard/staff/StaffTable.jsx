"use client";

import { useState, useMemo, useCallback, useTransition } from "react";
import { toast } from "sonner";
import {
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  MoreHorizontal,
  Eye,
  Pencil,
  Trash2,
  Users,
  ShieldCheck,
  ShieldOff,
  Clock,
} from "lucide-react";
import { deleteIndependentStaff } from "@/actions/staff/delete-independent-staff";
import { updateIndependentStaff } from "@/actions/staff/update-independent-staff";
import { EditStaffModal } from "./EditStaffModal";
import { WorkingHoursModal } from "./WorkingHoursModal";

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ─── Column definitions ───────────────────────────────────────────────────────

const COLUMNS = [
  { key: "photo", label: "Photo" },
  { key: "fullName", label: "Nom" },
  { key: "email", label: "E-mail" },
  { key: "phone", label: "Téléphone" },
  { key: "languages", label: "Langues" },
  { key: "services", label: "Services" },
  { key: "hireDate", label: "Date d'embauche" },
  { key: "isActive", label: "Statut" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SearchBar({ value, onChange }) {
  return (
    <div className="relative">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Rechercher par nom, e-mail ou téléphone..."
        aria-label="Rechercher un auto-entrepreneur"
        className="h-9 w-64 rounded-md border border-gray-200 bg-white pl-3 pr-10 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 sm:w-72"
      />
      <button
        type="button"
        aria-label="Lancer la recherche"
        className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center rounded-r-md text-white transition-colors bg-[#2f3a2e] hover:bg-[#3d4e3b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f3a2e] active:scale-[0.98]"
      >
        <Search size={15} strokeWidth={2.5} />
      </button>
    </div>
  );
}

function PerPageSelector({ value, onChange }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-600">
      <span className="whitespace-nowrap font-medium">Par page :</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Lignes par page"
          className="h-9 appearance-none rounded-md border border-gray-200 bg-white py-1 pl-3 pr-7 text-sm text-gray-700 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 cursor-pointer"
        >
          {[5, 10, 20, 50].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" />
      </div>
    </div>
  );
}

function SortableTh({ column, label, sortKey, sortDir, onSort, className = "" }) {
  const isActive = sortKey === column;
  const Icon = isActive ? (sortDir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <th className={`h-12 px-4 text-left align-middle text-sm font-semibold text-gray-500 whitespace-nowrap ${className}`}>
      <button
        type="button"
        onClick={() => onSort(column)}
        aria-label={`Trier par ${label}`}
        className="inline-flex items-center gap-1 rounded transition-colors hover:text-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
      >
        <span className={isActive ? "text-indigo-600" : ""}>{label}</span>
        <Icon size={14} className={isActive ? "text-indigo-600" : "text-gray-400"} />
      </button>
    </th>
  );
}

function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  function buildRange(cur, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = new Set([1, total, cur]);
    if (cur > 1) pages.add(cur - 1);
    if (cur < total) pages.add(cur + 1);
    const sorted = [...pages].sort((a, b) => a - b);
    const result = [];
    for (let i = 0; i < sorted.length; i++) {
      result.push(sorted[i]);
      if (sorted[i + 1] && sorted[i + 1] - sorted[i] > 1) result.push("...");
    }
    return result;
  }

  const pages = buildRange(currentPage, totalPages);

  return (
    <nav role="navigation" aria-label="Pagination" className="flex items-center gap-1 flex-wrap">
      <PageBtn onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} aria-label="Page précédente">
        <ChevronLeft size={15} />
      </PageBtn>
      {pages.map((page, idx) =>
        page === "..." ? (
          <span key={`e-${idx}`} className="flex h-8 w-8 items-center justify-center text-sm text-gray-400 select-none" aria-hidden="true">…</span>
        ) : (
          <PageBtn key={page} onClick={() => onPageChange(page)} isActive={page === currentPage} aria-label={`Page ${page}`} aria-current={page === currentPage ? "page" : undefined}>
            {page}
          </PageBtn>
        )
      )}
      <PageBtn onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} aria-label="Page suivante">
        <ChevronRight size={15} />
      </PageBtn>
    </nav>
  );
}

function PageBtn({ children, isActive, disabled, onClick, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 w-8 items-center justify-center rounded-md text-sm font-medium transition-colors select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${
        isActive ? "bg-indigo-600 text-white shadow-sm"
        : disabled ? "cursor-not-allowed text-gray-300"
        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

function SkeletonRow({ cols }) {
  return (
    <tr className="border-b border-gray-100">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-4">
          {i === 0 ? (
            <div className="flex items-center justify-center">
              <div className="h-10 w-10 animate-pulse rounded-full bg-gray-100" />
            </div>
          ) : (
            <div className="h-4 animate-pulse rounded bg-gray-100" />
          )}
        </td>
      ))}
    </tr>
  );
}

function EmptyState({ hasSearch }) {
  return (
    <tr>
      <td colSpan={COLUMNS.length + 1}>
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
            <Users size={24} className="text-gray-400" />
          </div>
          <div>
            <p className="font-semibold text-gray-700">
              {hasSearch ? "Aucun résultat trouvé" : "Aucun auto-entrepreneur"}
            </p>
            <p className="mt-1 text-sm text-gray-400">
              {hasSearch
                ? "Essayez un autre terme de recherche."
                : "Créez votre premier auto-entrepreneur en cliquant sur « Nouveau »."}
            </p>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── Row actions dropdown ─────────────────────────────────────────────────────

function RowActions({ row, onEdit, onDelete, isPending }) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  // Close on outside click
  const handleBlur = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) close();
  }, [close]);

  return (
    <div className="relative flex justify-end" onBlur={handleBlur}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Actions sur la ligne"
        disabled={isPending}
        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-40"
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Menu d'actions"
          className="absolute right-0 top-full z-40 mt-1 w-48 origin-top-right rounded-lg border border-gray-100 bg-white py-1 shadow-lg shadow-gray-200/60 animate-in fade-in-0 zoom-in-95"
        >
          <MenuBtn icon={Eye} label="Voir le profil" onClick={() => { close(); onEdit(row, "view"); }} />
          <MenuBtn icon={Pencil} label="Modifier" onClick={() => { close(); onEdit(row, "edit"); }} />
          <MenuBtn icon={Clock} label="Horaires de travail" onClick={() => { close(); onEdit(row, "hours"); }} />
          <MenuBtn icon={row.isActive ? ShieldOff : ShieldCheck} label={row.isActive ? "Désactiver" : "Activer"} onClick={() => { close(); onEdit(row, "toggle"); }} />
          <div className="my-1 border-t border-gray-100" role="separator" />
          <MenuBtn icon={Trash2} label="Supprimer" danger onClick={() => { close(); onDelete(row); }} />
        </div>
      )}
    </div>
  );
}

function MenuBtn({ icon: Icon, label, onClick, danger }) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors focus-visible:bg-gray-50 focus-visible:outline-none ${
        danger ? "text-red-500 hover:bg-red-50" : "text-gray-700 hover:bg-gray-50"
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

// ─── Delete confirmation dialog ───────────────────────────────────────────────

function DeleteDialog({ staff, onConfirm, onCancel, isPending }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-100">
            <Trash2 size={20} className="text-red-600" />
          </div>
          <div>
            <h2 id="delete-dialog-title" className="text-base font-semibold text-gray-900">
              Confirmer la suppression
            </h2>
            <p className="text-sm text-gray-500">Cette action est irréversible.</p>
          </div>
        </div>
        <p className="text-sm text-gray-700 mb-6">
          Êtes-vous sûr de vouloir supprimer le profil de{" "}
          <strong>{staff?.user?.fullName}</strong> ? Son compte utilisateur sera également supprimé.
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {isPending && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            Supprimer définitivement
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main table ───────────────────────────────────────────────────────────────

/**
 * @param {{ data: Array<object>, isLoading?: boolean, services?: Array<object> }} props
 */
export function StaffTable({ data, isLoading = false, services = [] }) {
  const [search, setSearch] = useState("");
  const [perPage, setPerPage] = useState(5);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState(null);

  const [editTarget, setEditTarget] = useState(null);   // { staff, mode: "view"|"edit" }
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [workingHoursTarget, setWorkingHoursTarget] = useState(null);

  const [isPending, startTransition] = useTransition();

  // ── Sort ────────────────────────────────────────────────────────────────
  const handleSort = useCallback((col) => {
    setSortKey((prev) => {
      if (prev !== col) { setSortDir("asc"); return col; }
      if (sortDir === "asc") { setSortDir("desc"); return col; }
      setSortDir(null); return null;
    });
    setCurrentPage(1);
  }, [sortDir]);

  // ── Filter ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter(
      (r) =>
        r.user.fullName.toLowerCase().includes(q) ||
        r.user.email.toLowerCase().includes(q) ||
        r.user.phone.toLowerCase().includes(q)
    );
  }, [data, search]);

  // ── Sort ────────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered;
    return [...filtered].sort((a, b) => {
      let av, bv;
      if (sortKey === "fullName") { av = a.user.fullName; bv = b.user.fullName; }
      else if (sortKey === "email") { av = a.user.email; bv = b.user.email; }
      else if (sortKey === "phone") { av = a.user.phone; bv = b.user.phone; }
      else if (sortKey === "isActive") { av = a.isActive; bv = b.isActive; }
      else if (sortKey === "hireDate") { av = a.hireDate ?? ""; bv = b.hireDate ?? ""; }
      else { av = a[sortKey] ?? ""; bv = b[sortKey] ?? ""; }
      if (typeof av === "boolean") return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv), "fr")
        : String(bv).localeCompare(String(av), "fr");
    });
  }, [filtered, sortKey, sortDir]);

  // ── Paginate ────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = sorted.slice((safePage - 1) * perPage, safePage * perPage);

  function handleSearch(val) { setSearch(val); setCurrentPage(1); }
  function handlePerPage(val) { setPerPage(val); setCurrentPage(1); }

  // ── Row action handlers ─────────────────────────────────────────────────
  function handleRowAction(staff, mode) {
    if (mode === "hours") {
      setWorkingHoursTarget(staff);
      return;
    }
    if (mode === "toggle") {
      startTransition(async () => {
        const res = await updateIndependentStaff({
          id: staff.id,
          bio: staff.bio,
          languages: staff.languages,
          hireDate: staff.hireDate,
          isActive: !staff.isActive,
        });
        if (res.success) toast.success(res.message);
        else toast.error(res.message);
      });
    } else {
      setEditTarget({ staff, mode });
    }
  }

  function handleDeleteClick(staff) { setDeleteTarget(staff); }

  function handleDeleteConfirm() {
    startTransition(async () => {
      const res = await deleteIndependentStaff({ id: deleteTarget.id });
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
      setDeleteTarget(null);
    });
  }

  return (
    <>
      <div className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm h-[62vh] overflow-y-auto">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <SearchBar value={search} onChange={handleSearch} />
          <div className="ml-auto">
            <PerPageSelector value={perPage} onChange={handlePerPage} />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm" aria-label="Liste des auto-entrepreneurs">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-gray-100">
                {COLUMNS.map((col) => (
                  <SortableTh
                    key={col.key}
                    column={col.key}
                    label={col.label}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className={col.key === "fullName" ? "pl-5" : ""}
                  />
                ))}
                <th scope="col" className="h-12 px-4 pr-5 text-right align-middle text-sm font-semibold text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: perPage }).map((_, i) => (
                  <SkeletonRow key={i} cols={COLUMNS.length + 1} />
                ))
              ) : pageRows.length === 0 ? (
                <EmptyState hasSearch={search.length > 0} />
              ) : (
                pageRows.map((staff) => (
                  <StaffRow
                    key={staff.id}
                    staff={staff}
                    onAction={handleRowAction}
                    onDelete={handleDeleteClick}
                    isPending={isPending}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!isLoading && sorted.length > 0 && (
          <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-5 py-4">
            <p className="text-xs text-gray-400">
              {sorted.length} auto-entrepreneur{sorted.length > 1 ? "s" : ""}
            </p>
            <Pagination
              currentPage={safePage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          </div>
        )}
      </div>

      {/* Edit / View modal */}
      {editTarget && editTarget.mode !== "hours" && (
        <EditStaffModal
          staff={editTarget.staff}
          mode={editTarget.mode}
          services={services}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Working Hours modal */}
      {workingHoursTarget && (
        <WorkingHoursModal
          staff={workingHoursTarget}
          onClose={() => setWorkingHoursTarget(null)}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <DeleteDialog
          staff={deleteTarget}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
          isPending={isPending}
        />
      )}
    </>
  );
}

// ─── Individual table row ─────────────────────────────────────────────────────

function StaffRow({ staff, onAction, onDelete, isPending }) {
  const photoUrl = staff.photo ?? staff.user.avatar ?? null;
  const hasPhoto = Boolean(photoUrl);
  return (
    <tr className="group border-b border-gray-100 transition-colors hover:bg-gray-50/70">
      {/* Photo */}
      <td className="px-4 py-4 pl-5 align-middle">
        <div className="flex items-center justify-center">
          {hasPhoto ? (
            <img
              src={photoUrl}
              alt={`Photo de ${staff.user.fullName}`}
              className="h-10 w-10 rounded-full object-cover border border-gray-200"
              onError={(e) => {
                const img = e.currentTarget;
                img.style.display = "none";
                const fallback = img.nextElementSibling;
                if (fallback instanceof HTMLElement) {
                  fallback.style.display = "flex";
                }
              }}
            />
          ) : null}
          <div
            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 uppercase select-none ${
              hasPhoto ? "hidden" : "flex"
            }`}
          >
            {staff.user.fullName.slice(0, 2)}
          </div>
        </div>
      </td>

      {/* Nom */}
      <td className="px-4 py-4 align-middle">
        <div>
          <p className="font-medium text-gray-800 leading-tight">{staff.user.fullName}</p>
          <p className="text-xs text-gray-400">{staff.servicesCount} service{staff.servicesCount !== 1 ? "s" : ""}</p>
        </div>
      </td>

      {/* E-mail */}
      <td className="px-4 py-4 align-middle">
        <span className="text-indigo-600">{staff.user.email}</span>
      </td>

      {/* Téléphone */}
      <td className="px-4 py-4 align-middle text-gray-600">
        {staff.user.phone}
      </td>

      {/* Langues */}
      <td className="px-4 py-4 align-middle">
        <div className="flex flex-wrap gap-1">
          {staff.languages.length > 0 ? (
            staff.languages.map((lang) => (
              <span key={lang} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                {lang}
              </span>
            ))
          ) : (
            <span className="text-gray-400 text-xs">—</span>
          )}
        </div>
      </td>

      {/* Services */}
      <td className="px-4 py-4 align-middle">
        {staff.services && staff.services.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {staff.services.slice(0, 3).map((s) => (
              <span
                key={s.id}
                className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 border border-indigo-100"
              >
                {s.name}
              </span>
            ))}
            {staff.services.length > 3 && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                +{staff.services.length - 3}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-gray-400">Aucun service</span>
        )}
      </td>

      {/* Date d'embauche */}
      <td className="px-4 py-4 align-middle text-gray-600 whitespace-nowrap">
        {formatDate(staff.hireDate)}
      </td>

      {/* Statut */}
      <td className="px-4 py-4 align-middle">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
          staff.isActive
            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
            : "bg-gray-100 text-gray-500 border border-gray-200"
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${staff.isActive ? "bg-emerald-500" : "bg-gray-400"}`} />
          {staff.isActive ? "Actif" : "Inactif"}
        </span>
      </td>

      {/* Actions */}
      <td className="px-4 py-4 pr-5 align-middle">
        <RowActions
          row={staff}
          onEdit={onAction}
          onDelete={onDelete}
          isPending={isPending}
        />
      </td>
    </tr>
  );
}