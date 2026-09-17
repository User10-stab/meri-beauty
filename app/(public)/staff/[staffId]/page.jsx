import { Suspense } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import StaffProfileHero from "@/components/staff-profile/StaffProfileHero";
import StaffServices from "@/components/staff-profile/StaffServices";
import StaffViewportLock from "@/components/staff-profile/StaffViewportLock";

async function getStaffProfile(staffId) {
  try {
    const staff = await prisma.staff.findUnique({
      where: {
        id: staffId,
        isDeleted: false,
        isActive: true,
        user: {
          isDeleted: false,
          isActive: true,
        },
      },
      select: {
        id: true,
        photo: true,
        bio: true,
        yearsOfExperience: true,
        languages: true,
        rythme: true,
        user: {
          select: {
            fullName: true,
            avatar: true,
          },
        },
        staffServices: {
          where: {
            isDeleted: false,
            isActive: true,
          },
          select: {
            id: true,
            price: true,
            duration: true,
            photo: true,
            service: {
              select: {
                id: true,
                name: true,
                description: true,
                category: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: {
            service: {
              name: "asc",
            },
          },
        },
        workingHours: {
          select: {
            day: true,
            isClosed: true,
            startTime: true,
            endTime: true,
          },
          orderBy: {
            day: "asc",
          },
        },
      },
    });

    if (!staff) {
      return null;
    }

    return staff;
  } catch (error) {
    console.error("[getStaffProfile] Error:", error);
    return null;
  }
}

async function getSalonSocialLinks() {
  try {
    const salon = await prisma.salon.findUnique({
      where: { id: "main-salon" },
      select: {
        instagram: true,
        facebook: true,
        tiktok: true,
      },
    });
    return salon || {};
  } catch {
    return {};
  }
}

export async function generateMetadata({ params }) {
  const { staffId } = await params;
  const staff = await getStaffProfile(staffId);

  if (!staff) {
    return {
      title: "Membre introuvable \u2014 Meri Beauty",
    };
  }

  const firstName = staff.user.fullName.split(" ")[0];
  const title = `${firstName} \u2014 ${staff.bio ? "Experte beaut\u00e9" : "Membre de l\u2019\u00e9quipe"} | Meri Beauty`;
  const description =
    staff.bio ||
    `D\u00e9couvrez ${firstName}, membre de notre \u00e9quipe d\u2019expertes beaut\u00e9 chez Meri Beauty \u00e0 Jette, Bruxelles. R\u00e9servez votre rendez-vous en ligne.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "profile",
      images: staff.photo
        ? [
            {
              url: staff.photo,
              alt: staff.user.fullName,
            },
          ]
        : [],
    },
  };
}

export default async function StaffProfilePage({ params }) {
  const { staffId } = await params;
  const [staff, salonSocial, session] = await Promise.all([
    getStaffProfile(staffId),
    getSalonSocialLinks(),
    auth(),
  ]);
  const customerSession = session?.user?.role === "CUSTOMER" ? session.user : null;

  if (!staff) {
    notFound();
  }

  const firstName = staff.user.fullName.split(" ")[0];
  const profileImage = staff.photo || staff.user.avatar || "/Images/expert.webp";

  const categories = [
    ...new Set(
      staff.staffServices.map((ss) => ss.service.category.name).filter(Boolean)
    ),
  ];

  return (
    // Navbar (rendered by the shared public layout) + standalone two-section
    // layout below it. The content height subtracts the navbar height
    // (logo h-[52px] + nav py-3 = 76px) so navbar + content fit the viewport
    // exactly. The page itself never scrolls (see StaffViewportLock): the
    // hero stays fixed while only the services column scrolls, with no
    // visible scrollbars anywhere.
    <div className="h-[calc(100dvh-76px)] w-full overflow-hidden bg-[#fdf8f0]">
      <StaffViewportLock />
      <div className="mx-auto flex h-full min-h-0 max-w-[1800px] flex-col overflow-hidden px-4 py-4 sm:px-6 lg:flex-row lg:gap-10 lg:px-10 lg:py-6 xl:gap-14">
        {/* Fixed hero — never scrolls at page level; its own scrollbar is
            hidden. */}
        <div className="flex items-center max-h-[44dvh] shrink-0 overflow-hidden lg:sticky lg:top-0 lg:h-full lg:max-h-none lg:w-[500px] lg:overflow-y-auto lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden ">
          <StaffProfileHero
            name={staff.user.fullName}
            firstName={firstName}
            bio={staff.bio}
            yearsOfExperience={staff.yearsOfExperience}
            languages={staff.languages}
            rythme={staff.rythme}
            workingHours={staff.workingHours}
            image={profileImage}
            socialLinks={salonSocial}
            categories={categories}
          />
        </div>

        {/* The only scrollable area on the page — scrollbar hidden, scrolling intact. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6 pt-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden lg:pt-1">
          {staff.staffServices.length > 0 && (
            <Suspense fallback={null}>
              <StaffServices
                services={staff.staffServices}
                staffId={staff.id}
                categories={categories}
                staffName={staff.user.fullName}
                customerSession={customerSession}
              />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
