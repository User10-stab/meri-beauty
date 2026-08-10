import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { testTag } from "./helpers.js";

// Same boundary as tests/integration/concurrency.test.js: only true third
// parties (Resend) and the NextAuth session are faked. createNewsletter,
// sendNewsletter, updateNewsletter, deleteNewsletter, and getCurrentStaffId
// all run for real against the real (disposable, branched) database.
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue({}) }));
// revalidatePath needs Next's live request-scoped store, which doesn't exist
// when calling a server action directly from a plain Vitest process — the
// existing concurrency.test.js sidesteps this by only exercising actions
// that don't call it. createNewsletter/sendNewsletter do, so fake it here.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: authMock }));

const { prisma } = await import("@/lib/prisma");
const { sendEmail } = await import("@/lib/email");
const { createNewsletter } = await import("@/actions/newsletter/create-newsletter");
const { updateNewsletter } = await import("@/actions/newsletter/update-newsletter");
const { deleteNewsletter } = await import("@/actions/newsletter/delete-newsletter");
const { sendNewsletter } = await import("@/actions/newsletter/send-newsletter");

const tag = testTag();
let phoneCounter = 0;
function uniquePhone() {
  phoneCounter += 1;
  return `+32${Date.now()}${phoneCounter}`;
}

function sessionFor(user) {
  return { user: { id: user.id, role: user.role } };
}

async function latestDraftFor(staffId) {
  return prisma.newsletter.findFirst({
    where: { createdByStaffId: staffId, title: `${tag}-draft` },
    orderBy: { createdAt: "desc" },
  });
}

