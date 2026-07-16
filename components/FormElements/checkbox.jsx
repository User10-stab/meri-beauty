import { CheckIcon, XIcon } from "@/assets/icons";
import { cn } from "@/lib/utils";
import { useId } from "react";

export function Checkbox({
  withIcon,
  label,
  name,
  withBg,
  minimal,
  onChange,
  radius,
}) {
  const id = useId();

  return (
    <div>
      <label
        htmlFor={id}
        className={cn(
          "flex cursor-pointer items-center select-none",
          !minimal && "text-body-sm font-medium",
        )}
      >
        <div className="relative">
          <input
            type="checkbox"
            onChange={onChange}
            name={name}
            id={id}
            className="peer sr-only"
          />

          <div
            className={cn(
              "mr-2 flex size-5 items-center justify-center rounded border border-dark-5 outline-0 peer-checked:border-primary peer-checked:*:block focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary dark:border-dark-6",
              withBg
                ? "*:text-white peer-checked:bg-primary"
                : "peer-checked:bg-gray-2 dark:peer-checked:bg-transparent",
              minimal && "mr-3 border-stroke dark:border-dark-3",
              radius === "md" && "rounded-md",
            )}
          >
            {!withIcon && (
              <span className="hidden size-2.5 rounded-sm bg-primary" />
            )}

            {withIcon === "check" && (
              <CheckIcon className="hidden text-primary" />
            )}

            {withIcon === "x" && <XIcon className="hidden text-primary" />}
          </div>
        </div>
        <span>{label}</span>
      </label>
    </div>
  );
}
