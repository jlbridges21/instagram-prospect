import { getNetworkSample } from "@/lib/db/prospects";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return Response.json({ prospects: [], total: 0 }, { status: 401 });
  const sample = await getNetworkSample();
  if (!sample.ok) return Response.json({ prospects: [], total: 0 });
  return Response.json({
    prospects: sample.data.prospects.map((prospect) => ({
      id: prospect.id,
      username: prospect.username,
      display_name: prospect.name,
      profile_image_url: prospect.pictureUrl,
      fit_label: prospect.fitLabel,
      fit_score: prospect.fitScore,
      status: prospect.status,
      source: prospect.source,
    })),
    total: sample.data.total,
  });
}
