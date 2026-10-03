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
  if (error) return Response.json({ changed: false });
  const changed = since ? (data?.length ?? 0) > 0 : false;
  return Response.json({
    changed,
    cursor: new Date().toISOString(),
  });
}
