import { z } from "zod";

/**
 * Boolean parser for form/server-action payloads.
 *
 * z.coerce.boolean() uses JavaScript truthiness, so the string "false"
 * becomes true. That is almost never what a dashboard form or querystring
 * means. This helper accepts real booleans plus common string/number
 * encodings, while still supporting a default for omitted values.
 */
export function formBoolean(defaultValue = false) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1 ? true : value === 0 ? false : value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "on", "yes"].includes(normalized)) return true;
      if (["false", "0", "off", "no"].includes(normalized)) return false;
    }
    return value;
  }, z.boolean().optional().default(defaultValue));
}
