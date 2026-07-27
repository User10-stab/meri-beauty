import crypto from "crypto";

const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const lower = "abcdefghjkmnpqrstuvwxyz";
const digits = "23456789";
const symbols = "!@#$%^&*";
const all = upper + lower + digits + symbols;

const pick = (str) => str[crypto.randomInt(str.length)];

export function generateSecurePassword() {
  const required = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  const rest = Array.from({ length: 12 }, () => pick(all));
  const combined = [...required, ...rest];

  for (let i = combined.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
  return combined.join("");
}