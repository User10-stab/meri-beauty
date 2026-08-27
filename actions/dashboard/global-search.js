"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getDashboardPermissions, STAFF_PERMISSIONS } from "@/lib/authorization";

const RESULT_LIMIT = 5;

/**
 * Dashboard header search — looks across the entities a given role is
 * actually allowed to browse (mirrors the DASHBOARD_PERMISSIONS gate each
 * of those pages already enforces), so a STAFF account never sees a result
 * it couldn't otherwise reach by navigating there directly.
 *
 * @param {string} query
 * @returns {Promise<{ success: boolean, results: Array<{ type: string, label: string, sublabel: string, href: string }> }>}
 */
export async function globalDashboardSearch(query) {
  const session = await auth();
  if (!session?.user) return { success: false, results: [] };

  const q = (query ?? "").trim();
  if (q.length < 2) return { success: true, results: [] };

  const permissions = await getDashboardPermissions(session.user);
  const results = [];

  if (permissions.includes(STAFF_PERMISSIONS.CUSTOMERS)) {
    const customers = await prisma.user.findMany({
      where: {
        role: "CUSTOMER",
        isDeleted: false,
        OR: [
          { fullName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { id: true, fullName: true, email: true },
      take: RESULT_LIMIT,
    });
    results.push(
      ...customers.map((c) => ({
        type: "Client",
        label: c.fullName,
        sublabel: c.email,
        href: "/dashboard/customers",
      }))
    );
  }

  if (permissions.includes(STAFF_PERMISSIONS.ORDERS)) {
    const numericQuery = /^\d+$/.test(q) ? Number(q) : null;
    const orders = await prisma.order.findMany({
      where: {
        OR: [
          ...(numericQuery !== null ? [{ orderNumber: numericQuery }] : []),
          { pickupCode: { contains: q, mode: "insensitive" } },
          { trackingCode: { contains: q, mode: "insensitive" } },
          { user: { fullName: { contains: q, mode: "insensitive" } } },
        ],
      },
      select: { id: true, orderNumber: true, status: true },
      take: RESULT_LIMIT,
    });
    results.push(
      ...orders.map((o) => ({
        type: "Commande",
        label: `Commande n°${o.orderNumber}`,
        sublabel: o.status,
        href: `/dashboard/boutique/orders/${o.id}`,
      }))
    );
  }

  if (permissions.includes(STAFF_PERMISSIONS.BOUTIQUE_STOCK)) {
    const variants = await prisma.productVariant.findMany({
      where: {
        isDeleted: false,
        OR: [
          { sku: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
          { product: { name: { contains: q, mode: "insensitive" } } },
        ],
      },
      select: { id: true, name: true, sku: true, product: { select: { id: true, name: true } } },
      take: RESULT_LIMIT,
    });
    results.push(
      ...variants.map((v) => ({
        type: "Produit",
        label: `${v.product.name} — ${v.name}`,
        sublabel: v.sku,
        href: `/dashboard/boutique/products/${v.product.id}`,
      }))
    );
  }

  if (permissions.includes(STAFF_PERMISSIONS.APPOINTMENTS)) {
    const appointments = await prisma.appointment.findMany({
      where: {
        isDeleted: false,
        user: { fullName: { contains: q, mode: "insensitive" } },
      },
      select: {
        id: true,
        date: true,
        user: { select: { fullName: true } },
        staffService: { select: { service: { select: { name: true } } } },
      },
      orderBy: { date: "desc" },
      take: RESULT_LIMIT,
    });
    results.push(
      ...appointments.map((a) => ({
        type: "Rendez-vous",
        label: `${a.user.fullName} — ${a.staffService?.service?.name ?? "Service"}`,
        sublabel: new Date(a.date).toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" }),
        href: "/dashboard/allAppointments",
      }))
    );
  }

  return { success: true, results };
}
