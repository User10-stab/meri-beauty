"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { getStripeAccountLevel, getCardPaymentsStatus } from "@/lib/stripe-connect-status";
import { fetchLiveStripeStatus } from "../stripe/_fetch-live-status";

/**
 * Fetches all independent staff members with their user, contract, and
 * active service assignment data. Returns a plain serialisable array.
 *
 * Stripe connection state is re-verified live against Stripe (the same
 * source of truth as the payments / "Comptes Stripe" pages) for rows whose
 * cached flags claim "disconnected" while a stripeAccountId exists: the
 * connect-time snapshot goes stale when onboarding finishes after the
 * callback and the account.updated webhook never lands (missed event, local
 * dev without forwarding). Verified values are persisted to the same three
 * cache columns the webhook / refreshStripeStatus() writes, so the table,
 * its header badge, and the DB-guarded checkout flows all agree with Stripe.
 *
 * @returns {{ success: boolean, data?: Array<object>, message?: string }}
 */
export async function getIndependentStaff() {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, data: [], message: "Permissions insuffisantes" };
    }
    const staffList = await prisma.staff.findMany({
      where: { type: "INDEPENDENT", isDeleted: false, user: { isDeleted: false } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        photo: true,
        bio: true,
        languages: true,
        isActive: true,
        yearsOfExperience: true,
        hireDate: true,
        rythme: true,
        vatNumber: true,
        createdAt: true,
        updatedAt: true,
        dashboardPermissions: true,
        stripeAccountId: true,
        stripeAccountType: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        allowedPaymentMethods: true,
        depositEnabled: true,
        depositPercentage: true,
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            role: true,
            isActive: true,
            isDeleted: true,
            emailVerified: true,
            createdAt: true,
            addressLine1: true,
            addressLine2: true,
            addressCity: true,
            addressPostalCode: true,
            addressCountry: true,
          },
        },
        contracts: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        staffServices: {
          where: { isActive: true, service: { isDeleted: false } },
          select: {
            isActive: true,
            serviceId: true,
            service: {
              select: {
                id: true,
                name: true,
                category: { select: { id: true, name: true } },
              },
            },
          },
        },
        _count: {
          select: { workingHours: true },
        },
      },
    });

    // ── Live re-verification of stale "disconnected" rows ──────────────
    // Only rows that (a) have an account but (b) whose cache says not-ready
    // hit Stripe — connected rows need no call, rows without an account have
    // nothing to verify. Failures fall back to the cached values so the
    // table never breaks because Stripe is unreachable.
    const candidates = staffList.filter(
      (s) => s.stripeAccountId && (!s.stripeChargesEnabled || !s.stripePayoutsEnabled)
    );
    const liveById = new Map();
    await Promise.all(
      candidates.map(async (s) => {
        try {
          const { account, capability } = await fetchLiveStripeStatus(s.stripeAccountId);
          const accountLevel = getStripeAccountLevel(account);
          const card = getCardPaymentsStatus(account, capability);
          // Persist the sync — identical columns to the account.updated /
          // capability.updated webhook and refreshStripeStatus().
          await prisma.staff.update({
            where: { id: s.id },
            data: {
              ...(account.type ? { stripeAccountType: account.type } : null),
              stripeChargesEnabled: card.chargesEnabled,
              stripePayoutsEnabled: card.payoutsEnabled,
            },
          });
          liveById.set(s.id, {
            stripeAccountType: account.type ?? s.stripeAccountType,
            stripeChargesEnabled: card.chargesEnabled,
            stripePayoutsEnabled: card.payoutsEnabled,
            stripeConnected: true,
            stripeAccountLevel: accountLevel.accountLevel,
            stripeCardPayments: card.cardPayments,
            stripeCardLevel: card.level,
          });
        } catch (err) {
          // Stripe says the account id is unknown/rejected (deleted or
          // revoked on Stripe's side): report disconnected for display. The
          // DB cache is left untouched — a transient network error must never
          // flip stored flags; only a successful live read syncs them.
          if (err?.type === "StripeInvalidRequestError") {
            liveById.set(s.id, {
              stripeAccountType: s.stripeAccountType,
              stripeChargesEnabled: false,
              stripePayoutsEnabled: false,
              stripeConnected: false,
              stripeAccountLevel: null,
              stripeCardPayments: null,
              stripeCardLevel: null,
            });
          }
          // Any other error: no entry → caller falls back to cached values.
        }
      })
    );

    const serialised = staffList.map((s) => {
      const live = liveById.get(s.id) ?? null;
      return {
      id: s.id,
      photo: s.photo ?? null,
      bio: s.bio,
      languages: s.languages,
      isActive: s.isActive,
      yearsOfExperience: s.yearsOfExperience ?? null,
      hireDate: s.hireDate ? s.hireDate.toISOString() : null,
      rythme: s.rythme ?? null,
      vatNumber: s.vatNumber ?? null,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      dashboardPermissions: s.dashboardPermissions,
      // Stripe Connect data — live-verified values when re-checked above,
      // otherwise the cached columns.
      stripeAccountId: s.stripeAccountId,
      stripeAccountType: live?.stripeAccountType ?? s.stripeAccountType,
      stripeChargesEnabled: live?.stripeChargesEnabled ?? s.stripeChargesEnabled,
      stripePayoutsEnabled: live?.stripePayoutsEnabled ?? s.stripePayoutsEnabled,
      // Connection vs capability, kept distinct: an accountId means a
      // connected account; charges/payouts + card capability say whether
      // card payments are actually enabled. Live-verified rows carry the
      // real card level; the table must not equate the two.
      stripeConnected: live ? live.stripeConnected : Boolean(s.stripeAccountId),
      stripeAccountLevel: live?.stripeAccountLevel ?? null,
      stripeCardPayments: live?.stripeCardPayments ?? null,
      stripeCardLevel: live?.stripeCardLevel ?? null,
      stripeLiveVerified: Boolean(live),
      allowedPaymentMethods: s.allowedPaymentMethods ?? "BOTH",
      depositEnabled: Boolean(s.depositEnabled),
      depositPercentage: s.depositPercentage != null ? Number(s.depositPercentage) : 0,
      // Compliance data
      workingHoursCount: s._count.workingHours,
      userIsDeleted: s.user.isDeleted,
      userIsActive: s.user.isActive,
      // Current active service IDs (used to pre-populate the edit form)
      serviceIds: s.staffServices.map((ss) => ss.serviceId),
      // Full service objects (used to render service tags in the table)
      services: s.staffServices.map((ss) => ({
        id: ss.service.id,
        name: ss.service.name,
        category: ss.service.category,
      })),
      // Keep count for convenience
      servicesCount: s.staffServices.length,
      user: {
        ...s.user,
        createdAt: s.user.createdAt.toISOString(),
        addressLine1: s.user.addressLine1 ?? null,
        addressLine2: s.user.addressLine2 ?? null,
        addressCity: s.user.addressCity ?? null,
        addressPostalCode: s.user.addressPostalCode ?? null,
        addressCountry: s.user.addressCountry ?? null,
      },
      contract: s.contracts[0]
        ? {
            id: s.contracts[0].id,
            type: s.contracts[0].type,
            commissionPercentage: s.contracts[0].commissionPercentage
              ? Number(s.contracts[0].commissionPercentage)
              : null,
            fixedRent: s.contracts[0].fixedRent
              ? Number(s.contracts[0].fixedRent)
              : null,
            startDate: s.contracts[0].startDate.toISOString(),
            endDate: s.contracts[0].endDate
              ? s.contracts[0].endDate.toISOString()
              : null,
            status: s.contracts[0].status,
            notes: s.contracts[0].notes,
          }
        : null,
      };
    });

    return { success: true, data: serialised };
  } catch (error) {
    console.error("[getIndependentStaff]", error);
    return {
      success: false,
      message: "Impossible de charger la liste des auto-entrepreneurs.",
      data: [],
    };
  }
}
