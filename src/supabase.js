import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function makeClient() {
  try {
    if (!url || !anonKey) throw new Error("missing");
    // Throws if url is malformed — caught below so the app can still render.
    // eslint-disable-next-line no-new
    new URL(url);
    return createClient(url, anonKey);
  } catch (e) {
    console.error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY " +
        "in .env.local (local) or in Vercel's Environment Variables (production)."
    );
    return null;
  }
}

export const supabase = makeClient();

function requireClient() {
  if (!supabase) throw new Error("Supabase not configured");
  return supabase;
}

const BUCKET = "media";

/* ----------------------------------------------------------------
   Roster / profiles
   ---------------------------------------------------------------- */

// Returns [{ id, name, role, has_pin, avatar_url }]
// Uses the get_roster() function so pin_hash is never exposed to the client.
export async function loadRoster() {
  const { data, error } = await requireClient().rpc("get_roster");
  if (error) throw error;
  return data || [];
}

// Set (or reset) a user's PIN. Hashing happens inside the DB function.
export async function setPin(userId, pin) {
  const { error } = await requireClient().rpc("set_pin", {
    p_user_id: userId,
    p_pin: pin,
  });
  if (error) throw error;
  return true;
}

// Verify a PIN. Returns true/false. The hash never reaches the browser.
export async function verifyPin(userId, pin) {
  const { data, error } = await requireClient().rpc("verify_pin", {
    p_user_id: userId,
    p_pin: pin,
  });
  if (error) throw error;
  return data === true;
}

/* ----------------------------------------------------------------
   Media upload (board images/gifs + profile pics)
   ---------------------------------------------------------------- */

// Uploads a base64 data URL to Supabase Storage, returns a public URL.
async function uploadDataUrl(path, dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const { error } = await requireClient().storage
    .from(BUCKET)
    .upload(path, blob, { upsert: true, contentType: blob.type });
  if (error) throw error;
  const { data } = requireClient().storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadBoardMedia(userId, itemId, dataUrl, ext) {
  const path = `board/${userId}/${itemId}.${ext}`;
  return uploadDataUrl(path, dataUrl);
}

export async function setAvatar(userId, dataUrl) {
  const path = `avatars/${userId}.jpg?`;
  const publicUrl = await uploadDataUrl(`avatars/${userId}.jpg`, dataUrl);
  // Cache-bust so the new photo shows immediately.
  const busted = `${publicUrl}?v=${Date.now()}`;
  const { error } = await requireClient()
    .from("profiles")
    .update({ avatar_url: busted })
    .eq("id", userId);
  if (error) throw error;
  return busted;
}

/* ----------------------------------------------------------------
   Board items (mood board pins)
   ---------------------------------------------------------------- */

// Map a DB row -> the shape the UI uses.
function rowToItem(r) {
  return {
    id: r.id,
    owner: r.owner_id,
    ownerName: r.owner_name,
    type: r.kind,
    x: r.x,
    y: r.y,
    rot: r.rot,
    w: r.w,
    z: r.z,
    text: r.text,
    color: r.color,
    src: r.src,
  };
}

// Map the UI item shape -> a DB row.
function itemToRow(it) {
  return {
    id: it.id,
    owner_id: it.owner,
    owner_name: it.ownerName,
    kind: it.type,
    x: it.x,
    y: it.y,
    rot: it.rot,
    w: it.w,
    z: it.z,
    text: it.text ?? null,
    color: it.color ?? null,
    src: it.src ?? null,
  };
}

// Returns all pins, oldest first (so z-order stacks correctly).
export async function loadBoard() {
  const { data, error } = await requireClient()
    .from("board_items")
    .select("*")
    .order("z", { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToItem);
}

export async function addBoardItem(item) {
  const { error } = await requireClient().from("board_items").insert(itemToRow(item));
  if (error) throw error;
  return true;
}

// Persist position + stacking order after a drag (patch uses UI field names).
export async function updateBoardItem(id, patch) {
  const row = {};
  if ("x" in patch) row.x = patch.x;
  if ("y" in patch) row.y = patch.y;
  if ("z" in patch) row.z = patch.z;
  if ("w" in patch) row.w = patch.w;
  if ("rot" in patch) row.rot = patch.rot;
  const { error } = await requireClient().from("board_items").update(row).eq("id", id);
  if (error) throw error;
  return true;
}

export async function deleteBoardItem(id) {
  const { error } = await requireClient().from("board_items").delete().eq("id", id);
  if (error) throw error;
  return true;
}
