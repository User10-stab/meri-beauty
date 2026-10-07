"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import { promoCodeSchema, updatePromoCodeSchema } from "@/lib/validations/promo-codes";
import { resolvePromoCode } from "@/lib/promo-codes";
import { PROMO_CODE_SCOPES } from "@/lib/promo-code-scopes";
import { getClientIp, consumeSharedRateLimit, hashRateLimitValue } from "@/lib/rate-limit";

/**
 * Promo codes apply across all four purchase flows (boutique, ateliers,
 * formations, appointments) — not a boutique-only concept — so this lives
 * at the top level of actions/, not under actions/boutique/.
 */

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!isAdminRole(session.user.role)) return { error: "Accès non autorisé." };
  return { session };
}

const PROMO_VALIDATE_WINDOW_MS = 60 * 1000;
const PROMO_VALIDATE_MAX_ATTEMPTS = 20;

const PROMO_INCLUDE = {
  products: { select: { id: true, name: true }, orderBy: { name: "asc" } },
  services: { select: { id: true, name: true }, orderBy: { name: "asc" } },
  customers: { select: { id: true, fullName: true, email: true }, orderBy: { fullName: "asc" } },
  rules: {
    orderBy: { position: "asc" },
    include: {
      brands: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      categories: { select: { id: true, name: true, brand: { select: { name: true } } }, orderBy: { name: "asc" } },
      subcategories: {
        select: { id: true, name: true, category: { select: { name: true, brand: { select: { name: true } } } } },
        orderBy: { name: "asc" },
      },
      products: { select: { id: true, name: true }, orderBy: { name: "asc" } },
    },
  },
};

/** One offer of a multi-offer code, with its targets named for display. */
function serializePromoRule(rule) {
  return {
    id: rule.id,
    label: rule.label,
    kind: rule.kind,
    percent: rule.percent != null ? Number(rule.percent) : null,
    minQuantity: rule.minQuantity,
    buyQuantity: rule.buyQuantity,
    freeQuantity: rule.freeQuantity,
    samePriceOnly: rule.samePriceOnly,
    brands: rule.brands,
    categories: rule.categories.map((c) => ({ id: c.id, name: `${c.brand.name} › ${c.name}` })),
    subcategories: rule.subcategories.map((s) => ({ id: s.id, name: `${s.category.brand.name} › ${s.category.name} › ${s.name}` })),
    products: rule.products,
  };
}

function serializePromoCode(p) {
  return {
    id: p.id,
    code: p.code,
    type: p.type,
    value: Number(p.value),
    minOrderAmount: p.minOrderAmount != null ? Number(p.minOrderAmount) : null,
    isActive: p.isActive,
    expiresAt: p.expiresAt,
    maxUses: p.maxUses,
    usedCount: p.usedCount,
    createdAt: p.createdAt,
    description: p.description ?? null,
    scopes: p.scopes ?? [],
    maxUsesPerCustomer: p.maxUsesPerCustomer ?? null,
    products: p.products ?? [],
    services: p.services ?? [],
    customers: p.customers ?? [],
    rules: (p.rules ?? []).map(serializePromoRule),
  };
}

/** Builds the Prisma write payload shared by create and update. */
function promoWriteData(data, { isUpdate }) {
  const relation = (ids) => (isUpdate ? { set: ids.map((id) => ({ id })) } : { connect: ids.map((id) => ({ id })) });
  const connect = (ids) => ({ connect: ids.map((id) => ({ id })) });
  // Offers have no history of their own (an order line keeps its discount
  // and label), so an update simply replaces them.
  const rules = {
    ...(isUpdate ? { deleteMany: {} } : {}),
    create: data.rules.map((rule, position) => ({
      position,
      label: rule.label,
      kind: rule.kind,
      percent: rule.percent,
      minQuantity: rule.minQuantity,
      buyQuantity: rule.buyQuantity,
      freeQuantity: rule.freeQuantity,
      samePriceOnly: rule.samePriceOnly,
      brands: connect(rule.brandIds),
      categories: connect(rule.categoryIds),
      subcategories: connect(rule.subcategoryIds),
      products: connect(rule.productIds),
    })),
  };
  return {
    rules,
    code: data.code,
    type: data.type,
    value: data.value,
    minOrderAmount: data.minOrderAmount ?? null,
    expiresAt: data.expiresAt,
    maxUses: data.maxUses,
    isActive: data.isActive,
    description: data.description ?? null,
    scopes: data.scopes,
    maxUsesPerCustomer: data.maxUsesPerCustomer,
    products: relation(data.productIds),
    services: relation(data.serviceIds),
    customers: relation(data.customerIds),
  };
}

