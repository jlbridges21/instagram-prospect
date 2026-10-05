"use client";

import dynamic from "next/dynamic";
import type { GlobeProspect } from "@/lib/visual/globe";

const ProspectGlobe = dynamic(() => import("./prospect-globe").then((mod) => mod.ProspectGlobe), {
  ssr: false,
  loading: () => <div className="h-[420px] rounded-xl bg-[#05070d] sm:h-[520px] lg:h-[620px]" aria-hidden />,
});

export function GlobalNetwork(props: {
  prospects: GlobeProspect[];
  total: number;
  review: number;
  contacted: number;
}) {
  return <ProspectGlobe {...props} />;
}
