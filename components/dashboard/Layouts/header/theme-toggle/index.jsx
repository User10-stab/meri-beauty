import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "./icons";

const THEMES = [
  {
    name: "light",
    Icon: Sun,
  },
  {
    name: "dark",
    Icon: Moon,
  },
];

export function ThemeToggleSwitch() {
  const { setTheme, theme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  const activeTheme = resolvedTheme ?? theme ?? "light";
  const nextTheme = activeTheme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(nextTheme)}
      className="group cursor-pointer rounded-full bg-gray-3 p-1.25 text-dark outline-0 hover:outline-primary focus:outline-primary focus-visible:outline dark:bg-[#020D1A] dark:text-current"
      aria-pressed={activeTheme === "dark"}
    >
      <span className="sr-only">
        Switch to {nextTheme} mode
      </span>

      <span aria-hidden className="relative flex gap-2.5">
        {/* Indicator */}
        <span className="absolute size-9.5 rounded-full border border-gray-200 bg-white transition-all dark:translate-x-12 dark:border-none dark:bg-dark-2 dark:group-hover:bg-dark-3" />

        {THEMES.map(({ name, Icon }) => (
          <span
            key={name}
            className={cn(
              "relative grid size-9.5 place-items-center rounded-full",
              name === "dark" && "dark:text-white",
            )}
          >
            <Icon />
          </span>
        ))}
      </span>
    </button>
  );
}
