// Save this file as: api/search.js  (inside the "api" folder at your project root)
//
// This is a Vercel Serverless Function. The browser calls THIS endpoint instead of
// calling TMDB/Jikan directly. Flow:
//   1. Check Vercel KV (the cache) for this exact search first — if found, return
//      instantly, no dependency on TMDB/MyAnimeList being up at all.
//   2. If not cached, fetch live from the real source, map it into the shape the
//      app expects, cache it for next time, then return it.
//
// ANIME SOURCE ORDER: Jikan (MyAnimeList) → Kitsu → AniList.
// Jikan has the richest data when it's up. Kitsu is tried next because — unlike
// AniList — it has real, structured per-episode data (titles, air dates), so a
// Jikan outage doesn't mean losing real episode titles, just falling back to a
// slightly different source for them. AniList is the last resort: reliable uptime,
// but its episode data is patchy (crowd-sourced streaming links), so it's better
// used only when nothing else is available.
//
// Setup on Vercel (one-time):
//   1. In your Vercel project → Storage tab → Create Database → KV (this auto-adds
//      the KV_* environment variables and installs @vercel/kv for you).
//   2. Settings → Environment Variables → add TMDB_API_KEY (your TMDB key).
//   3. Deploy. That's it — no code changes needed beyond this file.

// Loaded dynamically and defensively — if @vercel/kv isn't installed correctly for any
// reason, the whole function must not crash. Caching just becomes a no-op instead.
async function getKv() {
  try {
    const mod = await import('@vercel/kv');
    return mod.kv;
  } catch (e) { return null; }
}

const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const CACHE_SECONDS = 60 * 60 * 24 * 7; // 7 days — search results don't change often

function parseJikanDuration(text) {
  if (!text) return null;
  const hrMatch = text.match(/(\d+)\s*hr/);
  const minMatch = text.match(/(\d+)\s*min/);
  let mins = 0;
  if (hrMatch) mins += parseInt(hrMatch[1], 10) * 60;
  if (minMatch) mins += parseInt(minMatch[1], 10);
  return mins || null;
}

function formatDateISOish(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) { return dateStr; }
}

// Retries once after a short pause — smooths over one-off network/rate-limit blips
// from the upstream source (this is exactly the kind of thing that made "Bleach"
// briefly fail earlier).
async function fetchWithRetry(url, retries = 2, delayMs = 900) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if (attempt === retries) return res;
    } catch (e) {
      if (attempt === retries) throw e;
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
}

async function searchMovieLive(q, tmdbKey) {
  const res = await fetchWithRetry(`https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${encodeURIComponent(q)}&language=en-US`);
  if (!res.ok) throw new Error('tmdb movie search failed');
  const data = await res.json();
  return (data.results || []).slice(0, 15).map(m => ({
    source: 'tmdb', type: 'movie', externalId: `tmdb-${m.id}`, tmdbId: m.id,
    title: m.title,
    year: m.release_date ? m.release_date.slice(0, 4) : null,
    posterUrl: m.poster_path ? `${TMDB_IMG}${m.poster_path}` : null,
    summary: m.overview || '',
    episodes: null, runtimeMinutes: null, statusText: null,
    ratingValue: m.vote_average || null, ratingSource: 'TMDB', popularityScore: m.popularity || 0,
    trailerUrl: null,
    extraNote: m.release_date ? `Released: ${formatDateISOish(m.release_date)}` : null,
    needsDetail: true,
  }));
}

async function searchSeriesLive(q, tmdbKey) {
  const res = await fetchWithRetry(`https://api.themoviedb.org/3/search/tv?api_key=${tmdbKey}&query=${encodeURIComponent(q)}&language=en-US`);
  if (!res.ok) throw new Error('tmdb tv search failed');
  const data = await res.json();
  return (data.results || [])
    .filter(s => !(s.original_language === 'ja' && (s.genre_ids || []).includes(16))) // anime belongs to Jikan, not here
    .slice(0, 15).map(s => ({
      source: 'tmdb', type: 'series', externalId: `tmdbtv-${s.id}`, tmdbId: s.id,
      title: s.name,
      year: s.first_air_date ? s.first_air_date.slice(0, 4) : null,
      posterUrl: s.poster_path ? `${TMDB_IMG}${s.poster_path}` : null,
      summary: s.overview || '',
      episodes: null, runtimeMinutes: null, statusText: null,
      ratingValue: s.vote_average || null, ratingSource: 'TMDB', popularityScore: s.popularity || 0,
      trailerUrl: null,
      extraNote: s.first_air_date ? `Premiere: ${formatDateISOish(s.first_air_date)}` : null,
      needsDetail: true,
    }));
}

async function searchAnimeJikan(q) {
  const res = await fetchWithRetry(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=15&sfw=true`);
  if (!res.ok) throw new Error('jikan search failed');
  const data = await res.json();
  const list = data.data || [];
  if (list.length === 0) throw new Error('jikan search empty');
  return list.map(a => ({
    source: 'jikan', type: 'anime', subtype: a.type || null, externalId: `jikan-${a.mal_id}`,
    title: a.title_english || a.title,
    altTitles: [a.title, a.title_english, a.title_japanese].filter(Boolean),
    year: (a.aired && a.aired.from) ? a.aired.from.slice(0, 4) : (a.year || null),
    posterUrl: (a.images && a.images.jpg && (a.images.jpg.large_image_url || a.images.jpg.image_url)) || null,
    summary: a.synopsis || '',
    episodes: a.episodes || null, runtimeMinutes: parseJikanDuration(a.duration), statusText: a.status,
    ratingValue: a.score || null, ratingSource: 'MAL', popularityScore: a.members || 0,
    trailerUrl: (a.trailer && (a.trailer.url || (a.trailer.youtube_id ? `https://www.youtube.com/watch?v=${a.trailer.youtube_id}` : null))) || null,
    extraNote: (a.broadcast && a.broadcast.string) ? `Airing: ${a.broadcast.string}` : null,
  }));
}

