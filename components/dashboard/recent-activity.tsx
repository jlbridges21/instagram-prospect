import Link from "next/link";
import {
  Activity,
  CalendarCheck,
  Check,
  CircleX,
  MessageSquare,
  Reply,
  Search,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

const eventIcons: Record<string, LucideIcon> = {
  prospect_discovered: Search,
  prospect_qualified: Sparkles,
  prospect_approved: Check,
  prospect_skipped: CircleX,
  prospect_disqualified: CircleX,
  message_sent: MessageSquare,
  reply_detected: Reply,
  follow_up_created: CalendarCheck,
  follow_up_completed: CalendarCheck,
  demo_booked: CalendarCheck,
  converted: Check,
  worker_error: TriangleAlert,
};

export function RecentActivity({
  events,
}: {
  events: {
    id: string;
    description: string;
    timeLabel: string;
    href: string | null;
    eventType: string;
  }[];
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Recent activity</h2>
      </div>
      {events.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Approvals, skips, and later worker events will be listed here."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {events.map((event) => {
            const Icon = eventIcons[event.eventType] ?? Activity;
            const content = (
              <div className="flex gap-3 px-5 py-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <div>
                  <p className="text-sm text-slate-800">{event.description}</p>
                  <p className="mt-1 text-xs text-slate-500">{event.timeLabel}</p>
                </div>
              </div>
            );
            return (
              <li key={event.id}>
                {event.href ? (
                  <Link href={event.href} className="block hover:bg-slate-50">
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
