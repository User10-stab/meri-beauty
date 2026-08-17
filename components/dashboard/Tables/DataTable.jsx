"use client";

import { useState, useMemo, useCallback } from "react";
import { ClipboardList } from "lucide-react";
import { SearchBar } from "./SearchBar";
import { PerPageSelector } from "./PerPageSelector";
import { SortableTableHead } from "./SortableTableHead";
import { RowActions } from "./RowActions";
import { Pagination } from "./Pagination";
import { EmptyState } from "./EmptyState";

// ─── helpers ────────────────────────────────────────────────────────────────

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

function copyToClipboard(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

// ─── Skeleton row ────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-4 py-4">
          <div className="h-4 animate-pulse rounded bg-gray-100" />
        </td>
      ))}
    </tr>
  );
}

// ─── Default column definitions ───────────────────────────────────────────────

const DEFAULT_COLUMNS = [
  { key: "id", label: "Id" },
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "emailVerified", label: "Email Verified" },
  { key: "role", label: "Role" },
  { key: "joinedAt", label: "Joined At" },
];

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {Array<object>} props.data       - full dataset
 * @param {boolean} [props.isLoading]      - show skeleton rows
 * @param {string} [props.title]           - optional card title
 * @param {Array<{key: string, label: string}>} [props.columns] - column definitions
 * @param {(row: object) => void} [props.onView] - view action handler
 * @param {(row: object) => void} [props.onEdit] - edit action handler
 * @param {(row: object) => void} [props.onDelete] - delete action handler
 * @param {(row: object) => void} [props.onApprove] - approve action handler
 * @param {(row: object) => void} [props.onReject] - reject action handler
 * @param {React.ComponentType<{row: object, onView?: Function, onEdit?: Function, onDelete?: Function, onApprove?: Function, onReject?: Function}>} [props.renderRow] - custom row renderer
 * @param {string} [props.searchPlaceholder] - placeholder for search bar
 * @param {(row: object, query: string) => boolean} [props.searchFilter] - custom search filter
 * @param {React.ComponentType} [props.emptyState] - custom empty state component
 * @param {{ page: number, pageSize: number, totalCount: number, onPageChange: (page: number) => void, onPerPageChange?: (perPage: number) => void }} [props.serverPagination] -
 *   when provided, `data` is treated as an already-filtered, already-paginated
 *   page fetched from the server (search/sort/slicing below are skipped —
 *   the caller owns fetching each page). Omit for the original fully
 *   client-side behavior.
 * @param {(query: string) => void} [props.onSearchChange] - required alongside
 *   `serverPagination` to make the search box re-fetch from the server
 *   instead of filtering the (already-partial) `data` in memory.
 */
