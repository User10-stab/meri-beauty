"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { BELGIUM_VAT_RATE, resolveGoodsVatPolicy, resolveServiceVatPolicy } from "@/lib/tax-policy";

/**
 * Every public catalogue/detail read (storefront, ateliers, formations,
 * événements) is deliberately auth-free so those pages stay cacheable —
 * adding a session lookup there would make each one dynamic-per-visitor.
 * This is the one place that looks at the session, called once client-side
 * per page load so a display component can decide for itself how to show a
 * price it already has, without the read actions themselves becoming
 * session-aware.
 *
 * Goods and services get separate resolvers on purpose, even though they
 * currently compute the same thing: a goods reverse charge (art. 138)
 * requires physical dispatch to another member state, while a service
 * reverse charge (art. 44/196) turns only on where the customer is
 * established. They are allowed to diverge later without one silently
 * affecting the other.
 */
async function resolveViewerCustomer() {
  const session = await auth();
  if (session?.user?.role !== "CUSTOMER") return null;
  return prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isCompany: true, vatNumber: true, vatValidatedAt: true },
  });
}

function toViewerPolicy(policy) {
  return {
    vatRate: policy.vatRate,
    isB2B: policy.vatTreatment === "EU_REVERSE_CHARGE",
    taxNote: policy.taxNote,
  };
}

// Fails toward the legal default for an anonymous visitor: VAT-inclusive.
const FALLBACK_POLICY = { vatRate: BELGIUM_VAT_RATE, isB2B: false, taxNote: null };

export async function getViewerGoodsVatPolicy() {
  try {
    const customer = await resolveViewerCustomer();
    return { success: true, data: toViewerPolicy(resolveGoodsVatPolicy({ customer })) };
  } catch (error) {
    console.error("[getViewerGoodsVatPolicy]", error);
    return { success: true, data: FALLBACK_POLICY };
  }
}

export async function getViewerServiceVatPolicy() {
  try {
    const customer = await resolveViewerCustomer();
    return { success: true, data: toViewerPolicy(resolveServiceVatPolicy({ customer })) };
  } catch (error) {
    console.error("[getViewerServiceVatPolicy]", error);
    return { success: true, data: FALLBACK_POLICY };
  }
}