// Kitsu — tried when Jikan itself is unreachable. Unlike AniList, Kitsu has a real,
// structured episode list (see api/[id]/episodes in App.tsx), so falling back here
// keeps actual episode titles working instead of jumping straight to generic
// "Episode 1, 2, 3..." placeholders.
async function searchAnimeKitsu(q) {
  const res = await fetchWithRetry(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(q)}&page[limit]=15`);
  if (!res.ok) throw new Error('kitsu search failed');
  const data = await res.json();
  const list = data.data || [];
  if (list.length === 0) throw new Error('kitsu search empty');
  return list.map(a => {
    const attrs = a.attributes || {};
    const titles = attrs.titles || {};
    const poster = attrs.posterImage || {};
    return {
      source: 'kitsu', type: 'anime',
      subtype: attrs.subtype ? attrs.subtype.toUpperCase() : null,
      externalId: `kitsu-${a.id}`,
      title: attrs.canonicalTitle || titles.en || titles.en_jp || 'Untitled',
      altTitles: [attrs.canonicalTitle, titles.en, titles.en_jp, titles.ja_jp].filter(Boolean),
      year: attrs.startDate ? attrs.startDate.slice(0, 4) : null,
      posterUrl: poster.large || poster.original || poster.medium || null,
      summary: attrs.synopsis || '',
      episodes: attrs.episodeCount || null, runtimeMinutes: attrs.episodeLength || null, statusText: attrs.status || null,
      ratingValue: attrs.averageRating ? Math.round(attrs.averageRating) / 10 : null, ratingSource: 'Kitsu',
      popularityScore: attrs.userCount || 0,
      trailerUrl: attrs.youtubeVideoId ? `https://www.youtube.com/watch?v=${attrs.youtubeVideoId}` : null,
      extraNote: null,
    };
  });
}

// AniList — last resort. Reliable uptime, but its episode-level data is limited
// (crowd-sourced streaming links, not a real episode guide), so it's only used when
// both Jikan and Kitsu can't answer.
async function searchAnimeAniListFallback(q) {
  const query = `query ($search: String) { Page(page: 1, perPage: 15) { media(search: $search, type: ANIME) { id title { romaji english native } format status episodes duration averageScore popularity description(asHtml: false) coverImage { large } startDate { year } trailer { id site } } } }`;
  const realRes = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query, variables: { search: q } }),
  });
  if (!realRes.ok) throw new Error('anilist search failed');
  const data = await realRes.json();
  const list = (data.data && data.data.Page && data.data.Page.media) || [];
  return list.map(a => ({
    source: 'anilist', type: 'anime', subtype: a.format || null, externalId: `anilist-${a.id}`,
    title: a.title.english || a.title.romaji,
    altTitles: [a.title.romaji, a.title.english, a.title.native].filter(Boolean),
    year: (a.startDate && a.startDate.year) || null,
    posterUrl: (a.coverImage && a.coverImage.large) || null,
    summary: (a.description || '').replace(/<[^>]+>/g, ''),
    episodes: a.episodes || null, runtimeMinutes: a.duration || null, statusText: a.status || null,
    ratingValue: a.averageScore ? Math.round(a.averageScore) / 10 : null, ratingSource: 'AniList',
    popularityScore: a.popularity || 0,
    trailerUrl: (a.trailer && a.trailer.site === 'youtube') ? `https://www.youtube.com/watch?v=${a.trailer.id}` : null,
    extraNote: null,
  }));
}

async function searchAnimeLive(q) {
  try {
    return await searchAnimeJikan(q);
  } catch (e) {
    try {
      return await searchAnimeKitsu(q);
    } catch (e2) {
      return await searchAnimeAniListFallback(q);
    }
  }
}

export default async function handler(req, res) {
  const { type, q } = req.query;
  if (!type || !q || !['movie', 'series', 'anime'].includes(type)) {
    return res.status(400).json({ error: 'Missing or invalid type/q' });
  }

  const cacheKey = `search:${type}:${q.toLowerCase().trim()}`;
  const kv = await getKv();

  // 1. Try the cache first — this is what keeps search working even if TMDB or
  //    MyAnimeList is down, as long as *someone* has searched this before.
  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached) {
        return res.status(200).json({ results: cached, cached: true });
      }
    } catch (e) { /* KV unreachable — fall through to a live fetch */ }
  }

  // 2. Not cached (or first time anyone's searched this) — fetch live.
  let results;
  try {
    if (type === 'movie') results = await searchMovieLive(q, process.env.TMDB_API_KEY);
    else if (type === 'series') results = await searchSeriesLive(q, process.env.TMDB_API_KEY);
    else results = await searchAnimeLive(q);
  } catch (e) {
    return res.status(502).json({ error: 'Upstream source unavailable right now', message: e.message });
  }

  // 3. Cache it for next time (best-effort — a caching failure shouldn't break the response).
  if (kv) {
    try {
      await kv.set(cacheKey, results, { ex: CACHE_SECONDS });
    } catch (e) { /* not fatal */ }
  }

  return res.status(200).json({ results, cached: false });
}
