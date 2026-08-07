import { prisma } from "@/lib/prisma";
import { getAppBaseUrl } from "@/lib/site-url";

const SITE_URL = getAppBaseUrl();

// Regenerate at most once an hour — cheap enough for how often new
// products/activities/formations actually get published, and avoids
// hitting the DB on every single crawler request.
export const revalidate = 3600;

export default async function sitemap() {
  const staticRoutes = [
    { path: "/", changeFrequency: "weekly", priority: 1 },
    { path: "/reservation", changeFrequency: "monthly", priority: 0.9 },
    { path: "/boutique", changeFrequency: "daily", priority: 0.8 },
    { path: "/evenements", changeFrequency: "weekly", priority: 0.7 },
    { path: "/formations", changeFrequency: "weekly", priority: 0.7 },
    { path: "/animateurs", changeFrequency: "monthly", priority: 0.5 },
    { path: "/contact", changeFrequency: "yearly", priority: 0.4 },
  ].map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: new Date(),
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  const [activities, formations, products, animators] = await Promise.all([
    prisma.activity.findMany({
      where: { status: "PUBLISHED" },
      select: { id: true, updatedAt: true },
    }),
    prisma.formation.findMany({
      where: { status: "PUBLISHED" },
      select: { id: true, updatedAt: true },
    }),
    prisma.product.findMany({
      where: { status: "ACTIVE", isDeleted: false },
      select: { slug: true, updatedAt: true },
    }),
    prisma.animator.findMany({
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
    ...animators.map((a) => ({
      url: `${SITE_URL}/animateurs/${a.id}`,
      lastModified: a.updatedAt,
      changeFrequency: "monthly",
      priority: 0.3,
    })),
  ];

  return [...staticRoutes, ...dynamicRoutes];
}
