import { initials } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

const sizes = {
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-xs",
  lg: "h-16 w-16 text-base",
};

export function Avatar({
  name,
  src,
  size = "md",
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof sizes;
}) {
  if (src) {
    return (
      // Profile photos come from stored URLs and are not known at build time.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className={cn("rounded-lg object-cover", sizes[size])}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-lg bg-indigo-50 font-semibold text-indigo-700",
        sizes[size],
      )}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}
