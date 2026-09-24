import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEmail, findProspectByEmail, promoteToStatus } from "@/lib/prospects/prospect-service";

// Pixel transparent 1x1.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
  "base64"
);

/**
 * GET /api/mail-openings/track?c&e&u — PUBLIC, sans auth.
 * Retourne le pixel 1x1 (Cache-Control: no-store) immédiatement, puis
 * journalise en arrière-plan (ouverture + openedCount unique par email).
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get("c") || "";
  const email = normalizeEmail(searchParams.get("e") || "");
  const userId = searchParams.get("u") || null;

  logOpening({ campaignId, email, userId, request }).catch((err) =>
    console.error("[mail-openings/track]", err)
  );

  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

async function logOpening({ campaignId, email, userId, request }) {
  const headers = request.headers;
  const ip =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    null;

  const whereFirst = { email: email || undefined, campaignId: campaignId || undefined };
  const exists = email
    ? await prisma.mailOpening.findFirst({ where: whereFirst, select: { id: true } })
    : null;

  await prisma.mailOpening.create({
    data: {
      campaignId: campaignId || null,
      userId: userId || null,
      email: email || null,
      ip,
      userAgent: headers.get("user-agent")?.slice(0, 500) || null,
    },
  });

  // openedCount = ouvertures uniques (1 par email), base de l'openRate.
  if (!exists && campaignId) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { openedCount: { increment: 1 } },
    }).catch(() => {});
  }

  if (email) {
    const prospect = await findProspectByEmail(email);
    if (prospect) {
      // PAS d'activité `email_opened` : la ligne MailOpening ci-dessus EST
      // l'événement (sinon doublon 📝+👁️ dans la timeline). On met juste à
      // jour le pointeur de dernière activité du prospect.
      await prisma.prospect.update({
        where: { id: prospect.id },
        data: {
          lastActivityAt: new Date(),
          lastEventType: "email_opened",
          ...(campaignId ? { lastCampaignId: campaignId } : {}),
        },
      }).catch(() => {});
      // Ouverture seule (sans clic) -> statut `lecteur`. Ne monte que :
      // un `engage`/`client` existant n'est jamais rétrogradé.
      await promoteToStatus(prospect, "lecteur", { note: "Ouverture d'une campagne" }).catch(() => {});
    }
  }
}
