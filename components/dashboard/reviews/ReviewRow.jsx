/**
 * ReviewRow component for displaying a single review in the reviews table.
 */
export function ReviewRow({ row, onDelete }) {
  const renderRating = (rating) => {
    const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
    return <span className="text-yellow-500">{stars}</span>;
  };

  const formatDate = (dateString) => {
    if (!dateString) return "—";
    return new Date(dateString).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <tr className="border-b border-stroke dark:border-dark-3 hover:bg-gray-50 dark:hover:bg-dark-2 transition-colors">
      <td className="px-6 py-4">
        <div>
          <div className="font-medium text-dark dark:text-white">{row.customerName}</div>
          <div className="text-sm text-gray-500 dark:text-dark-6">{row.customerEmail || "—"}</div>
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="text-lg">{renderRating(row.rating)}</div>
      </td>
      <td className="px-6 py-4">
        <div className="text-sm text-dark dark:text-white">{row.serviceName}</div>
      </td>
      <td className="px-6 py-4">
        <div className="text-sm text-dark dark:text-white">{row.staffName || "—"}</div>
      </td>
      <td className="px-6 py-4">
        <div className="max-w-xs truncate text-sm text-gray-600 dark:text-dark-6">
          {row.comment || "—"}
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="text-sm text-gray-500 dark:text-dark-6">{formatDate(row.createdAt)}</div>
      </td>
      <td className="px-6 py-4">
        <button
          onClick={() => onDelete(row)}
          className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
          title="Supprimer"
        >
          🗑️
        </button>
      </td>
    </tr>
  );
}
