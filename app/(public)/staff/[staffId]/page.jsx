import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import StaffProfileHero from "@/components/staff-profile/StaffProfileHero";
import StaffServices from "@/components/staff-profile/StaffServices";
import Breadcrumb from "@/components/staff-profile/Breadcrumb";
import { BotanicalBranch, BotanicalSprig, Botanical } from "@/components/botanical-decorations";

const DAY_ABBREVS = {
  MONDAY: "Lun",
  TUESDAY: "Mar",
  WEDNESDAY: "Mer",
  THURSDAY: "Jeu",
  FRIDAY: "Ven",
  SATURDAY: "Sam",
  SUNDAY: "Dim",
};

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
  const [staff, salonSocial] = await Promise.all([
    getStaffProfile(staffId),
    getSalonSocialLinks(),
  ]);

  if (!staff) {
    notFound();
  }

  const firstName = staff.user.fullName.split(" ")[0];
  const profileImage = staff.photo || staff.user.avatar || "/Images/expert.jpg";

  const categories = [
    ...new Set(
      staff.staffServices.map((ss) => ss.service.category.name).filter(Boolean)
    ),
  ];

  const workingSchedule = staff.workingHours
    .filter((wh) => !wh.isClosed)
    .map((wh) => ({
      day: DAY_ABBREVS[wh.day],
      dayFull: wh.day,
      startTime: wh.startTime,
      endTime: wh.endTime,
    }))
    .filter(Boolean);

  const rythmeDays = workingSchedule.map(ws => ws.day);

  return (
    <div className="w-full bg-[#fdf8f0]">
      <Breadcrumb staffName={staff.user.fullName} />

      <StaffProfileHero
        name={staff.user.fullName}
        firstName={firstName}
        bio={staff.bio}
        yearsOfExperience={staff.yearsOfExperience}
        languages={staff.languages}
        rythme={staff.rythme}
        rythmeDays={rythmeDays}
        workingSchedule={workingSchedule}
        image={profileImage}
        staffId={staff.id}
        socialLinks={salonSocial}
      />

     

      {staff.staffServices.length > 0 && (
        <StaffServices
          services={staff.staffServices}
          staffId={staff.id}
          firstName={firstName}
          categories={categories}
        />
      )}

      {/* Closing CTA section with decorative elements */}
      <section className="relative overflow-hidden bg-gradient-to-b from-white to-[#fdf8f0] py-20 sm:py-24">
        {/* Decorative background */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {/* Top left botanical branch */}
          <BotanicalBranch className="absolute -top-16 -left-20 w-48 h-64 text-[#b89664]/10 transform -rotate-12" />
          
          {/* Bottom right botanical sprig */}
          <BotanicalSprig className="absolute -bottom-20 -right-16 w-32 h-48 text-[#b89664]/8 transform rotate-12" />
          
          {/* Center large botanical */}
          <Botanical className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-80 text-[#b89664]/5" />
          
          {/* Floating decorative circles */}
          <div className="absolute -top-32 -left-32 h-64 w-64 rounded-full border border-[#b89664]/10" />
          <div className="absolute -bottom-24 -right-24 h-48 w-48 rounded-full border border-[#b89664]/8" />
        </div>

        <div className="relative mx-auto max-w-[700px] px-4 text-center sm:px-6">
          <div className="mb-6 inline-flex items-center gap-2">
            <span className="h-px w-8 bg-[#b89664]/40" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b89664]/60">
              Meri Beauty
            </span>
            <span className="h-px w-8 bg-[#b89664]/40" />
          </div>

          <h2 className="font-display text-[1.8rem] font-semibold leading-tight tracking-tight text-[#2F3A2E] sm:text-[2.2rem]">
            Pr&ecirc;t(e) &agrave; prendre soin de vous ?
          </h2>

          <p className="mx-auto mt-5 max-w-lg text-sm leading-relaxed text-[#6f6a64] sm:text-base">
            R&eacute;servez votre prochain rendez-vous avec {firstName} et offrez-vous un moment de beaut&eacute; personnalis&eacute;.
          </p>

          <div className="mt-8">
            <a
              href={`/reservation?staff=${staff.id}`}
              className="group inline-flex items-center gap-2 rounded-full bg-[#2F3A2E] px-8 py-3.5 text-sm font-semibold text-white transition-all duration-300 hover:bg-[#212a20] hover:shadow-lg hover:-translate-y-0.5"
            >
              Prendre rendez-vous
              <span className="transition-transform group-hover:translate-x-1">&rarr;</span>
            </a>
          </div>

          {/* Decorative bottom element */}
          <div className="mt-12 flex items-center justify-center gap-3 text-[#b89664]/30">
            <span className="h-px w-12 bg-current" />
            <span className="h-1.5 w-1.5 rotate-45 border border-current" />
            <span className="h-px w-12 bg-current" />
          </div>
        </div>
      </section>
    </div>
  );
}