describe("staff newsletter authoring and sending", () => {
  let staffUserA, staffA, staffUserB, staffB;
  let subscribedCustomer1, subscribedCustomer2, unsubscribedCustomer, deletedSubscribedCustomer, subscribedStaffUser;

  beforeAll(async () => {
    staffUserA = await prisma.user.create({
      data: { fullName: `${tag}-staffA`, email: `${tag}-staffA@example.test`, phone: uniquePhone(), password: "x", role: "STAFF", emailVerified: true },
    });
    staffA = await prisma.staff.create({
      data: { userId: staffUserA.id, setupCompleted: true, type: "EMPLOYEE", yearsOfExperience: 1 },
    });

    staffUserB = await prisma.user.create({
      data: { fullName: `${tag}-staffB`, email: `${tag}-staffB@example.test`, phone: uniquePhone(), password: "x", role: "STAFF", emailVerified: true },
    });
    staffB = await prisma.staff.create({
      data: { userId: staffUserB.id, setupCompleted: true, type: "EMPLOYEE", yearsOfExperience: 1 },
    });

    subscribedCustomer1 = await prisma.user.create({
      data: { fullName: `${tag}-sub1`, email: `${tag}-sub1@example.test`, phone: uniquePhone(), password: "x", role: "CUSTOMER", emailVerified: true, newsletterSubscribed: true },
    });
    subscribedCustomer2 = await prisma.user.create({
      data: { fullName: `${tag}-sub2`, email: `${tag}-sub2@example.test`, phone: uniquePhone(), password: "x", role: "CUSTOMER", emailVerified: true, newsletterSubscribed: true },
    });
    unsubscribedCustomer = await prisma.user.create({
      data: { fullName: `${tag}-unsub`, email: `${tag}-unsub@example.test`, phone: uniquePhone(), password: "x", role: "CUSTOMER", emailVerified: true, newsletterSubscribed: false },
    });
    // Soft-deleted but still flagged subscribed — must never receive mail.
    deletedSubscribedCustomer = await prisma.user.create({
      data: { fullName: `${tag}-deleted`, email: `${tag}-deleted@example.test`, phone: uniquePhone(), password: "x", role: "CUSTOMER", emailVerified: true, newsletterSubscribed: true, isDeleted: true },
    });
    // A STAFF account with the flag set — audience is CUSTOMER-only regardless of the flag.
    subscribedStaffUser = staffUserB;
    await prisma.user.update({ where: { id: subscribedStaffUser.id }, data: { newsletterSubscribed: true } });
  });

  afterAll(async () => {
    const staffIds = [staffA.id, staffB.id];
    const newsletters = await prisma.newsletter.findMany({ where: { createdByStaffId: { in: staffIds } }, select: { id: true } });
    const newsletterIds = newsletters.map((n) => n.id);
    await prisma.newsletterRecipient.deleteMany({ where: { newsletterId: { in: newsletterIds } } });
    await prisma.newsletter.deleteMany({ where: { id: { in: newsletterIds } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            staffUserA.id,
            staffUserB.id,
            subscribedCustomer1.id,
            subscribedCustomer2.id,
            unsubscribedCustomer.id,
            deletedSubscribedCustomer.id,
          ],
        },
      },
    });
  });

  test("a STAFF member creates a draft attributed to themselves", async () => {
    authMock.mockResolvedValue(sessionFor(staffUserA));

    const result = await createNewsletter({
      title: `${tag}-draft`,
      subject: `${tag}-subject`,
      content: `${tag}-content`,
    });

    expect(result.success).toBe(true);

    const draft = await latestDraftFor(staffA.id);
    expect(draft).not.toBeNull();
    expect(draft.status).toBe("DRAFT");
    expect(draft.createdByStaffId).toBe(staffA.id);
  });

  test("a different STAFF member cannot edit, delete, or send someone else's draft", async () => {
    const draft = await latestDraftFor(staffA.id);
    authMock.mockResolvedValue(sessionFor(staffUserB));

    const editResult = await updateNewsletter(draft.id, { title: "hijacked", subject: "hijacked", content: "hijacked" });
    expect(editResult.success).toBe(false);
    expect(editResult.message).toMatch(/vos propres/i);

    const sendResult = await sendNewsletter(draft.id);
    expect(sendResult.success).toBe(false);
    expect(sendResult.message).toMatch(/vos propres/i);

    const deleteResult = await deleteNewsletter(draft.id);
    expect(deleteResult.success).toBe(false);
    expect(deleteResult.message).toMatch(/vos propres/i);

    const stillThere = await prisma.newsletter.findUnique({ where: { id: draft.id } });
    expect(stillThere.title).toBe(`${tag}-draft`);
    expect(stillThere.status).toBe("DRAFT");
  });

  test("the owning STAFF member sends it, and only subscribed non-deleted customers receive it", async () => {
    const draft = await latestDraftFor(staffA.id);
    authMock.mockResolvedValue(sessionFor(staffUserA));

    const result = await sendNewsletter(draft.id);

    expect(result.success).toBe(true);
    // The test DB is a copy-on-write Neon branch seeded from a production
    // snapshot, so real pre-existing subscribed customers are also in scope
    // for this salon-wide send — recipientCount can't be asserted exactly.
    // What matters is that OUR fixtures land on the right side of the filter.
    expect(result.recipientCount).toBeGreaterThanOrEqual(2);

    const sentTo = sendEmail.mock.calls.map((call) => call[0].to);
    expect(sentTo).toEqual(expect.arrayContaining([subscribedCustomer1.email, subscribedCustomer2.email]));
    expect(sentTo).not.toContain(unsubscribedCustomer.email);
    expect(sentTo).not.toContain(deletedSubscribedCustomer.email);
    expect(sentTo).not.toContain(subscribedStaffUser.email);

    const ourRecipients = await prisma.newsletterRecipient.findMany({
      where: { newsletterId: draft.id, userId: { in: [subscribedCustomer1.id, subscribedCustomer2.id, unsubscribedCustomer.id, deletedSubscribedCustomer.id, subscribedStaffUser.id] } },
    });
    expect(ourRecipients).toHaveLength(2);
    expect(ourRecipients.every((r) => r.status === "SENT")).toBe(true);
    expect(ourRecipients.map((r) => r.userId).sort()).toEqual([subscribedCustomer1.id, subscribedCustomer2.id].sort());

    const updated = await prisma.newsletter.findUnique({ where: { id: draft.id } });
    expect(updated.status).toBe("SENT");
    expect(updated.sentAt).not.toBeNull();
  });

  test("a newsletter cannot be sent twice, edited, or deleted once SENT", async () => {
    const draft = await latestDraftFor(staffA.id);
    authMock.mockResolvedValue(sessionFor(staffUserA));

    const resendResult = await sendNewsletter(draft.id);
    expect(resendResult.success).toBe(false);
    expect(resendResult.message).toMatch(/déjà été envoyée/i);

    const editResult = await updateNewsletter(draft.id, { title: "x", subject: "x", content: "x" });
    expect(editResult.success).toBe(false);

    const deleteResult = await deleteNewsletter(draft.id);
    expect(deleteResult.success).toBe(false);
  });
});
