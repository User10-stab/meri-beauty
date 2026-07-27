import { hkdf } from "@panva/hkdf";
import { jwtDecrypt, base64url, calculateJwkThumbprint } from "jose";

const alg = "dir";
const enc = "A256CBC-HS512";

async function getDerivedEncryptionKey(encryptionAlg, keyMaterial, salt) {
  let length;
  switch (encryptionAlg) {
    case "A256CBC-HS512":
      length = 64;
      break;
    case "A256GCM":
      length = 32;
      break;
    default:
      throw new Error("Unsupported JWT Content Encryption Algorithm");
  }
  return await hkdf(
    "sha256",
    keyMaterial,
    salt,
    `Auth.js Generated Encryption Key (${salt})`,
    length
  );
}

export async function decryptToken(token, secret, salt) {
  if (!token || !secret) return null;

  try {
    const { payload } = await jwtDecrypt(
      token,
      async ({ kid, enc: encryptionAlg }) => {
        const encryptionSecret = await getDerivedEncryptionKey(
          encryptionAlg ?? enc,
          secret,
          salt
        );
        if (kid === undefined) return encryptionSecret;
        const thumbprint = await calculateJwkThumbprint(
          { kty: "oct", k: base64url.encode(encryptionSecret) },
          `sha${encryptionSecret.byteLength << 3}`
        );
        if (kid === thumbprint) return encryptionSecret;
        throw new Error("no matching decryption secret");
      },
      {
        clockTolerance: 15,
        keyManagementAlgorithms: [alg],
        contentEncryptionAlgorithms: [enc, "A256GCM"],
      }
    );
    return payload;
  } catch {
    return null;
  }
}

export function defaultCookies(useSecureCookies) {
  const cookiePrefix = useSecureCookies ? "__Secure-" : "";
  return {
    sessionToken: {
      name: `${cookiePrefix}authjs.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
  };
}
