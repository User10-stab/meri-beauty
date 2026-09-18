import { prisma } from "@/lib/prisma";
import { getAppBaseUrl } from "@/lib/site-url";

const SITE_URL = getAppBaseUrl();

// Regenerate at most once an hour — cheap enough for how often new
// products/activities/formations actually get published, and avoids
// hitting the DB on every single crawler request.
export const revalidate = 3600;

// Rendered on demand rather than prerendered at build time.
//
// Without this, `next build` executes the queries below, which makes a
// successful build depend on the database being reachable at that moment.
// Against a serverless Postgres that scales to zero, a cold start during
// CI fails the whole build on a route no user ever waits for — which is
// exactly what happened on 2026-09-02. `revalidate` above still caches the
// result for an hour, so crawlers do not hit the DB either way.
export const dynamic = "force-dynamic";

// Kept in sync with `activeProductWhere` in actions/boutique/storefront.js.
// The variant check is the part that matters: /boutique/[slug] resolves the
// product through that same filter and calls notFound() when it misses, so a
// product whose variants have all been deactivated still satisfies
// status/isDeleted but 404s for anyone who follows the link. Listing it here
// would hand Google a "Submitted URL not found (404)" for every such product.
const SITEMAP_PRODUCT_WHERE = {
  isDeleted: false,
  status: "ACTIVE",
  variants: { some: { isDeleted: false, isActive: true } },
};

export default async function sitemap() {
  const staticRoutes = [
    { path: "/", changeFrequency: "weekly", priority: 1 },
    { path: "/reservation", changeFrequency: "monthly", priority: 0.9 },
    { path: "/boutique", changeFrequency: "daily", priority: 0.8 },
    { path: "/concept", changeFrequency: "monthly", priority: 0.7 },
    { path: "/evenements", changeFrequency: "weekly", priority: 0.7 },
    { path: "/formations", changeFrequency: "weekly", priority: 0.7 },
    { path: "/animateurs", changeFrequency: "monthly", priority: 0.5 },
    { path: "/contact", changeFrequency: "yearly", priority: 0.4 },
    { path: "/boutique/returns", changeFrequency: "yearly", priority: 0.3 },
    { path: "/cgv", changeFrequency: "yearly", priority: 0.2 },
    { path: "/mentions-legales", changeFrequency: "yearly", priority: 0.2 },
    { path: "/politique-de-confidentialite", changeFrequency: "yearly", priority: 0.2 },
  ].map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: new Date(),
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  const [activities, formations, products, animators, staff] = await Promise.all([
    prisma.activity.findMany({
      where: { status: "PUBLISHED" },
      select: { id: true, updatedAt: true },
    }),
    prisma.formation.findMany({
      where: { status: "PUBLISHED" },
      select: { id: true, updatedAt: true },
    }),
    prisma.product.findMany({
      where: SITEMAP_PRODUCT_WHERE,
      select: { slug: true, updatedAt: true },
    }),
    prisma.animator.findMany({
      select: { id: true, updatedAt: true },
    }),
    // Same visibility rule as app/(public)/staff/[staffId]/page.jsx, which
    // 404s on a deactivated member or one whose user account is gone.
    prisma.staff.findMany({
      where: {
        isDeleted: false,
        isActive: true,
        user: { isDeleted: false, isActive: true },
      },
      select: { id: true, updatedAt: true },
    }),
  ]);

  const dynamicRoutes = [
    ...activities.map((a) => ({
      url: `${SITE_URL}/evenements/${a.id}`,
      lastModified: a.updatedAt,
      changeFrequency: "weekly",
      priority: 0.6,
    })),
    ...formations.map((f) => ({
      url: `${SITE_URL}/formations/${f.id}`,
      lastModified: f.updatedAt,
      changeFrequency: "weekly",
      priority: 0.6,
    })),
    ...products.map((p) => ({
      url: `${SITE_URL}/boutique/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: "weekly",
      priority: 0.5,
    })),
    // Linked from the homepage (Hero, OurExperts) and carry their own
    // metadata — these are the pages that rank for "<prénom> + Jette".
    ...staff.map((s) => ({
      url: `${SITE_URL}/staff/${s.id}`,
      lastModified: s.updatedAt,
      changeFrequency: "monthly",
      priority: 0.4,
    })),
    ...animators.map((a) => ({
      url: `${SITE_URL}/animateurs/${a.id}`,
      lastModified: a.updatedAt,
      changeFrequency: "monthly",
      priority: 0.3,
    })),
  ];

  return [...staticRoutes, ...dynamicRoutes];
}
