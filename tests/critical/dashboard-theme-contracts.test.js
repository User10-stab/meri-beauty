import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("dashboard dark mode", () => {
  test("dashboard shell carries the scope used by the Tailwind dark variant", () => {
    const css = source("css/style.css");
    const shell = source("components/dashboard/Layouts/dashboard-shell.jsx");

    expect(css).toContain(".dashboard-scope");
    expect(shell).toContain("dashboard-scope");
  });

  test("theme toggle flips the resolved theme instead of the raw system value", () => {
    const toggle = source("components/dashboard/Layouts/header/theme-toggle/index.jsx");

    expect(toggle).toContain("resolvedTheme");
    expect(toggle).toContain('activeTheme === "dark" ? "light" : "dark"');
    expect(toggle).toContain("setTheme(nextTheme)");
  });
});
