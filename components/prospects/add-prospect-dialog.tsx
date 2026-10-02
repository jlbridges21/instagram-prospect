"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addProspect } from "@/lib/actions/prospects";
import { DEFAULT_CATEGORIES } from "@/lib/constants/settings";
import { Button } from "@/components/ui/button";
import { Field, TextArea, TextInput } from "@/components/ui/field";

const empty = {
  instagramUsername: "",
  displayName: "",
  firstName: "",
  profileUrl: "",
  profilePictureUrl: "",
  bio: "",
  followerCount: "",
  followingCount: "",
  location: "",
  language: "en",
  category: "",
  fitScore: "",
  qualificationReason: "",
  sourcePostUrl: "",
  sourcePostThumbnailUrl: "",
  notes: "",
};

export function AddProspectButton() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function set(key: keyof typeof empty, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await addProspect(form);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Prospect added");
      setForm(empty);
      setOpen(false);
      if (result.id) router.push(`/prospects/${result.id}`);
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Add prospect</Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            aria-label="Close add prospect"
            onClick={() => setOpen(false)}
          />
          <form
            onSubmit={submit}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-prospect-title"
            className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
          >
            <h2 id="add-prospect-title" className="text-lg font-semibold text-slate-900">
              Add prospect
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Manual records are marked as source Manual and placed in the review queue.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Instagram username">
                <TextInput
                  autoFocus
                  required
                  value={form.instagramUsername}
                  onChange={(event) => set("instagramUsername", event.target.value)}
                  placeholder="coastalaerialmedia"
                />
              </Field>
              <Field label="Display name">
                <TextInput
                  value={form.displayName}
                  onChange={(event) => set("displayName", event.target.value)}
                />
              </Field>
              <Field label="First name">
                <TextInput
                  value={form.firstName}
                  onChange={(event) => set("firstName", event.target.value)}
                />
              </Field>
              <Field label="Profile URL" hint="Filled from the username when left blank.">
                <TextInput
                  value={form.profileUrl}
                  onChange={(event) => set("profileUrl", event.target.value)}
                />
              </Field>
              <Field label="Profile picture URL">
                <TextInput
                  value={form.profilePictureUrl}
                  onChange={(event) => set("profilePictureUrl", event.target.value)}
                />
              </Field>
              <Field label="Category">
                <TextInput
                  list="prospect-categories"
                  value={form.category}
                  onChange={(event) => set("category", event.target.value)}
                />
                <datalist id="prospect-categories">
                  {DEFAULT_CATEGORIES.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
              </Field>
              <Field label="Follower count">
                <TextInput
                  inputMode="numeric"
                  value={form.followerCount}
                  onChange={(event) => set("followerCount", event.target.value)}
                />
              </Field>
              <Field label="Following count">
                <TextInput
                  inputMode="numeric"
                  value={form.followingCount}
                  onChange={(event) => set("followingCount", event.target.value)}
                />
              </Field>
              <Field label="Location">
                <TextInput
                  value={form.location}
                  onChange={(event) => set("location", event.target.value)}
                />
              </Field>
              <Field label="Language">
                <TextInput
                  value={form.language}
                  onChange={(event) => set("language", event.target.value)}
                />
              </Field>
              <Field label="Fit score" hint="0 to 100. 80 or higher is Strong Fit.">
                <TextInput
                  inputMode="numeric"
                  value={form.fitScore}
                  onChange={(event) => set("fitScore", event.target.value)}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Bio">
                  <TextArea value={form.bio} onChange={(event) => set("bio", event.target.value)} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Qualification reason">
                  <TextArea
                    value={form.qualificationReason}
                    onChange={(event) => set("qualificationReason", event.target.value)}
                  />
                </Field>
              </div>
              <Field label="Source post URL">
                <TextInput
                  value={form.sourcePostUrl}
                  onChange={(event) => set("sourcePostUrl", event.target.value)}
                />
              </Field>
              <Field label="Source post thumbnail URL">
                <TextInput
                  value={form.sourcePostThumbnailUrl}
                  onChange={(event) => set("sourcePostThumbnailUrl", event.target.value)}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <TextArea
                    value={form.notes}
                    onChange={(event) => set("notes", event.target.value)}
                  />
                </Field>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving" : "Save prospect"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
