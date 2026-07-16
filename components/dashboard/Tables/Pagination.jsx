"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Generates a page number array with ellipsis ("...") where needed.
 * Always shows first, last, current, and neighbours.
 */
function buildPageRange(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = new Set([1, total, current]);
  if (current > 1) pages.add(current - 1);
  if (current < total) pages.add(current + 1);

  const sorted = [...pages].sort((a, b) => a - b);
  const result = [];

  for (let i = 0; i < sorted.length; i++) {
    result.push(sorted[i]);
    if (sorted[i + 1] && sorted[i + 1] - sorted[i] > 1) {
      result.push("...");
    }
  }

  return result;
}

/**
 * @param {object} props
 * @param {number} props.currentPage
 * @param {number} props.totalPages
 * @param {(page: number) => void} props.onPageChange
 */
export function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  const pages = buildPageRange(currentPage, totalPages);

  return (
    <nav
      role="navigation"
      aria-label="Pagination"
      className="flex items-center gap-1 flex-wrap"
    >
      {/* Prev */}
      <PaginationButton
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        aria-label="Go to previous page"
      >
        <ChevronLeft size={15} />
      </PaginationButton>

      {/* Page numbers */}
      {pages.map((page, idx) =>
        page === "..." ? (
          <span
            key={`ellipsis-${idx}`}
            className="flex h-8 w-8 items-center justify-center text-sm text-gray-400 select-none"
            aria-hidden="true"
          >
            …
          </span>
        ) : (
          <PaginationButton
            key={page}
            onClick={() => onPageChange(page)}
            isActive={page === currentPage}
            aria-label={`Go to page ${page}`}
            aria-current={page === currentPage ? "page" : undefined}
          >
            {page}
          </PaginationButton>
        ),
      )}

      {/* Next */}
      <PaginationButton
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        aria-label="Go to next page"
      >
        <ChevronRight size={15} />
      </PaginationButton>
    </nav>
  );
}

function PaginationButton({ children, isActive, disabled, onClick, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`
        flex h-8 w-8 items-center justify-center rounded-md text-sm
        font-medium transition-colors select-none
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500
        ${
          isActive
            ? "bg-indigo-600 text-white shadow-sm"
            : disabled
            ? "cursor-not-allowed text-gray-300"
            : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        }
      `}
      {...rest}
    >
      {children}
    </button>
  );
}
