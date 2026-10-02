import { CircleAlert } from "lucide-react";

export function DatabaseSetup({
  title = "Database is not ready",
  message,
}: {
  title?: string;
  message: string;
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">{title}</p>
          <p className="mt-1 leading-6">{message}</p>
          <p className="mt-2 leading-6">
            Open the Supabase SQL editor and run{" "}
            <span className="font-medium">supabase/migrations/20261002120000_init.sql</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
