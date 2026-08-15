// Lightweight GIPHY search. Uses the public browser API key (safe to expose).
// Get a free key at https://developers.giphy.com -> Create App -> API key,
// then set VITE_GIPHY_API_KEY in .env.local (local) and in Vercel (production).

const KEY = import.meta.env.VITE_GIPHY_API_KEY;

export const giphyConfigured = Boolean(KEY);

// Returns [{ id, previewUrl, fullUrl, title, width, height }]
export async function searchGifs(query, limit = 18) {
  if (!KEY) throw new Error("GIPHY is not configured");
  const endpoint = query.trim()
    ? "https://api.giphy.com/v1/gifs/search"
    : "https://api.giphy.com/v1/gifs/trending";
  const params = new URLSearchParams({
    api_key: KEY,
    limit: String(limit),
    rating: "pg-13",
  });
  if (query.trim()) params.set("q", query.trim());

  const res = await fetch(`${endpoint}?${params.toString()}`);
  if (!res.ok) throw new Error(`GIPHY request failed (${res.status})`);
  const json = await res.json();
  return (json.data || []).map((g) => ({
    id: g.id,
    title: g.title || "GIF",
    // small looping preview for the picker grid
    previewUrl: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url,
    // the version we actually pin (kept modest to stay small)
    fullUrl: g.images?.fixed_width?.url || g.images?.original?.url,
    width: Number(g.images?.fixed_width?.width) || 200,
    height: Number(g.images?.fixed_width?.height) || 200,
  }));
}
