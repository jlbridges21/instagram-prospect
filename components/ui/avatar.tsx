"use client";

import { useState } from "react";
import { showProfilePhoto } from "@/lib/prospects/reason";
import { cn } from "@/lib/utils/cn";

const sizes = {
  sm: "h-8 w-8 text-[10px]",
  md: "h-9 w-9 text-[11px]",
  lg: "h-16 w-16 text-sm",
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
  const [failed, setFailed] = useState(false);
  const sizeClass = sizes[size];

  if (showProfilePhoto(src, failed) && src) {
    return (
      // Instagram CDN hosts change and block hotlinked requests that send a referrer.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn("shrink-0 rounded-full object-cover", sizeClass)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-indigo-50 font-semibold text-indigo-700",
        sizeClass,
      )}
      title={name}
      aria-hidden
    >
      SP
    </div>
  );
}
