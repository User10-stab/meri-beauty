"use client";

import { STAFF_PERMISSION_OPTIONS } from "@/lib/authorization";

export function StaffPermissionsField({ value = [], onChange, error }) {
  const selected = new Set(value);

  function toggle(permission) {
    const next = new Set(selected);
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    onChange([...next]);
  }

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2">
        {STAFF_PERMISSION_OPTIONS.map((permission) => {
          const checked = selected.has(permission.key);
          return (
            <label
              key={permission.key}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                checked
                  ? "border-indigo-300 bg-indigo-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(permission.key)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">{permission.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{permission.description}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-1 text-xs font-medium text-red-600">{error}</p>}
      <p className="mt-2 text-xs text-gray-500">
        Les administrateurs gardent toujours tous les accès. Les droits non cochés sont masqués et bloqués côté serveur pour ce membre du staff.
      </p>
    </div>
  );
}
