import { Users } from "lucide-react";

/**
 * @param {object} props
 * @param {string} [props.title]
 * @param {string} [props.description]
 */
export function EmptyState({
  title = "No users found",
  description = "Try adjusting your search or filters.",
}) {
  return (
    <tr>
      <td colSpan={7}>
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
            <Users size={24} className="text-gray-400" />
          </div>
          <div>
            <p className="font-semibold text-gray-700">{title}</p>
            <p className="mt-1 text-sm text-gray-400">{description}</p>
          </div>
        </div>
      </td>
    </tr>
  );
}
