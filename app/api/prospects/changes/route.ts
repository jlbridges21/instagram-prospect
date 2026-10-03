import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return Response.json({ changed: false }, { status: 401 });

  const since = new URL(request.url).searchParams.get("since");
  let query = supabase.from("prospects").select("id").order("updated_at", { ascending: false }).limit(1);
  if (since) query = query.gt("updated_at", since);
  const { data, error } = await query;
  const worker = await supabase
    .from("worker_instances")
    .select("current_task, last_event")
    .order("last_heartbeat_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return Response.json({ changed: false, workerTask: worker.data?.current_task ?? null, workerEvent: worker.data?.last_event ?? null });
  const changed = since ? (data?.length ?? 0) > 0 : false;
  return Response.json({
    changed,
    cursor: new Date().toISOString(),
    workerTask: worker.data?.current_task ?? null,
    workerEvent: worker.data?.last_event ?? null,
  });
}