/** Rejects ids that don't point at a live product / prestation / customer. */
async function findUnknownTargets({ productIds, serviceIds, customerIds, rules }) {
  const ruleIds = (field) => [...new Set(rules.flatMap((rule) => rule[field]))];
  const [brandIds, categoryIds, subcategoryIds, ruleProductIds] = ["brandIds", "categoryIds", "subcategoryIds", "productIds"].map(ruleIds);
  const [ruleBrands, ruleCategories, ruleSubcategories, ruleProducts] = await Promise.all([
    brandIds.length ? prisma.brand.count({ where: { id: { in: brandIds }, isDeleted: false } }) : 0,
    categoryIds.length ? prisma.productCategory.count({ where: { id: { in: categoryIds } } }) : 0,
    subcategoryIds.length ? prisma.productSubcategory.count({ where: { id: { in: subcategoryIds } } }) : 0,
    ruleProductIds.length ? prisma.product.count({ where: { id: { in: ruleProductIds }, isDeleted: false } }) : 0,
  ]);
  if (
    ruleBrands !== brandIds.length ||
    ruleCategories !== categoryIds.length ||
    ruleSubcategories !== subcategoryIds.length ||
    ruleProducts !== ruleProductIds.length
  ) {
    return { rules: ["Une marque, une catégorie ou un produit d'une offre n'existe plus."] };
  }

  const [products, services, customers] = await Promise.all([
    productIds.length ? prisma.product.count({ where: { id: { in: productIds }, isDeleted: false } }) : 0,
    serviceIds.length ? prisma.service.count({ where: { id: { in: serviceIds }, isDeleted: false } }) : 0,
    customerIds.length ? prisma.user.count({ where: { id: { in: customerIds }, isDeleted: false } }) : 0,
  ]);
  if (products !== productIds.length) return { productIds: ["Un des produits choisis n'existe plus."] };
  if (services !== serviceIds.length) return { serviceIds: ["Une des prestations choisies n'existe plus."] };
  if (customers !== customerIds.length) return { customerIds: ["Un des clients choisis n'existe plus."] };
  return null;
}

const PREVIEW_SCOPES = new Set(PROMO_CODE_SCOPES);

/**
 * Only the shape resolvePromoCode needs, from untrusted client input: the
 * flow, the cart lines (boutique) or the booked prestation (appointment).
 */
async function previewContext(rawContext) {
  const scope = PREVIEW_SCOPES.has(rawContext?.scope) ? rawContext.scope : null;
  if (!scope) return null;

  const lines = Array.isArray(rawContext.lines)
    ? rawContext.lines.slice(0, 100).map((l, index) => ({
        key: index,
        productId: String(l?.productId ?? ""),
        amount: Math.max(0, Number(l?.amount) || 0),
        // Only a multi-offer code needs these (« dès 2 boîtes », « 3 + 2 offerts »).
        unitPrice: Math.max(0, Number(l?.unitPrice) || 0),
        quantity: Math.max(0, Math.trunc(Number(l?.quantity) || 0)),
      }))
    : null;

  let serviceId = null;
  if (scope === "APPOINTMENT" && typeof rawContext.staffServiceId === "string" && rawContext.staffServiceId) {
    const staffService = await prisma.staffService.findUnique({
      where: { id: rawContext.staffServiceId },
      select: { serviceId: true },
    });
    serviceId = staffService?.serviceId ?? null;
  }

  // Only a signed-in customer is known at preview time; a guest's account is
  // matched by e-mail at submit, where the customer rules are enforced.
  const session = await auth();
  const customerId = session?.user?.role === "CUSTOMER" ? session.user.id : null;

  return { scope, lines, serviceId, customerId, skipCustomerChecks: !customerId };
}

