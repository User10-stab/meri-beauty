import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEmail, findProspectByEmail, promoteToStatus } from "@/lib/prospects/prospect-service";

/**
 * GET /api/campaign-clicks/track?c&url&e&u — PUBLIC, sans auth.
 * Redirige 302 IMMÉDIATEMENT vers la destination, puis journalise en
 * arrière-plan (clic + clickedCount + promotion `engage` du prospect).
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get("c") || "";
  const destination = searchParams.get("url") || "/";
  const email = normalizeEmail(searchParams.get("e") || "");
  const userId = searchParams.get("u") || null;

  // Destination sûre : on ne redirige que vers http(s), sinon accueil.
  let target = "/";
  try {
    const parsed = new URL(destination);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") target = parsed.toString();
  } catch {
    target = "/";
  }

  // Log async : ne jamais retarder ni casser la redirection.
  logClick({ campaignId, email, userId, ctaUrl: target, request }).catch((err) =>
    console.error("[campaign-clicks/track]", err)
  );

  return NextResponse.redirect(target, { status: 302 });
}

async function logClick({ campaignId, email, userId, ctaUrl, request }) {
  if (!campaignId) return;

  const headers = request.headers;
  const ip =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    null;

  const exists = email
    ? await prisma.campaignClick.findFirst({ where: { campaignId, email }, select: { id: true } })
    : null;

  await prisma.campaignClick.create({
    data: {
      campaignId,
      userId: userId || null,
      email: email || null,
      ctaUrl: ctaUrl?.slice(0, 500) || null,
      ip,
      userAgent: headers.get("user-agent")?.slice(0, 500) || null,
      referer: headers.get("referer")?.slice(0, 500) || null,
    },
  });

  // clickedCount = clics uniques (1 par email), comme openRate.
  if (!exists) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { clickedCount: { increment: 1 } },
    }).catch(() => {});
  }

  if (email) {
    const prospect = await findProspectByEmail(email);
    if (prospect) {
      // PAS d'activité `email_clicked` : la ligne CampaignClick ci-dessus
      // EST l'événement (sinon doublon 📝+👆 dans la timeline).
      await prisma.prospect.update({
        where: { id: prospect.id },
        data: {
          lastActivityAt: new Date(),
          lastEventType: "email_clicked",
          lastCampaignId: campaignId,
        },
      }).catch((err) => console.error("[campaign-clicks/track] prospect update failed:", err?.message ?? err));
      await promoteToStatus(prospect, "engage", { note: "Clic sur une campagne" }).catch((err) =>
        console.error("[campaign-clicks/track] promote engage failed:", err?.message ?? err)
      );
    }
  }
}
