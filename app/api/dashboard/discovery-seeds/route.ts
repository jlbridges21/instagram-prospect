import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return Response.json({ seeds: [] }, { status: 401 });
  const result = await supabase
    .from("discovery_seeds")
    .select("id, profiles_inspected, profiles_reaching_review, profiles_approved, profiles_contacted")
    .limit(200);
  if (result.error) return Response.json({ seeds: [] });
  return Response.json({
    seeds: (result.data ?? []).map((seed) => ({
      id: seed.id,
      inspected: seed.profiles_inspected,
      review: seed.profiles_reaching_review,
      approved: seed.profiles_approved,
      contacted: seed.profiles_contacted,
    })),
  });
}