/** Public — called from the 4 checkout UIs for a live discount preview. */
export async function validatePromoCode(rawCode, subtotal, rawContext = null) {
  const ip = await getClientIp();
  const code = String(rawCode ?? "").trim().toUpperCase();
  const rateLimitKey = hashRateLimitValue(ip);

  if (await consumeSharedRateLimit("promo-validate", rateLimitKey, { windowMs: PROMO_VALIDATE_WINDOW_MS, max: PROMO_VALIDATE_MAX_ATTEMPTS })) {
    return { success: false, message: "Trop de tentatives. Veuillez patienter avant de réessayer." };
  }

  try {
    const context = await previewContext(rawContext);
    if (!context) return { success: false, message: "Impossible de vérifier ce code pour le moment." };
    const result = await resolvePromoCode(code, Number(subtotal) || 0, context);
    if (!result.success) return result;
    return {
      success: true,
      discountAmount: result.discountAmount,
      appliedRules: (result.appliedRules ?? []).map((rule) => ({ label: rule.label, discountAmount: rule.discountAmount })),
    };
  } catch (error) {
    console.error("[validatePromoCode]", error);
    return { success: false, message: "Impossible de vérifier ce code pour le moment." };
  }
}

export async function listPromoCodes() {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  try {
    const codes = await prisma.promoCode.findMany({ orderBy: { createdAt: "desc" }, include: PROMO_INCLUDE });
    return { success: true, data: codes.map(serializePromoCode) };
  } catch (error) {
    console.error("[listPromoCodes]", error);
    return { success: false, message: "Impossible de charger les codes promo.", data: [] };
  }
}

export async function createPromoCode(input) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = promoCodeSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: Object.values(errors)[0]?.[0] ?? "Données invalides.",
      errors,
    };
  }

  const data = parsed.data;

  try {
    const duplicate = await prisma.promoCode.findUnique({ where: { code: data.code }, select: { id: true } });
    if (duplicate) {
      return { success: false, message: "Ce code existe déjà.", errors: { code: ["Ce code existe déjà."] } };
    }
    const unknown = await findUnknownTargets(data);
    if (unknown) return { success: false, message: Object.values(unknown)[0][0], errors: unknown };

    const promo = await prisma.promoCode.create({
      data: promoWriteData(data, { isUpdate: false }),
      include: PROMO_INCLUDE,
    });

    revalidatePath("/dashboard/promo-codes", "layout");
    return { success: true, message: "Code promo créé.", data: serializePromoCode(promo) };
  } catch (error) {
    console.error("[createPromoCode]", error);
    return { success: false, message: "Impossible de créer le code promo." };
  }
}

export async function updatePromoCode(input) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = updatePromoCodeSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: Object.values(errors)[0]?.[0] ?? "Données invalides.",
      errors,
    };
  }

  const { id, ...data } = parsed.data;
  const { code, maxUses } = data;

  try {
    const existing = await prisma.promoCode.findUnique({ where: { id }, select: { id: true, usedCount: true } });
    if (!existing) return { success: false, message: "Code promo introuvable." };
    if (maxUses != null && maxUses < existing.usedCount) {
      return {
        success: false,
        message: "La limite ne peut pas être inférieure au nombre d'utilisations déjà enregistrées.",
        errors: { maxUses: ["Cette limite est déjà dépassée."] },
      };
    }

    const duplicate = await prisma.promoCode.findFirst({ where: { code, id: { not: id } }, select: { id: true } });
    if (duplicate) {
      return { success: false, message: "Ce code existe déjà.", errors: { code: ["Ce code existe déjà."] } };
    }

    const unknown = await findUnknownTargets(data);
    if (unknown) return { success: false, message: Object.values(unknown)[0][0], errors: unknown };

    const promo = await prisma.promoCode.update({
      where: { id },
      data: promoWriteData(data, { isUpdate: true }),
      include: PROMO_INCLUDE,
    });

    revalidatePath("/dashboard/promo-codes", "layout");
    return { success: true, message: "Code promo mis à jour.", data: serializePromoCode(promo) };
  } catch (error) {
    console.error("[updatePromoCode]", error);
    return { success: false, message: "Impossible de mettre à jour le code promo." };
  }
}

/**
 * Never a hard delete — codes stay in the DB (past `Payment` rows reference
 * them) and are just switched off, matching the client's "manual
 * deactivation only" requirement.
 */
