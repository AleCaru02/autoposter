import { neonClient } from "../../lib/neon-client";
import type { VideoPlan } from "../../../api/_lib/video-studio";

export type SavedVideoDraft = { id: string; title: string; updated_at: string; plan: VideoPlan };
export async function saveVideoDraft(plan: VideoPlan): Promise<string> {
  if (!plan.profileId || plan.status !== "DRAFT") throw new Error("INVALID_VIDEO_DRAFT");
  const id = crypto.randomUUID();
  const result = await neonClient.from("content_items").insert({
    id, profile_id: plan.profileId, topic: plan.title, title: plan.title,
    objective: plan.objective, status: "DRAFT",
    decision_record: { source: "VIDEO_STUDIO", videoPlan: plan, publicationReady: false },
    updated_at: new Date().toISOString()
  }).select("id").single();
  if (result.error || !result.data) throw new Error("VIDEO_DRAFT_SAVE_FAILED");
  return id;
}
export async function loadVideoDrafts(profileId: string): Promise<SavedVideoDraft[]> {
  if (!profileId) return [];
  const result = await neonClient.from("content_items")
    .select("id,title,updated_at,decision_record")
    .eq("profile_id",profileId)
    .order("updated_at",{ascending:false}).limit(100);
  if (result.error) throw new Error("VIDEO_DRAFT_LOAD_FAILED");
  return (result.data ?? []).flatMap((row) => {
    const record = row.decision_record as {source?:string;videoPlan?:VideoPlan}|null;
    return record?.source === "VIDEO_STUDIO" && record.videoPlan?.profileId === profileId
      ? [{id:row.id,title:row.title??record.videoPlan.title,updated_at:row.updated_at,plan:record.videoPlan}]
      : [];
  });
}
