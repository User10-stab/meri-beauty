export default function Button({
  children,
  className = "",
  ...props
}) {
  return (
    <button
      className={`inline-flex items-center gap-2 rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#3d4e3b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2f3a2e] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}