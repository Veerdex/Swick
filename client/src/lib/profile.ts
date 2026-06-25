import { supabase, ensureSession } from "./supabase";

// The player's profile lives in a `profiles` row keyed to their Supabase user
// id, guarded by RLS so they can only touch their own. For now it just holds
// the display name (the persistent wallet column is added later).

/** Read the saved display name for the current user, or null if none yet. */
export async function loadDisplayName(): Promise<string | null> {
  const session = await ensureSession();
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error) {
    console.error("loadDisplayName failed:", error.message);
    return null;
  }
  return data?.display_name ?? null;
}

/** Create or update the current user's display name. */
export async function saveDisplayName(name: string): Promise<void> {
  const session = await ensureSession();
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: session.user.id, display_name: name });
  if (error) console.error("saveDisplayName failed:", error.message);
}
