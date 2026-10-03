"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  saveAppSettings,
  saveMessageTemplate,
  saveTargeting,
  saveDiscoverySettings,
  saveWorkerSettings,
} from "@/lib/actions/settings";
import { DEFAULT_MESSAGE_TEMPLATE } from "@/lib/constants/message";
import { renderOutreachMessage } from "@/lib/utils/message";
import {
  BROWSERS,
  DATE_FORMATS,
  TIMEZONES,
  type DateFormat,
} from "@/lib/constants/settings";
import { AiSettingsSection } from "@/components/settings/ai-panel";
import { OutreachSettingsForm } from "@/components/settings/outreach-settings";
import type { AppSettings, TargetingSettings } from "@/lib/db/models";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextArea, TextInput, Toggle } from "@/components/ui/field";
import { cn } from "@/lib/utils/cn";

const tabs = [
  { id: "message", label: "Outreach" },
  { id: "targeting", label: "Targeting" },
  { id: "exclusions", label: "Exclusions" },
  { id: "worker", label: "Worker" },
  { id: "automation", label: "Automation" },
  { id: "app", label: "Application" },
  { id: "ai", label: "AI" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function SettingsPanel({
  settings,
  targeting,
  openaiConfigured,
}: {
  settings: AppSettings;
  targeting: TargetingSettings;
  openaiConfigured: boolean;
}) {
  const [tab, setTab] = useState<TabId>("message");
  const [message, setMessage] = useState(settings.messageTemplate);
  const [categories, setCategories] = useState(targeting.categories);
  const [minFollowers, setMinFollowers] = useState(String(targeting.minFollowers));
  const [maxFollowers, setMaxFollowers] = useState(String(targeting.maxFollowers));
  const [englishOnly, setEnglishOnly] = useState(targeting.englishOnly);
  const [preferUnitedStates, setPreferUnitedStates] = useState(targeting.preferUnitedStates);
  const [allowUnknownLocation, setAllowUnknownLocation] = useState(targeting.allowUnknownLocation);
  const [excludeAlreadyFollowing, setExcludeAlreadyFollowing] = useState(
    targeting.excludeAlreadyFollowing,
  );
  const [excludeAlreadyContacted, setExcludeAlreadyContacted] = useState(
    targeting.excludeAlreadyContacted,
  );
  const [excludeHobbyAccounts, setExcludeHobbyAccounts] = useState(targeting.excludeHobbyAccounts);
  const [excludeMemeAccounts, setExcludeMemeAccounts] = useState(targeting.excludeMemeAccounts);
  const [excludeLargeAgencies, setExcludeLargeAgencies] = useState(targeting.excludeLargeAgencies);
  const [excludeUnrelatedDrone, setExcludeUnrelatedDrone] = useState(
    targeting.excludeUnrelatedDrone,
  );
  const [workerEnabled, setWorkerEnabled] = useState(settings.workerEnabled);
  const [preferredBrowser, setPreferredBrowser] = useState(settings.preferredBrowser);
  const [heartbeat, setHeartbeat] = useState(String(settings.heartbeatIntervalSeconds));
  const [discoveryEnabled, setDiscoveryEnabled] = useState(settings.discovery.enabled);
  const [homeFeedEnabled, setHomeFeedEnabled] = useState(settings.discovery.homeFeedEnabled);
  const [suggestedEnabled, setSuggestedEnabled] = useState(settings.discovery.suggestedAccountsEnabled);
  const [sourcePriority, setSourcePriority] = useState(settings.discovery.sourcePriority);
  const [queueTarget, setQueueTarget] = useState(String(settings.discovery.candidateQueueTarget));
  const [maxSession, setMaxSession] = useState(String(settings.discovery.maxProfilesPerSession));
  const [maxHour, setMaxHour] = useState(String(settings.discovery.maxProfilesPerHour));
  const [reviewTarget, setReviewTarget] = useState(
    settings.discovery.reviewTarget === "unlimited" ? "unlimited" : String(settings.discovery.reviewTarget),
  );
  const [sessionCap, setSessionCap] = useState(String(settings.discovery.sessionInspectionCap));
  const [dailyInspections, setDailyInspections] = useState(String(settings.discovery.dailyInspectionCap));
  const [dailyAi, setDailyAi] = useState(String(settings.discovery.dailyAiCap));
  const [appName, setAppName] = useState(settings.appName);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [dateFormat, setDateFormat] = useState<DateFormat>(settings.dateFormat);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [pending, startTransition] = useTransition();

  function targetingInput() {
    return {
      categories,
      minFollowers: Number.parseInt(minFollowers, 10),
      maxFollowers: Number.parseInt(maxFollowers, 10),
      englishOnly,
      preferUnitedStates,
      allowUnknownLocation,
      excludeAlreadyFollowing,
      excludeAlreadyContacted,
      excludeHobbyAccounts,
      excludeMemeAccounts,
      excludeLargeAgencies,
      excludeUnrelatedDrone,
    };
  }

  function save(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast.success(success);
      else toast.error(result.error);
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium",
              tab === item.id
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="p-5 sm:p-6">
        {tab === "message" ? (
          <section className="max-w-3xl space-y-4">
            <Field
              label="Message"
              hint="If a first name cannot be confidently determined, the Instagram username is used."
            >
              <TextArea value={message} onChange={(event) => setMessage(event.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Preview
                title="Example name: Tyler"
                text={renderOutreachMessage(message, { firstName: "Tyler", username: "tyler" })}
              />
              <Preview
                title="Example username: coastalaerialmedia"
                text={renderOutreachMessage(message, {
                  firstName: null,
                  username: "coastalaerialmedia",
                })}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending}
                onClick={() => save(() => saveMessageTemplate(message), "Message saved")}
              >
                Save message
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => setMessage(DEFAULT_MESSAGE_TEMPLATE)}
              >
                Reset to default
              </Button>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              Reset restores the original wording in this box. Save to keep it.
            </p>
          </section>
        ) : null}

        {tab === "targeting" ? (
          <section className="max-w-3xl space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Minimum followers">
                <TextInput
                  inputMode="numeric"
                  value={minFollowers}
                  onChange={(event) => setMinFollowers(event.target.value)}
                />
              </Field>
              <Field label="Maximum followers">
                <TextInput
                  inputMode="numeric"
                  value={maxFollowers}
                  onChange={(event) => setMaxFollowers(event.target.value)}
                />
              </Field>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800">Target categories</p>
              <ul className="mt-3 space-y-2">
                {categories.map((category) => (
                  <li key={category} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <span>{category}</span>
                    <button
                      type="button"
                      className="text-slate-400 hover:text-slate-700"
                      aria-label={`Remove ${category}`}
                      onClick={() => setCategories(categories.filter((item) => item !== category))}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <TextInput
                  value={categoryDraft}
                  placeholder="Add a category"
                  onChange={(event) => setCategoryDraft(event.target.value)}
                />
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => {
                    const next = categoryDraft.trim();
                    if (!next || categories.includes(next)) return;
                    setCategories([...categories, next]);
                    setCategoryDraft("");
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </div>
            </div>
            <div className="divide-y divide-slate-100 border-y border-slate-100">
              <Toggle
                checked={englishOnly}
                onChange={setEnglishOnly}
                label="English-speaking only"
                description="Profiles that are clearly not English-speaking can be excluded later."
              />
              <Toggle
                checked={preferUnitedStates}
                onChange={setPreferUnitedStates}
                label="Prefer the United States"
                description="US profiles are preferred. This is a preference, not a hard country filter by itself."
              />
              <Toggle
                checked={allowUnknownLocation}
                onChange={setAllowUnknownLocation}
                label="Allow unknown location"
                description="If location cannot be verified, do not automatically disqualify the profile."
              />
            </div>
            <Button
              disabled={pending}
              onClick={() => save(() => saveTargeting(targetingInput()), "Targeting saved")}
            >
              Save targeting
            </Button>
          </section>
        ) : null}

        {tab === "exclusions" ? (
          <section className="max-w-3xl">
            <div className="divide-y divide-slate-100 border-y border-slate-100">
              <Toggle
                checked={excludeAlreadyFollowing}
                onChange={setExcludeAlreadyFollowing}
                label="Exclude accounts already being followed"
              />
              <Toggle
                checked={excludeAlreadyContacted}
                onChange={setExcludeAlreadyContacted}
                label="Exclude accounts already contacted"
              />
              <Toggle
                checked={excludeHobbyAccounts}
                onChange={setExcludeHobbyAccounts}
                label="Exclude hobby-only accounts"
              />
              <Toggle
                checked={excludeMemeAccounts}
                onChange={setExcludeMemeAccounts}
                label="Exclude meme accounts"
              />
              <Toggle
                checked={excludeLargeAgencies}
                onChange={setExcludeLargeAgencies}
                label="Exclude large agencies"
                description="Clearly massive production companies are outside the solo and small-team focus."
              />
              <Toggle
                checked={excludeUnrelatedDrone}
                onChange={setExcludeUnrelatedDrone}
                label="Exclude unrelated drone content"
                description="Hobby flying and unrelated drone pages stay out of outreach."
              />
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">
              These rules are stored for later qualification. They are not applied to Instagram yet.
            </p>
            <div className="mt-4">
              <Button
                disabled={pending}
                onClick={() => save(() => saveTargeting(targetingInput()), "Exclusions saved")}
              >
                Save exclusions
              </Button>
            </div>
          </section>
        ) : null}

        {tab === "worker" ? (
          <section className="max-w-xl space-y-4">
            <div className="divide-y divide-slate-100 border-y border-slate-100">
              <Toggle
                checked={workerEnabled}
                onChange={setWorkerEnabled}
                label="Worker enabled"
                description="The local worker checks this before it browses. Turning it off pauses the worker. It does not start a browser by itself."
              />
            </div>
            <Field label="Preferred browser">
              <SelectInput
                value={preferredBrowser}
                onChange={(event) => setPreferredBrowser(event.target.value as typeof preferredBrowser)}
              >
                {BROWSERS.map((browser) => (
                  <option key={browser.value} value={browser.value}>
                    {browser.label}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Heartbeat interval (seconds)" hint="Between 5 and 600 seconds.">
              <TextInput
                inputMode="numeric"
                value={heartbeat}
                onChange={(event) => setHeartbeat(event.target.value)}
              />
            </Field>
            <Field label="Max active workers" hint="Only one worker is supported.">
              <TextInput value="1" readOnly />
            </Field>
            <Button
              disabled={pending}
              onClick={() =>
                save(
                  () =>
                    saveWorkerSettings({
                      workerEnabled,
                      preferredBrowser,
                      heartbeatIntervalSeconds: Number.parseInt(heartbeat, 10),
                    }),
                  "Worker settings saved",
                )
              }
            >
              Save worker settings
            </Button>
            <div className="border-t border-slate-100 pt-4">
              <h2 className="text-sm font-semibold text-slate-900">Discovery</h2>
              <p className="mt-1 text-sm text-slate-500">
                Suggested Accounts is preferred. Home Feed fills the queue when suggestions are thin. Profile inspection stays at 2 tabs.
              </p>
            </div>
            <Toggle checked={discoveryEnabled} onChange={setDiscoveryEnabled} label="Discovery enabled" />
            <Toggle checked={homeFeedEnabled} onChange={setHomeFeedEnabled} label="Home Feed" />
            <Toggle checked={suggestedEnabled} onChange={setSuggestedEnabled} label="Suggested Accounts" />
            <Field label="Priority">
              <SelectInput value={sourcePriority} onChange={(event) => setSourcePriority(event.target.value as typeof sourcePriority)}>
                <option value="suggested_first">Suggested Accounts first</option>
                <option value="home_first">Home Feed first</option>
              </SelectInput>
            </Field>
            <Field label="Candidate queue target" hint="5 to 25. Default 10.">
              <TextInput inputMode="numeric" value={queueTarget} onChange={(event) => setQueueTarget(event.target.value)} />
            </Field>
            <Field label="Profile inspection concurrency" hint="Fixed at 2.">
              <TextInput value="2" readOnly />
            </Field>
            <Field label="Maximum profiles per hour">
              <TextInput inputMode="numeric" value={maxHour} onChange={(event) => setMaxHour(event.target.value)} />
            </Field>
            <Field label="Maximum profiles per session">
              <TextInput inputMode="numeric" value={maxSession} onChange={(event) => setMaxSession(event.target.value)} />
            </Field>
            <Field label="Review target" hint="Discovery pauses at this review count and does not restart when the count later falls.">
              <SelectInput value={reviewTarget} onChange={(event) => setReviewTarget(event.target.value)}>
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="unlimited">Unlimited</option>
              </SelectInput>
            </Field>
            <Field label="Session inspection maximum">
              <TextInput inputMode="numeric" value={sessionCap} onChange={(event) => setSessionCap(event.target.value)} />
            </Field>
            <Field label="Daily profile inspections">
              <TextInput inputMode="numeric" value={dailyInspections} onChange={(event) => setDailyInspections(event.target.value)} />
            </Field>
            <Field label="Daily AI qualifications">
              <TextInput inputMode="numeric" value={dailyAi} onChange={(event) => setDailyAi(event.target.value)} />
            </Field>
            <Button
              disabled={pending}
              onClick={() =>
                save(
                  () =>
                    saveDiscoverySettings({
                      enabled: discoveryEnabled,
                      homeFeedEnabled,
                      suggestedAccountsEnabled: suggestedEnabled,
                      sourcePriority,
                      candidateQueueTarget: Number.parseInt(queueTarget, 10),
                      maxProfilesPerHour: Number.parseInt(maxHour, 10),
                      maxProfilesPerSession: Number.parseInt(maxSession, 10),
                      reviewTarget: reviewTarget === "unlimited" ? "unlimited" : Number.parseInt(reviewTarget, 10),
                      sessionInspectionCap: Number.parseInt(sessionCap, 10),
                      dailyInspectionCap: Number.parseInt(dailyInspections, 10),
                      dailyAiCap: Number.parseInt(dailyAi, 10),
                    }),
                  "Discovery settings saved",
                )
              }
            >
              Save discovery settings
            </Button>
          </section>
        ) : null}

        {tab === "app" ? (
          <section className="max-w-xl space-y-4">
            <Field label="App name">
              <TextInput value={appName} onChange={(event) => setAppName(event.target.value)} />
            </Field>
            <Field label="Timezone" hint="Used for found today and displayed dates.">
              <SelectInput value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Date format">
              <SelectInput
                value={dateFormat}
                onChange={(event) => setDateFormat(event.target.value as DateFormat)}
              >
                {DATE_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {format}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Button
              disabled={pending}
              onClick={() =>
                save(
                  () => saveAppSettings({ appName, timezone, dateFormat }),
                  "App settings saved",
                )
              }
            >
              Save app settings
            </Button>
          </section>
        ) : null}

        {tab === "automation" ? <OutreachSettingsForm outreach={settings.outreach} /> : null}

        {tab === "ai" ? (
          <AiSettingsSection
            enabled={settings.aiEnabled}
            strongFitMinimum={settings.strongFitMinimum}
            possibleFitMinimum={settings.possibleFitMinimum}
            configured={openaiConfigured}
          />
        ) : null}
      </div>
    </div>
  );
}

function Preview({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="text-xs font-medium text-slate-500">{title}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{text}</p>
    </div>
  );
}
