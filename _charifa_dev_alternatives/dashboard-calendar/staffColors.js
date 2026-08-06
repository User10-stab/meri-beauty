/**
 * Deterministic staff color palette.
 * Each staff member always gets the same color based on their ID.
 * Colors are soft pastels that work well as calendar card backgrounds.
 */

export const STAFF_PALETTE = [
  // bg (card bg)       border          text            dot
  { bg: "#EDE9FE", border: "#C4B5FD", text: "#5B21B6", dot: "#7C3AED" }, // violet
  { bg: "#DBEAFE", border: "#BFDBFE", text: "#1E40AF", dot: "#2563EB" }, // blue
  { bg: "#D1FAE5", border: "#A7F3D0", text: "#065F46", dot: "#059669" }, // emerald
  { bg: "#FCE7F3", border: "#F9A8D4", text: "#9D174D", dot: "#DB2777" }, // pink
  { bg: "#FEF3C7", border: "#FDE68A", text: "#92400E", dot: "#D97706" }, // amber
  { bg: "#CFFAFE", border: "#A5F3FC", text: "#164E63", dot: "#0891B2" }, // cyan
  { bg: "#FEE2E2", border: "#FECACA", text: "#991B1B", dot: "#DC2626" }, // red
  { bg: "#F3F4F6", border: "#E5E7EB", text: "#374151", dot: "#6B7280" }, // gray
  { bg: "#ECFDF5", border: "#BBF7D0", text: "#14532D", dot: "#16A34A" }, // green
  { bg: "#FDF4FF", border: "#F0ABFC", text: "#701A75", dot: "#A21CAF" }, // fuchsia
];

/**
 * Return a stable color palette entry for a given staff ID.
 * The color is deterministic — same ID always maps to the same palette slot.
 *
 * @param {string} staffId
 * @returns {{ bg: string, border: string, text: string, dot: string }}
 */
export function getStaffColor(staffId) {
  if (!staffId) return STAFF_PALETTE[7]; // fallback gray

  // Simple hash: sum char codes mod palette length
  let hash = 0;
  for (let i = 0; i < staffId.length; i++) {
    hash = (hash + staffId.charCodeAt(i)) % STAFF_PALETTE.length;
  }
  return STAFF_PALETTE[hash];
}
