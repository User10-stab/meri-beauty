import { cn } from "@/lib/utils";
import { useId } from "react";

export function TextAreaGroup({
  label,
  placeholder,
  required,
  disabled,
  active,
  className,
  icon,
  defaultValue,
  name,
  value,
  onChange,
}) {
  const id = useId();
  const isControlled = value !== undefined;

  return (
    <div className={cn(className)}>
      <label
        htmlFor={id}
        className="mb-3 block text-body-sm font-medium text-dark dark:text-white"
      >
        {label}
      </label>

      <div className="relative mt-3 [&_svg]:pointer-events-none [&_svg]:absolute [&_svg]:top-5.5 [&_svg]:left-5.5">
        <textarea
          id={id}
          name={name}
          rows={6}
          placeholder={placeholder}
          {...(isControlled ? { value, onChange } : { defaultValue })}
          className={cn(
            "w-full rounded-lg border-[1.5px] border-stroke bg-transparent px-5.5 py-3 text-dark transition outline-none focus:border-primary disabled:cursor-default disabled:bg-gray-2 data-[active=true]:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white dark:focus:border-primary dark:disabled:bg-dark dark:data-[active=true]:border-primary",
            icon && "py-5 pr-5 pl-13",
          )}
          required={required}
          disabled={disabled}
          data-active={active}
        />

        {icon}
      </div>
    </div>
  );
}
