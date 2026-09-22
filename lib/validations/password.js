// Shared client-chosen-password rule used by every signup surface (reservation,
// formation, workshop, boutique checkout): the account is always created with
// the password the customer picks here — never generated, never emailed.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;

export function validatePassword(value) {
  const password = typeof value === "string" ? value : "";
  if (!password) return "required";
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) return "length";
  return null;
}
