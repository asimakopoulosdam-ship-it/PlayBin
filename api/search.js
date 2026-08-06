// Save this file as: api/search.js  (inside an "api" folder at your project root)
//
// Simple version for now — no caching yet, just a secure server-side proxy to
// TMDB/Jikan with automatic retry. We can add the Vercel KV caching layer as a
// separate step later once this baseline is confirmed working.

const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

function formatDateISOish(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) { return dateStr; }
}

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
    .filter(s => !(s.original_language === 'ja' && (s.genre_ids || []).includes(16)))
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

async function searchAnimeLive(q) {
  const res = await fetchWithRetry(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=15&sfw=true`);
  if (!res.ok) throw new Error('jikan search failed');
  const data = await res.json();
  return (data.data || []).map(a => ({
    source: 'jikan', type: 'anime', externalId: `jikan-${a.mal_id}`,
    title: a.title_english || a.title,
    altTitles: [a.title, a.title_english, a.title_japanese].filter(Boolean),
    year: (a.aired && a.aired.from) ? a.aired.from.slice(0, 4) : (a.year || null),
    posterUrl: (a.images && a.images.jpg && (a.images.jpg.large_image_url || a.images.jpg.image_url)) || null,
    summary: a.synopsis || '',
    episodes: a.episodes || null, runtimeMinutes: null, statusText: a.status,
    ratingValue: a.score || null, ratingSource: 'MAL', popularityScore: a.members || 0,
    trailerUrl: (a.trailer && (a.trailer.url || (a.trailer.youtube_id ? `https://www.youtube.com/watch?v=${a.trailer.youtube_id}` : null))) || null,
    extraNote: (a.broadcast && a.broadcast.string) ? `Airing: ${a.broadcast.string}` : null,
  }));
}

export default async function handler(req, res) {
  const { type, q } = req.query;
  if (!type || !q || !['movie', 'series', 'anime'].includes(type)) {
    return res.status(400).json({ error: 'Missing or invalid type/q' });
  }

  let results;
  try {
    if (type === 'movie') results = await searchMovieLive(q, process.env.TMDB_API_KEY);
    else if (type === 'series') results = await searchSeriesLive(q, process.env.TMDB_API_KEY);
    else results = await searchAnimeLive(q);
  } catch (e) {
    return res.status(502).json({ error: 'Upstream source unavailable right now', message: e.message });
  }

  return res.status(200).json({ results, cached: false });
}