export async function deletePromoCode(id) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };
  if (!id) return { success: false, message: "Identifiant manquant." };

  try {
    const existing = await prisma.promoCode.findUnique({ where: { id } });
    if (!existing) return { success: false, message: "Code promo introuvable." };

    await prisma.promoCode.update({ where: { id }, data: { isActive: false } });

    revalidatePath("/dashboard/promo-codes", "layout");
    return { success: true, message: "Code promo désactivé." };
  } catch (error) {
    console.error("[deletePromoCode]", error);
    return { success: false, message: "Impossible de désactiver le code promo." };
  }
}

export async function setPromoCodeActive(id, isActive) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };
  if (!id) return { success: false, message: "Identifiant manquant." };

  try {
    const promo = await prisma.promoCode.update({
      where: { id },
      data: { isActive: Boolean(isActive) },
      include: PROMO_INCLUDE,
    });
    revalidatePath("/dashboard/promo-codes", "layout");
    return {
      success: true,
      message: promo.isActive ? "Code promo réactivé." : "Code promo désactivé.",
      data: serializePromoCode(promo),
    };
  } catch (error) {
    console.error("[setPromoCodeActive]", error);
    return { success: false, message: "Impossible de modifier le statut du code promo." };
  }
}

const USAGE_LIMIT = 200;
const customerSelect = { select: { id: true, fullName: true, email: true } };

/**
 * Every sale/booking that carried the code, newest first. `released` mirrors
 * countCustomerPromoUses in lib/promo-codes.js: a cancelled order, an expired
 * unpaid hold or a cancelled/rejected rendez-vous no longer counts as a use.
 */
async function loadPromoUsage(promoCodeId) {
  const now = new Date();
  const [orders, workshops, formations, appointments] = await Promise.all([
    prisma.order.findMany({
      where: { promoCodeId },
      orderBy: { createdAt: "desc" },
      take: USAGE_LIMIT,
      select: {
        id: true, orderNumber: true, createdAt: true, status: true, expiresAt: true,
        discountAmount: true, totalAmount: true, user: customerSelect,
      },
    }),
    prisma.workshopReservation.findMany({
      where: { promoCodeId },
      orderBy: { createdAt: "desc" },
      take: USAGE_LIMIT,
      select: {
        id: true, createdAt: true, status: true, holdExpiresAt: true, discountAmount: true, totalPrice: true,
        customer: customerSelect, session: { select: { workshop: { select: { title: true } } } },
      },
    }),
    prisma.formationReservation.findMany({
      where: { promoCodeId },
      orderBy: { createdAt: "desc" },
      take: USAGE_LIMIT,
      select: {
        id: true, createdAt: true, status: true, holdExpiresAt: true, discountAmount: true, totalPrice: true,
        customer: customerSelect, session: { select: { formation: { select: { title: true } } } },
      },
    }),
    // Payment has no createdAt — the appointment's is the booking moment.
    prisma.payment.findMany({
      where: { promoCodeId, appointmentId: { not: null } },
      orderBy: { appointment: { createdAt: "desc" } },
      take: USAGE_LIMIT,
      select: {
        id: true, status: true, discountAmount: true, totalAmount: true,
        appointment: {
          select: {
            createdAt: true, status: true, user: customerSelect,
            staffService: { select: { service: { select: { name: true } } } },
          },
        },
      },
    }),
  ]);

  const expiredHold = (r) => r.status === "PENDING_DEPOSIT" && r.holdExpiresAt && r.holdExpiresAt < now;
  const rows = [
    ...orders.map((o) => ({
      id: `order-${o.id}`,
      scope: "BOUTIQUE",
      label: `Commande n° ${o.orderNumber}`,
      href: `/dashboard/boutique/orders/${o.id}`,
      customer: o.user,
      createdAt: o.createdAt,
      status: o.status,
      discount: Number(o.discountAmount),
      total: Number(o.totalAmount),
      released:
        ["CANCELLED", "EXPIRED", "SETTLED_AT_COUNTER"].includes(o.status) ||
        (o.status === "PENDING_PAYMENT" && o.expiresAt != null && o.expiresAt < now),
    })),
    ...workshops.map((r) => ({
      id: `workshop-${r.id}`,
      scope: "WORKSHOP",
      label: r.session?.workshop?.title ?? "Atelier",
      href: null,
      customer: r.customer,
      createdAt: r.createdAt,
      status: r.status,
      discount: Number(r.discountAmount),
      total: Number(r.totalPrice),
      released: r.status === "CANCELLED" || expiredHold(r),
    })),
    ...formations.map((r) => ({
      id: `formation-${r.id}`,
      scope: "FORMATION",
      label: r.session?.formation?.title ?? "Formation",
      href: null,
      customer: r.customer,
      createdAt: r.createdAt,
      status: r.status,
      discount: Number(r.discountAmount),
      total: Number(r.totalPrice),
      released: r.status === "CANCELLED" || expiredHold(r),
    })),
    ...appointments.map((p) => ({
      id: `appointment-${p.id}`,
      scope: "APPOINTMENT",
      label: p.appointment?.staffService?.service?.name ?? "Rendez-vous",
      href: null,
      customer: p.appointment?.user ?? null,
      createdAt: p.appointment?.createdAt,
      status: p.status,
      discount: Number(p.discountAmount),
      total: Number(p.totalAmount),
      released: ["CANCELLED", "REJECTED"].includes(p.appointment?.status),
    })),
  ];

  return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, USAGE_LIMIT);
}

