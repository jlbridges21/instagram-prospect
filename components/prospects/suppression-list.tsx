import { RemoveSuppression } from "@/components/prospects/remove-suppression";
import { createClient } from "@/lib/supabase/server";

export async function SuppressionList() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("discovery_suppressions")
    .select("instagram_username_normalized, reason, follow_relationship, source, last_seen_at, expires_at, permanent")
    .order("last_seen_at", { ascending: false })
    .limit(25);

  if (error) {
    return <p className="mb-4 text-sm text-slate-500">Suppression records are available after the Discovery V3 migration.</p>;
  }

  return (
    <div className="mb-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Username</th>
            <th className="px-3 py-2">Reason</th>
            <th className="px-3 py-2">Relationship</th>
            <th className="px-3 py-2">Source</th>
            <th className="px-3 py-2">Last seen</th>
            <th className="px-3 py-2">Eligible again</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((row) => (
            <tr key={row.instagram_username_normalized} className="border-t border-slate-100">
              <td className="px-3 py-2">@{row.instagram_username_normalized}</td>
              <td className="px-3 py-2">{row.reason}</td>
              <td className="px-3 py-2">{row.follow_relationship ?? "—"}</td>
              <td className="px-3 py-2">{row.source ?? "—"}</td>
              <td className="px-3 py-2">{row.last_seen_at.slice(0, 10)}</td>
              <td className="px-3 py-2">{row.permanent ? "Permanent" : row.expires_at?.slice(0, 10) ?? "—"}</td>
              <td className="px-3 py-2">
                <RemoveSuppression username={row.instagram_username_normalized} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-xs text-slate-500">Removing a suppression may allow the account to be rediscovered. These rows were rejected before AI and have no fit score.</p>
    </div>
  );
}
