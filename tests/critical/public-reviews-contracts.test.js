import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// Publishing testimonials nobody wrote is a misleading commercial practice
// under Book VI of the Belgian Code de droit économique, and the Omnibus
// directive (art. VI.99/2) additionally requires disclosing how displayed
// reviews are verified. The homepage previously shipped six invented 5-star
// quotes with stock portraits. These tests keep them from coming back.
describe("homepage testimonials come from real reviews only", () => {
  const component = source("components/website/ClientReviews.jsx");

  test("no hardcoded testimonial data survives in the component", () => {
    expect(component).not.toContain("Camille Renard");
    expect(component).not.toContain("Mejrem A.");
    expect(component).not.toContain("Isabelle Moreau");
    // The stock portraits depicted people who were never customers.
    expect(component).not.toContain("/Images/clients/");
  });

  test("reviews arrive as a prop rather than a module constant", () => {
    expect(component).toContain("export default function ClientReviews({ reviews = [] })");
  });

  test("the section disappears entirely when there are no reviews", () => {
    expect(component).toContain("if (reviews.length === 0) return null;");
  });

  test("the verification disclosure is displayed next to the reviews", () => {
    expect(component).toContain("ayant réellement effectué un rendez-vous");
    expect(component).toContain("sans sélection sur la note");
  });

  test("ratings render out of 5 so a low score cannot read as a maximum", () => {
    expect(component).toContain("Array.from({ length: 5 })");
    expect(component).toContain("i < review.rating");
  });
});

describe("the public reviews query stays honest", () => {
  const lib = source("lib/reviews/get-public-reviews.js");

  test("only reviews tied to a COMPLETED appointment are eligible", () => {
    expect(lib).toContain('appointment: { status: "COMPLETED" }');
  });

  test("newest-first, never best-first, and never filtered by rating", () => {
    expect(lib).toContain('orderBy: { createdAt: "desc" }');
    expect(lib).not.toMatch(/rating:\s*\{\s*(gte|gt|in|equals)/);
    expect(lib).not.toContain('orderBy: { rating');
  });

  test("full customer names never leave the server", () => {
    expect(lib).toContain("toPublicName");
    // Only the mapped shape is returned — fullName is consumed, not forwarded.
    const returned = lib.slice(lib.indexOf("return reviews.map("));
    expect(returned).not.toContain("fullName: review");
  });

  test("a database outage hides the section instead of breaking the homepage", () => {
    expect(lib).toContain("return [];");
  });

  test("it is not a server action — this is a read helper for a server component", () => {
    expect(lib).not.toMatch(/^\s*["']use server["'];?\s*$/m);
  });
});

describe("the legal pages match what the code actually does", () => {
  test("CGV no longer advertises Bancontact, which checkout does not offer", () => {
    const cgv = source("app/(public)/cgv/page.jsx");
    expect(cgv).not.toContain("Bancontact");
    // Every checkout session is card-only — Marie's explicit decision.
    const flows = [
      "actions/boutique/orders.js",
      "actions/workshops/create-workshop-reservation.js",
      "actions/formations/create-formation-reservation.js",
    ];
    for (const flow of flows) {
      expect(source(flow)).toContain('payment_method_types: ["card"]');
    }
  });

  test("CGV documents the review policy", () => {
    const cgv = source("app/(public)/cgv/page.jsx");
    expect(cgv).toContain("Avis clients publiés sur le Site");
    expect(cgv).toContain("jamais au seul");
  });

  test("no unfilled placeholder is served to visitors", () => {
    for (const page of [
      "app/(public)/politique-de-confidentialite/page.jsx",
      "app/(public)/mentions-legales/page.jsx",
      "app/(public)/cgv/page.jsx",
    ]) {
      const content = source(page);
      expect(content).not.toContain("à compléter");
      // A public legal page must not label itself an unvalidated draft.
      expect(content).not.toContain("Ce document est un projet");
    }
  });

  test("the privacy policy names the real database host", () => {
    const privacy = source("app/(public)/politique-de-confidentialite/page.jsx");
    // Production runs self-hosted Postgres on OVH; Neon is a dev-only tool and
    // naming it as a subprocessor was simply inaccurate.
    expect(privacy).not.toContain("Neon");
    expect(privacy).toContain("OVH");
  });

  test("the privacy policy discloses that reviews are published", () => {
    const privacy = source("app/(public)/politique-de-confidentialite/page.jsx");
    expect(privacy).toContain("Avis publiés sur le Site");
    expect(privacy).toContain("Votre nom complet, votre email et vos");
  });
});
