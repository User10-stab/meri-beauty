import { describe, expect, test, vi } from "vitest";
import { createBrowserUuid } from "../../lib/browser-uuid";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("browser UUID generation", () => {
  test("prefers randomUUID when the page is a secure context", () => {
    const randomUUID = vi.fn(() => "secure-context-uuid");

    expect(createBrowserUuid({ randomUUID })).toBe("secure-context-uuid");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  test("generates an RFC 4122 v4 UUID when randomUUID is unavailable over HTTP", () => {
    const getRandomValues = vi.fn((bytes) => {
      bytes.set(Array.from({ length: 16 }, (_, index) => index));
      return bytes;
    });

    const result = createBrowserUuid({ getRandomValues });

    expect(result).toMatch(UUID_V4);
    expect(result).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  test("does not crash in a browser with no Web Crypto API", () => {
    expect(createBrowserUuid(null)).toMatch(UUID_V4);
  });
});
