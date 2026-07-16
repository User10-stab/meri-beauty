import { cn } from "@/lib/utils";
import { cva } from "class-variance-authority";
import Link from "next/link";
import { useSidebarContext } from "./sidebar-context";

const menuItemBaseStyles = cva(
  "rounded-lg px-3.5 font-medium text-dark-4 transition-all duration-200 dark:text-dark-6",
  {
    variants: {
      isActive: {
        true: "bg-[rgba(47,58,46,0.08)] text-primary hover:bg-[rgba(47,58,46,0.08)] dark:bg-[#FFFFFF1A] dark:text-white",
        false:
          "hover:bg-gray-100 hover:text-dark hover:dark:bg-[#FFFFFF1A] hover:dark:text-white",
      },
    },
    defaultVariants: {
      isActive: false,
    },
  },
);

export function MenuItem({ className, children, isActive, as, href, onClick, ...rest }) {
  const { toggleSidebar, isMobile } = useSidebarContext();

  if (as === "link") {
    return (
      <Link
        href={href}
        // Close sidebar on clicking link if it's mobile
        onClick={() => isMobile && toggleSidebar()}
        className={cn(
          menuItemBaseStyles({
            isActive: isActive,
            className: "relative block py-2",
          }),
          className,
        )}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      onClick={onClick}
      aria-expanded={isActive}
      className={menuItemBaseStyles({
        isActive: isActive,
        className: "flex w-full items-center gap-3 py-3",
      })}
    >
      {children}
    </button>
  );
}
