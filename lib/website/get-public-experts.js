import { prisma } from "@/lib/prisma";
import { reportPublicDataError } from "@/lib/prisma-public-fallback";

/**
 * Équipe affichée sur l'accueil (section « Les visages de MeriBeauty »).
 *
 * Lue côté serveur, pendant le rendu de la page : Google lit le HTML rendu
 * par le serveur. Avant, OurExperts démarrait avec une équipe de démonstration
 * codée en dur (Sofia Bellamy, Camille, Aurélie…, ids 1 à 5) puis allait
 * chercher /api/staff dans le navigateur — le HTML indexé montrait donc des
 * personnes qui n'existent pas, avec des liens « Découvrir … » vers
 * /staff/1 … /staff/5 (« Membre introuvable »). Audit MB-009, 2026-10.
 *
 * Même règle de visibilité que app/(public)/staff/[staffId]/page.jsx (et le
 * sitemap) : une fiche listée ici ne peut jamais tomber sur la page 404.
 * /api/staff ne filtrait pas isActive — une indépendante désactivée restait
 * visible avec un lien mort.
 *
 * Erreur de base → liste vide : la section ne s'affiche pas, plutôt qu'une
 * fausse équipe.
 */
export async function getPublicExperts() {
  try {
    const experts = await prisma.staff.findMany({
      where: {
        type: "INDEPENDENT",
        isDeleted: false,
        isActive: true,
        user: { isDeleted: false, isActive: true },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        photo: true,
        user: {
          select: {
            fullName: true,
            avatar: true,
          },
        },
        staffServices: {
          where: { isDeleted: false, isActive: true },
          select: {
            service: { select: { category: { select: { name: true } } } },
          },
        },
      },
    });

    return experts
      .map((staff) => ({
        id: staff.id,
        name: staff.user?.fullName ?? "",
        image: staff.photo || staff.user?.avatar || "/Images/expert.webp",
        categories: [
          ...new Set(
            (staff.staffServices || [])
              .map((ss) => ss.service?.category?.name)
              .filter(Boolean)
          ),
        ],
      }))
      .filter((staff) => staff.name);
  } catch (error) {
    reportPublicDataError("[getPublicExperts]", error);
    return [];
  }
}
