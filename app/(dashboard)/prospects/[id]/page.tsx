import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { categoryLabel } from "@/lib/ai/categories";
import { qualificationSchema } from "@/lib/ai/schemas";
import { ScheduleFollowUp } from "@/components/follow-ups/follow-up-form";
import { DatabaseSetup } from "@/components/layout/database-setup";
import { NotesEditor, ProspectActions } from "@/components/prospects/prospect-actions";
import { QualifyButton } from "@/components/prospects/qualify-controls";
import { AnalysisReadout } from "@/components/settings/ai-panel";
import { MessageEditor } from "@/components/prospects/message-editor";
import { OutreachProgress } from "@/components/outreach/progress";
import { QueuedMessageEditor } from "@/components/outreach/queued-message";
import { Avatar } from "@/components/ui/avatar";
import { FitBadge, StatusBadge } from "@/components/ui/badge";
import {
  FIT_LABELS_TEXT,
  SOURCE_LABELS,
  type FitLabel,
  type ProspectSource,
} from "@/lib/constants/prospects";
import { getProspectOutreach } from "@/lib/db/outreach";
import { getProspectActivity } from "@/lib/db/stats";
import { ProspectSeedToggle } from "@/components/prospects/seed-toggle";
import { prospectDiscoveryLink, seedExists } from "@/lib/db/seeds";
import { getProspectById } from "@/lib/db/prospects";
import { fallbackSettings, getSettings } from "@/lib/db/settings";
import { prospectOutreachFlags } from "@/lib/outreach/requeue";
import { prospectReason, relationshipLabel } from "@/lib/prospects/reason";
import { STATUS_MEANING } from "@/lib/prospects/status";
import { formatDateTime, formatFollowerCount, isUuid } from "@/lib/utils/format";
import { prospectMessage } from "@/lib/utils/message";

export const maxDuration = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: isUuid(id) ? "Prospect" : "Prospect not found" };
}

