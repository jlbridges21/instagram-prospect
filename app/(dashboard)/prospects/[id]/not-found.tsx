import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export default function ProspectNotFound() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-6 py-10">
      <h1 className="text-lg font-semibold text-slate-900">Prospect not found</h1>
      <p className="mt-2 text-sm text-slate-600">That record is not in the workspace.</p>
      <Link href="/prospects" className={`${buttonClasses("primary", "md")} mt-5`}>
        Back to prospects
      </Link>
    </div>
  );
}
