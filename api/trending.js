// Save this file as: api/trending.js  (inside the "api" folder at your project root)
// Same idea as api/search.js, but for the "Trending now" list on Discover.
// Cached for 6 hours since trending lists shift day to day, not minute to minute.

import { kv } from '@vercel/kv';

const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const CACHE_SECONDS = 60 * 60 * 6; // 6 hours

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

async function trendingMoviesLive(tmdbKey) {
  const res = await fetchWithRetry(`https://api.themoviedb.org/3/trending/movie/week?api_key=${tmdbKey}&language=en-US`);
  if (!res.ok) throw new Error('tmdb trending movie failed');
  const data = await res.json();
  return (data.results || []).slice(0, 10).map(m => ({
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

async function trendingSeriesLive(tmdbKey) {
  const res = await fetchWithRetry(`https://api.themoviedb.org/3/trending/tv/week?api_key=${tmdbKey}&language=en-US`);
  if (!res.ok) throw new Error('tmdb trending tv failed');
  const data = await res.json();
  return (data.results || [])
    .filter(s => !(s.original_language === 'ja' && (s.genre_ids || []).includes(16)))
    .slice(0, 10).map(s => ({
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

async function trendingAnimeLive() {
  const res = await fetchWithRetry(`https://api.jikan.moe/v4/top/anime?filter=airing&limit=10`);
  if (!res.ok) throw new Error('jikan trending failed');
  const data = await res.json();
  return (data.data || []).map(a => ({
    source: 'jikan', type: 'anime', subtype: a.type || null, externalId: `jikan-${a.mal_id}`,
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
  const cacheKey = 'trending:all';

  try {
    const cached = await kv.get(cacheKey);
    if (cached) return res.status(200).json({ results: cached, cached: true });
  } catch (e) { /* fall through */ }

  const [m, s, a] = await Promise.allSettled([
    trendingMoviesLive(process.env.TMDB_API_KEY),
    trendingSeriesLive(process.env.TMDB_API_KEY),
    trendingAnimeLive(),
  ]);
  const movie = m.status === 'fulfilled' ? m.value : [];
  const series = s.status === 'fulfilled' ? s.value : [];
  const anime = a.status === 'fulfilled' ? a.value : [];

  const combined = [];
  const max = Math.max(movie.length, series.length, anime.length);
  for (let i = 0; i < max; i++) {
    if (movie[i]) combined.push(movie[i]);
    if (series[i]) combined.push(series[i]);
    if (anime[i]) combined.push(anime[i]);
  }

  if (combined.length === 0) {
    return res.status(502).json({ error: 'Upstream sources unavailable right now' });
  }

  try {
    await kv.set(cacheKey, combined, { ex: CACHE_SECONDS });
  } catch (e) { /* not fatal */ }

  return res.status(200).json({ results: combined, cached: false });
}