export default async function ProspectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [prospectResult, settingsResult, activityResult, outreachResult] = await Promise.all([
    getProspectById(id),
    getSettings(),
    getProspectActivity(id),
    getProspectOutreach(id),
  ]);

  if (!prospectResult.ok) {
    if (prospectResult.missingTable) return <DatabaseSetup message={prospectResult.error} />;
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {prospectResult.error}
      </div>
    );
  }

  if (!prospectResult.data) notFound();

  const prospect = prospectResult.data;
  const settings = settingsResult.ok ? settingsResult.data : fallbackSettings();
  const name = prospect.display_name || prospect.first_name || prospect.instagram_username;
  const message = prospectMessage({
    template: settings.messageTemplate,
    messageOverride: prospect.message_override,
    firstName: prospect.first_name,
    username: prospect.instagram_username,
  });
  const profileUrl = prospect.profile_url || `https://www.instagram.com/${prospect.instagram_username}/`;
  const [seeded, discoveryLink] = await Promise.all([
    seedExists(prospect.instagram_username),
    prospectDiscoveryLink(prospect.id),
  ]);
  const seedUsername = discoveryLink?.source_seed_username ?? null;
  const analysis = qualificationSchema.safeParse(prospect.ai_analysis);
  const when = (value: string | null) => formatDateTime(value, settings.timezone, settings.dateFormat);
  const outreachJobs = outreachResult.ok ? outreachResult.data : [];
  const outreachFlags = prospectOutreachFlags(
    outreachJobs.map((job) => ({
      status: job.status,
      scheduledFor: job.scheduled_for,
      idempotencyKey: job.idempotency_key,
    })),
  );
  const canRequeue =
    prospect.status === "approved" && !prospect.already_contacted && outreachFlags.canRequeue;
  const outreachLabel = outreachFlags.active
    ? "Queued"
    : canRequeue || prospect.outreach_cancelled_at
      ? "Cancelled"
      : "Not queued";

  return (
    <div>
      <Link href="/prospects" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
        Back to prospects
      </Link>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-start gap-4">
              <Avatar name={name} src={prospect.profile_picture_url} size="lg" />
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{name}</h1>
                <a
                  href={profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-indigo-700"
                >
                  @{prospect.instagram_username}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusBadge status={prospect.status} />
                  <FitBadge label={prospect.fit_label} />
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  {categoryLabel(prospect.category)} · {formatFollowerCount(prospect.follower_count)} followers
                  {prospect.location_text ? ` · ${prospect.location_text}` : ""}
                </p>
              </div>
            </div>
          </section>

          <Panel title="Profile">
            <p className="text-sm leading-6 text-slate-800">{prospect.bio || "No bio stored."}</p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <Fact label="Relationship" value={relationshipLabel(prospect)} />
              <div className="sm:col-span-2">
                <Fact label="Reason" value={prospectReason(prospect)} />
              </div>
              <Fact
                label="AI result"
                value={prospect.fit_label ? FIT_LABELS_TEXT[prospect.fit_label as FitLabel] : "Not analyzed"}
              />
              <Fact label="Fit score" value={prospect.fit_score === null ? "Not scored" : String(prospect.fit_score)} />
              <Fact label="Category" value={categoryLabel(prospect.category)} />
              <Fact label="First name" value={prospect.first_name || "Not stored"} />
              <Fact label="Following count" value={formatFollowerCount(prospect.following_count)} />
              <Fact label="Language" value={prospect.language || "Not set"} />
              <Fact
                label="Source"
                value={SOURCE_LABELS[prospect.source as ProspectSource] ?? prospect.source}
              />
              <Fact label="Seed" value={seedUsername ? `@${seedUsername}` : "Not from a seed"} />
              <Fact label="Discovery priority" value={discoveryLink?.discovery_priority_label || "Not recorded"} />
              <div className="sm:col-span-2">
                <Fact label="Why this profile was inspected" value={discoveryLink?.discovery_priority_reason || "No priority notes stored."} />
              </div>
            </dl>
            {seeded === null ? null : <ProspectSeedToggle prospectId={prospect.id} username={prospect.instagram_username} seeded={seeded} />}
          </Panel>

          <Panel title="Qualification">
            <p className="text-sm text-slate-500">
              Fit score{" "}
              <span className="font-medium tabular-nums text-slate-900">
                {prospect.fit_score ?? "—"}
              </span>
              {prospect.fit_label ? ` · ${FIT_LABELS_TEXT[prospect.fit_label as FitLabel]}` : ""}
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-800">
              {prospect.qualification_reason || "No qualification reason has been stored."}
            </p>
          </Panel>

          <Panel title="Source post">
            {prospect.instagram_post_thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={prospect.instagram_post_thumbnail_url}
                alt=""
                className="mb-3 h-40 w-full rounded-lg object-cover"
              />
            ) : (
              <p className="mb-3 text-sm text-slate-500">No thumbnail stored.</p>
            )}
            {prospect.instagram_post_url ? (
              <a
                href={prospect.instagram_post_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                Open source post
              </a>
            ) : (
              <p className="text-sm text-slate-500">No source post link stored.</p>
            )}
          </Panel>

          <Panel title="Notes">
            <NotesEditor id={prospect.id} notes={prospect.notes ?? ""} />
          </Panel>

          <Panel title="Activity">
            {activityResult.ok && activityResult.data.length > 0 ? (
              <ol className="space-y-4">
                {activityResult.data.map((event) => (
                  <li key={event.id} className="border-l-2 border-slate-200 pl-3">
                    <p className="text-sm text-slate-800">{event.description}</p>
                    <p className="mt-1 text-xs text-slate-500">{when(event.created_at)}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-slate-500">No activity has been recorded for this prospect yet.</p>
            )}
          </Panel>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Panel title="Status">
            <StatusBadge status={prospect.status} />
            <p className="mt-3 text-sm leading-6 text-slate-600">{STATUS_MEANING[prospect.status]}</p>
            <dl className="mt-4 space-y-3">
              <Fact label="Discovered" value={when(prospect.discovered_at)} />
              <Fact label="Approved" value={when(prospect.approved_at)} />
              <Fact label="Contacted" value={when(prospect.contacted_at)} />
              <Fact label="Replied" value={when(prospect.replied_at)} />
              <Fact label="Demo booked" value={when(prospect.demo_booked_at)} />
            </dl>
          </Panel>

          <Panel title="Outreach">
            <p className="mb-3 text-sm text-slate-700">
              Outreach: <span className="font-medium text-slate-900">{outreachLabel}</span>
            </p>
            {outreachFlags.nextScheduled ? (
              <p className="mb-3 text-sm text-slate-600">
                Scheduled outreach: {when(outreachFlags.nextScheduled)}. The worker claims this only when that time is inside the active outreach window.
              </p>
            ) : null}
            {outreachResult.ok ? (
              <OutreachProgress
                approved={Boolean(prospect.approved_at) || prospect.status === "approved" || prospect.status === "contacted"}
                messageLocked={Boolean(prospect.queued_message_text?.trim())}
                contacted={prospect.already_contacted || prospect.status === "contacted"}
                alreadyFollowing={prospect.already_following}
                cancelled={Boolean(prospect.outreach_cancelled_at)}
                jobs={outreachResult.data}
              />
            ) : (
              <p className="text-sm text-slate-600">
                {outreachResult.missingTable
                  ? "Outreach progress appears after the Prompt 4 migration."
                  : "Outreach progress could not be loaded."}
              </p>
            )}
            {canRequeue ? (
              <div className="mt-4">
                <ProspectActions
                  id={prospect.id}
                  status={prospect.status}
                  profileUrl={profileUrl}
                  message={message}
                  canRequeue
                  requeueOnly
                />
              </div>
            ) : null}
          </Panel>

          <Panel title="Message preview">
            {prospect.queued_message_text ? (
              <QueuedMessageEditor
                id={prospect.id}
                message={prospect.queued_message_text}
                locked={
                  outreachResult.ok &&
                  outreachResult.data.some(
                    (job) =>
                      job.job_type === "send_message" &&
                      (job.status === "claimed" || job.status === "running" || job.status === "completed"),
                  )
                }
              />
            ) : (
              <MessageEditor
                id={prospect.id}
                message={message}
                hasOverride={Boolean(prospect.message_override?.trim())}
              />
            )}
            {prospect.sent_message_text ? (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="text-xs font-medium text-slate-500">Message sent</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                  {prospect.sent_message_text}
                </p>
              </div>
            ) : null}
          </Panel>

          <Panel title="AI analysis">
            {analysis.success ? (
              <AnalysisReadout
                decision={{
                  analysis: analysis.data,
                  fitScore: analysis.data.fit_score,
                  fitLabel: analysis.data.fit_label,
                  category: analysis.data.category,
                  qualified: analysis.data.qualified,
                  status: analysis.data.qualified ? "review" : "disqualified",
                  firstName: prospect.first_name,
                  language: prospect.language,
                  calledModel: prospect.ai_model !== "rules",
                  inputTokens: null,
                  outputTokens: null,
                }}
              />
            ) : (
              <p className="text-sm text-slate-600">
                {prospect.qualification_error
                  ? `AI analysis did not finish. ${prospect.qualification_error}`
                  : "This profile has not been analyzed yet."}
              </p>
            )}
            <div className="mt-4">
              <QualifyButton
                id={prospect.id}
                analyzed={Boolean(prospect.ai_analyzed_at)}
                failed={Boolean(prospect.qualification_error)}
              />
            </div>
          </Panel>

          <Panel title="Actions">
            <ProspectActions
              id={prospect.id}
              status={prospect.status}
              profileUrl={profileUrl}
              message={message}
              canRequeue={canRequeue}
            />
          </Panel>

          <Panel title="Schedule follow-up">
            <ScheduleFollowUp prospectId={prospect.id} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{value}</dd>
    </div>
  );
}
