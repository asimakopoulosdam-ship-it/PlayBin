// Save this file as: api/trending.js  (inside the "api" folder at your project root)
// Same idea as api/search.js, but for the "Trending now" list on Discover.
// Supports ?page=N so Discover can keep loading more as you scroll, not just a fixed
// first batch.
//
// FIX: each category (movie / series / anime) is now cached SEPARATELY instead of
// caching the combined result as one block. Before, if Jikan (anime) failed even
// once while TMDB succeeded, the empty anime list still got cached together with
// movie+series for 6 hours — so the Anime tab showed nothing until the cache expired,
// even after Jikan came back. Now a failure in one category never affects the others,
// and only the failed category is retried live on the next request.

// Loaded dynamically and defensively — if @vercel/kv isn't installed correctly for any
// reason, the whole function must not crash. Caching just becomes a no-op instead.
async function getKv() {
  try {
    const mod = await import('@vercel/kv');
    return mod.kv;
  } catch (e) { return null; }
}

const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const CACHE_SECONDS = 60 * 60 * 6; // 6 hours
const PER_PAGE = 10; // per type, per page — 30 combined items per page

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

async function trendingMoviesLive(tmdbKey, page) {
  const res = await fetchWithRetry(`https://api.themoviedb.org/3/trending/movie/week?api_key=${tmdbKey}&language=en-US&page=${page}`);
  if (!res.ok) throw new Error('tmdb trending movie failed');
  const data = await res.json();
  return (data.results || []).slice(0, PER_PAGE).map(m => ({
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

async function trendingSeriesLive(tmdbKey, page) {
  const res = await fetchWithRetry(`https://api.themoviedb.org/3/trending/tv/week?api_key=${tmdbKey}&language=en-US&page=${page}`);
  if (!res.ok) throw new Error('tmdb trending tv failed');
  const data = await res.json();
  return (data.results || [])
    .filter(s => !(s.original_language === 'ja' && (s.genre_ids || []).includes(16)))
    .slice(0, PER_PAGE).map(s => ({
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

async function trendingAnimeLive(page) {
  const res = await fetchWithRetry(`https://api.jikan.moe/v4/top/anime?filter=airing&limit=${PER_PAGE}&page=${page}`);
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

// Fetches ONE category, trying the cache first, falling back to a live fetch, and
// caching only that category on success. A failure here returns [] without ever
// touching the cache — so a bad Jikan moment never gets "locked in" for 6 hours,
// and the next request will simply try Jikan live again.
async function getCategory(kv, cacheKey, liveFn) {
  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached) return { list: cached, cached: true };
    } catch (e) { /* fall through to live */ }
  }
  try {
    const list = await liveFn();
    if (kv && list.length > 0) {
      try { await kv.set(cacheKey, list, { ex: CACHE_SECONDS }); } catch (e) { /* not fatal */ }
    }
    return { list, cached: false };
  } catch (e) {
    return { list: [], cached: false, failed: true };
  }
}

export default async function handler(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const kv = await getKv();

  const [movieR, seriesR, animeR] = await Promise.all([
    getCategory(kv, `trending:movie:page:${page}`, () => trendingMoviesLive(process.env.TMDB_API_KEY, page)),
    getCategory(kv, `trending:series:page:${page}`, () => trendingSeriesLive(process.env.TMDB_API_KEY, page)),
    getCategory(kv, `trending:anime:page:${page}`, () => trendingAnimeLive(page)),
  ]);

  const movie = movieR.list;
  const series = seriesR.list;
  const anime = animeR.list;

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

  return res.status(200).json({
    results: combined,
    page,
    cached: { movie: movieR.cached, series: seriesR.cached, anime: animeR.cached },
  });
}
