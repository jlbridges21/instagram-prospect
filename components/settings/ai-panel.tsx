"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveTestedProspect, testQualification } from "@/lib/actions/qualify";
import { saveAiSettings } from "@/lib/actions/settings";
import { QUALIFICATION_MODEL } from "@/lib/ai/config";
import { categoryLabel } from "@/lib/ai/categories";
import { FIT_LABELS_TEXT } from "@/lib/constants/prospects";
import type { QualificationDecision } from "@/lib/ai/types";
import { Button } from "@/components/ui/button";
import { Field, TextArea, TextInput, Toggle } from "@/components/ui/field";

export function AiSettingsSection({
  enabled,
  strongFitMinimum,
  possibleFitMinimum,
  configured,
}: {
  enabled: boolean;
  strongFitMinimum: number;
  possibleFitMinimum: number;
  configured: boolean;
}) {
  const [aiEnabled, setAiEnabled] = useState(enabled);
  const [strong, setStrong] = useState(String(strongFitMinimum));
  const [possible, setPossible] = useState(String(possibleFitMinimum));
  const [pending, startTransition] = useTransition();

  return (
    <section className="max-w-3xl space-y-5">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-500">Qualification model</dt>
          <dd className="mt-1 text-sm text-slate-900">{QUALIFICATION_MODEL}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">OpenAI API</dt>
          <dd className="mt-1 text-sm text-slate-900">{configured ? "Configured" : "Not configured"}</dd>
        </div>
      </dl>
      <div className="divide-y divide-slate-100 border-y border-slate-100">
        <Toggle
          checked={aiEnabled}
          onChange={setAiEnabled}
          label="AI enabled"
          description="Hard exclusions still run when this is off. Profile analysis does not."
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Strong fit minimum" hint="Score at or above this value.">
          <TextInput inputMode="numeric" value={strong} onChange={(event) => setStrong(event.target.value)} />
        </Field>
        <Field label="Possible fit minimum" hint="Scores below this value are a skip.">
          <TextInput
            inputMode="numeric"
            value={possible}
            onChange={(event) => setPossible(event.target.value)}
          />
        </Field>
      </div>
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await saveAiSettings({
              aiEnabled,
              strongFitMinimum: Number.parseInt(strong, 10),
              possibleFitMinimum: Number.parseInt(possible, 10),
            });
            if (result.ok) toast.success("AI settings saved");
            else toast.error(result.error);
          })
        }
      >
        Save AI settings
      </Button>
      <AiTestPanel />
    </section>
  );
}

function AiTestPanel() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [followers, setFollowers] = useState("");
  const [location, setLocation] = useState("");
  const [result, setResult] = useState<QualificationDecision | null>(null);
  const [pending, startTransition] = useTransition();
  const [saving, startSaving] = useTransition();

  function test(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const response = await testQualification({
        instagramUsername: username,
        displayName: displayName || null,
        firstName: null,
        bio: bio || null,
        followerCount: followers.trim() ? Number.parseInt(followers, 10) : null,
        followingCount: null,
        locationText: location || null,
        language: null,
        category: null,
        alreadyFollowing: false,
        alreadyContacted: false,
        instagramPostUrl: null,
        notes: null,
      });
      if (!response.ok) {
        toast.error(response.error);
        return;
      }
      setResult(response.decision);
    });
  }

  function save() {
    if (!result) return;
    startSaving(async () => {
      const response = await saveTestedProspect(
        {
          instagramUsername: username,
          displayName: displayName || null,
          firstName: null,
          bio: bio || null,
          followerCount: followers.trim() ? Number.parseInt(followers, 10) : null,
          followingCount: null,
          locationText: location || null,
          language: null,
          category: null,
          alreadyFollowing: false,
          alreadyContacted: false,
          instagramPostUrl: null,
          notes: null,
        },
        result,
      );
      if (!response.ok) {
        toast.error(response.error);
        return;
      }
      toast.success("Prospect saved");
      router.push(`/prospects/${response.id}`);
    });
  }

  return (
    <form onSubmit={test} className="space-y-4 border-t border-slate-100 pt-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Test qualification</h3>
        <p className="mt-1 text-sm text-slate-600">
          Runs the same engine on pasted profile text. Nothing is saved until you ask.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Username">
          <TextInput required value={username} onChange={(event) => setUsername(event.target.value)} />
        </Field>
        <Field label="Display name">
          <TextInput value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </Field>
        <Field label="Followers">
          <TextInput inputMode="numeric" value={followers} onChange={(event) => setFollowers(event.target.value)} />
        </Field>
        <Field label="Location">
          <TextInput value={location} onChange={(event) => setLocation(event.target.value)} />
        </Field>
      </div>
      <Field label="Bio">
        <TextArea value={bio} onChange={(event) => setBio(event.target.value)} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Analyzing profile..." : "Test qualification"}
      </Button>
      {result ? <AnalysisReadout decision={result} /> : null}
      {result ? (
        <Button type="button" variant="secondary" disabled={saving} onClick={save}>
          Save as prospect
        </Button>
      ) : null}
    </form>
  );
}

export function AnalysisReadout({ decision }: { decision: QualificationDecision }) {
  const label = FIT_LABELS_TEXT[decision.fitLabel];
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
      <p className="font-medium text-slate-900">
        {decision.fitScore} · {label}
      </p>
      <p className="mt-2 leading-6 text-slate-700">{decision.analysis.qualification_reason}</p>
      <p className="mt-2 text-xs text-slate-500">{signalText(decision)}</p>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <Fact label="Category" value={categoryLabel(decision.category)} />
        <Fact label="First name" value={decision.firstName || "Not detected"} />
        <Fact label="Language" value={languageText(decision)} />
        <Fact label="Location" value={locationText(decision)} />
      </dl>
    </div>
  );
}

function signalText(decision: QualificationDecision) {
  const labels: Record<keyof QualificationDecision["analysis"]["signals"], string> = {
    professional_media_business: "Professional media business",
    drone_services: "Drone services",
    real_estate_media: "Real estate media",
    videography_services: "Videography",
    commercial_media: "Commercial media",
    solo_or_small_team: "Solo or small team",
  };
  const active = Object.entries(decision.analysis.signals)
    .filter((entry) => entry[1])
    .map(([key]) => labels[key as keyof typeof labels]);
  return active.length ? active.join(" · ") : "No supporting signals";
}

function languageText(decision: QualificationDecision) {
  if (decision.analysis.english_likely === true) return "Likely English";
  if (decision.analysis.english_likely === false) return "Likely not English";
  return "Uncertain";
}

function locationText(decision: QualificationDecision) {
  if (decision.analysis.us_based_likely === true) return "Likely United States";
  if (decision.analysis.us_based_likely === false) return "Likely outside the United States";
  return "Unknown";
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}