/** Admin — one code with its full usage history, for the detail/edit page. */
export async function getPromoCode(id) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  try {
    const promo = await prisma.promoCode.findUnique({ where: { id }, include: PROMO_INCLUDE });
    if (!promo) return { success: false, message: "Code promo introuvable." };
    const usage = await loadPromoUsage(id);
    return { success: true, data: { ...serializePromoCode(promo), usage } };
  } catch (error) {
    console.error("[getPromoCode]", error);
    return { success: false, message: "Impossible de charger ce code promo." };
  }
}

/** Admin — customer picker for "réservé à". */
export async function searchPromoCustomers(query) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, data: [] };
  const q = String(query ?? "").trim();
  if (q.length < 2) return { success: true, data: [] };

  const users = await prisma.user.findMany({
    where: {
      role: "CUSTOMER",
      isDeleted: false,
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ],
    },
    orderBy: { fullName: "asc" },
    take: 12,
    select: { id: true, fullName: true, email: true, phone: true },
  });
  return { success: true, data: users };
}

/** Admin — product picker. Archived/deleted products can't be targeted. */
export async function searchPromoProducts(query) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, data: [] };
  const q = String(query ?? "").trim();

  const products = await prisma.product.findMany({
    where: {
      isDeleted: false,
      status: { not: "ARCHIVED" },
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { name: "asc" },
    take: 15,
    select: {
      id: true,
      name: true,
      images: { orderBy: { position: "asc" }, take: 1, select: { path: true } },
      variants: { where: { isActive: true }, orderBy: { price: "asc" }, take: 1, select: { price: true } },
    },
  });
  return {
    success: true,
    data: products.map((p) => ({
      id: p.id,
      name: p.name,
      image: p.images[0]?.path ?? null,
      price: p.variants[0] ? Number(p.variants[0].price) : null,
    })),
  };
}

/**
 * Admin — the catalogue tree an offer of a multi-offer code can target:
 * brands › categories › subcategories, with how many live products each holds.
 */
export async function listPromoCatalogueTree() {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, data: [] };

  const brands = await prisma.brand.findMany({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      categories: {
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          subcategories: {
            orderBy: [{ position: "asc" }, { name: "asc" }],
            select: { id: true, name: true, _count: { select: { products: { where: { isDeleted: false } } } } },
          },
        },
      },
    },
  });

  const data = brands
    .map((brand) => {
      const categories = brand.categories
        .map((category) => {
          const subcategories = category.subcategories
            .map((sub) => ({ id: sub.id, name: sub.name, productCount: sub._count.products }))
            .filter((sub) => sub.productCount > 0);
          return { id: category.id, name: category.name, subcategories, productCount: subcategories.reduce((sum, sub) => sum + sub.productCount, 0) };
        })
        .filter((category) => category.productCount > 0);
      return { id: brand.id, name: brand.name, categories, productCount: categories.reduce((sum, category) => sum + category.productCount, 0) };
    })
    .filter((brand) => brand.productCount > 0);
  return { success: true, data };
}

/** Admin — every bookable prestation, grouped by category on the client. */
export async function listPromoServices() {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, data: [] };

  const services = await prisma.service.findMany({
    where: { isDeleted: false },
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    select: { id: true, name: true, category: { select: { name: true } } },
  });
  return { success: true, data: services.map((s) => ({ id: s.id, name: s.name, category: s.category?.name ?? "Autres" })) };
}