export function DataTable({
  data,
  isLoading = false,
  title,
  columns = DEFAULT_COLUMNS,
  onView,
  onEdit,
  onDelete,
  onApprove,
  onReject,
  // Reservation-specific: settling the on-site balance and marking a
  // no-show. Passed straight through to a custom row renderer, like the
  // handlers above — a row that doesn't use them simply ignores them.
  onSettle,
  onNoShow,
  renderRow: CustomRow,
  searchPlaceholder,
  searchFilter,
  emptyState: CustomEmptyState,
  serverPagination,
  onSearchChange,
}) {
  const [search, setSearch] = useState("");
  const [perPage, setPerPage] = useState(serverPagination?.pageSize ?? 5);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState(null); // "asc" | "desc"

  // ── Sort handler ──────────────────────────────────────────────────────────
  const handleSort = useCallback(
    (column) => {
      if (sortKey !== column) {
        setSortKey(column);
        setSortDir("asc");
      } else if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        setSortKey(null);
        setSortDir(null);
      }
      setCurrentPage(1);
    },
    [sortKey, sortDir],
  );

  // ── Filter ────────────────────────────────────────────────────────────────
  // In server-pagination mode, `data` IS the current page already filtered
  // server-side — skip client-side filtering entirely (filtering only the
  // current page's rows would silently miss matches on every other page).
  const filtered = useMemo(() => {
    if (serverPagination) return data;

    const q = search.trim().toLowerCase();
    if (!q) return data;

    if (searchFilter) {
      return data.filter(row => searchFilter(row, q));
    }

    // Default filter for backward compatibility
    return data.filter(
      (row) =>
        row.id?.toLowerCase().includes(q) ||
        row.name?.toLowerCase().includes(q) ||
        row.email?.toLowerCase().includes(q),
    );
  }, [data, search, searchFilter, serverPagination]);

  // ── Sort ──────────────────────────────────────────────────────────────────
  // Sorting still happens client-side even in server-pagination mode — it
  // only reorders the current page's rows, which is a reasonable trade-off
  // against adding server-side sort params for what's a "nice to have" here.
  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "boolean") {
        return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
      }
      const cmp = String(av).localeCompare(String(bv), undefined, {
        sensitivity: "base",
      });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  // ── Paginate ──────────────────────────────────────────────────────────────
  const totalPages = serverPagination
    ? Math.max(1, Math.ceil(serverPagination.totalCount / serverPagination.pageSize))
    : Math.max(1, Math.ceil(sorted.length / perPage));
  const safePage = serverPagination ? serverPagination.page : Math.min(currentPage, totalPages);
  const pageRows = serverPagination ? sorted : sorted.slice((safePage - 1) * perPage, safePage * perPage);

  function handleSearchChange(value) {
    setSearch(value);
    setCurrentPage(1);
    if (serverPagination) onSearchChange?.(value);
  }

  function handlePerPageChange(value) {
    setPerPage(value);
    setCurrentPage(1);
    if (serverPagination) serverPagination.onPerPageChange?.(value);
  }

  function handlePageChange(value) {
    if (serverPagination) serverPagination.onPageChange(value);
    else setCurrentPage(value);
  }

  // Passed through as-is (not always-truthy wrappers) — RowActions decides
  // which menu items to render based on whether each handler is defined at
  // all, so an absent handler (e.g. a non-admin viewer with no onEdit) must
  // stay undefined here rather than become a callable no-op.
  const handleView = onView ? (row) => onView(row) : undefined;
  const handleEdit = onEdit ? (row) => onEdit(row) : undefined;
  const handleDelete = onDelete ? (row) => onDelete(row) : undefined;
  const handleApprove = onApprove ? (row) => onApprove(row) : undefined;
  const handleReject = onReject ? (row) => onReject(row) : undefined;

  const EmptyStateComponent = CustomEmptyState || EmptyState;

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm h-[62vh]">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        {title && (
          <h2 className="text-base font-semibold text-gray-800">{title}</h2>
        )}
        <SearchBar value={search} onChange={handleSearchChange} placeholder={searchPlaceholder} />
        <div className="ml-auto">
          <PerPageSelector value={perPage} onChange={handlePerPageChange} />
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full border-collapse text-sm">
          {/* sticky header */}
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-y border-gray-100">
              {columns.map((col) => (
                <SortableTableHead
                  key={col.key}
                  column={col.key}
                  label={col.label}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  className={col.key === "id" ? "pl-5" : ""}
                />
              ))}
              {/* Actions — not sortable */}
              <th
                scope="col"
                className="h-12 px-4 text-right align-middle text-sm font-semibold text-gray-500 pr-5"
              >
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              Array.from({ length: perPage }).map((_, i) => (
                <SkeletonRow key={i} />
              ))
            ) : pageRows.length === 0 ? (
              <EmptyStateComponent />
            ) : (
              pageRows.map((row) => (
                CustomRow ? (
                  <CustomRow
                    key={row.id || row.fullId}
                    row={row}
                    onView={handleView}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onSettle={onSettle}
                    onNoShow={onNoShow}
                  />
                ) : (
                  <TableRow
                    key={row.fullId}
                    row={row}
                    onView={handleView}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                )
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {!isLoading && (serverPagination ? serverPagination.totalCount > 0 : sorted.length > 0) && (
        <div className="flex items-center justify-start gap-2 border-t border-gray-100 px-5 py-4">
          <Pagination
            currentPage={safePage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  );
}

// ─── Table row ───────────────────────────────────────────────────────────────

function TableRow({ row, onView, onEdit, onDelete }) {
  return (
    <tr className="group border-b border-gray-100 transition-colors hover:bg-gray-50/70">
      {/* Id */}
      <td className="px-4 py-4 pl-5 align-middle">
        <div className="flex items-center gap-1.5">
          <span className="max-w-[140px] truncate font-mono text-xs text-gray-500">
            {row.id}
          </span>
          <button
            type="button"
            onClick={() => copyToClipboard(row.fullId)}
            title="Copy full ID"
            aria-label={`Copy ID for ${row.name}`}
            className="
              flex-shrink-0 rounded p-0.5 text-gray-300
              opacity-0 transition-opacity group-hover:opacity-100
              hover:text-gray-600 focus-visible:opacity-100
              focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500
            "
          >
            <ClipboardList size={13} />
          </button>
        </div>
      </td>

      {/* Name */}
      <td className="px-4 py-4 align-middle">
        <span className="font-medium text-gray-800">{row.name}</span>
      </td>

      {/* Email */}
      <td className="px-4 py-4 align-middle">
        <span className="text-indigo-600">{row.email}</span>
      </td>

      {/* Email Verified */}
      <td className="px-4 py-4 align-middle">
        <VerifiedBadge verified={row.emailVerified} />
      </td>

      {/* Role */}
      <td className="px-4 py-4 align-middle">
        <span className="text-gray-700">{row.role}</span>
      </td>

      {/* Joined At */}
      <td className="px-4 py-4 align-middle">
        <span className="whitespace-nowrap text-gray-600">
          {formatDate(row.joinedAt)}
        </span>
      </td>

      {/* Actions */}
      <td className="px-4 py-4 pr-5 align-middle">
        <RowActions
          row={row}
          onView={onView}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </td>
    </tr>
  );
}

// ─── Verified badge ───────────────────────────────────────────────────────────

function VerifiedBadge({ verified }) {
  return (
    <span
      className={`text-sm ${verified ? "text-gray-700" : "text-gray-400"}`}
    >
      {verified ? "Verified" : "Not verified"}
    </span>
  );
}
