"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { deleteSuppressions } from "@/lib/actions/prospects";

export function RemoveSuppression({ username }: { username: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="text-xs text-red-700"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await deleteSuppressions([username]);
          if (!result.ok) toast.error(result.error);
          else toast.success("Removing this suppression may allow the account to be rediscovered.");
        })
      }
    >
      Remove suppression
    </button>
  );
}
