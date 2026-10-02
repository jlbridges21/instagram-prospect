import Link from "next/link";
import { Inbox } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { FitBadge, StatusBadge } from "@/components/ui/badge";
import type { FitLabel, ProspectStatus } from "@/lib/constants/prospects";
import { formatFollowerCount } from "@/lib/utils/format";

export function RecentProspects({
  prospects,
}: {
  prospects: {
    id: string;
    name: string;
    username: string;
    status: ProspectStatus;
    followers: number | null;
    fitLabel: FitLabel | null;
    fitScore: number | null;
    discoveredLabel: string;
    pictureUrl: string | null;
  }[];
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Recent prospects</h2>
        <Link href="/prospects" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
          View all
        </Link>
      </div>
      {prospects.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No prospects yet"
          description="Discovered profiles will show up here. The worker that finds them is not running yet."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {prospects.map((prospect) => (
            <li key={prospect.id}>
              <Link
                href={`/prospects/${prospect.id}`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50"
              >
                <Avatar name={prospect.name} src={prospect.pictureUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{prospect.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    @{prospect.username} · {formatFollowerCount(prospect.followers)}
                  </p>
                </div>
                <div className="hidden text-right sm:block">
                  <div className="flex items-center justify-end gap-2">
                    <span className="text-xs tabular-nums text-slate-500">{prospect.fitScore ?? "—"}</span>
                    <FitBadge label={prospect.fitLabel} />
                  </div>
                  <div className="mt-1">
                    <StatusBadge status={prospect.status} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{prospect.discoveredLabel}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
