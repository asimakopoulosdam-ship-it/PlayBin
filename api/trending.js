// Save this file as: api/trending.js  (inside the "api" folder at your project root)
// Same idea as api/search.js, but for the "Trending now" list on Discover.
// Supports ?page=N so Discover can keep loading more as you scroll, not just a fixed
// first batch.
//
// Each category (movie / series / anime) is cached SEPARATELY, so a failure in one
// never poisons the cache for the others.
//
// ANIME SOURCE ORDER: Jikan → Kitsu → AniList — same reasoning as api/search.js.
// Kitsu's own "trending" endpoint doesn't support paging the same way Jikan's does,
// so it's only used for page 1; deeper pages fall through to AniList if Jikan is down.

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

// Trending Now should mean "already out and popular", not "generating buzz before
// release" — TMDB's own trending endpoint mixes both, so anything with a known
// future release/air date gets filtered out here. Items with no date info at all
// are kept (nothing to compare against).
function isAlreadyReleased(dateStr) {
  if (!dateStr) return true;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return true;
  return d.getTime() <= Date.now();
}

async function trendingMoviesLive(tmdbKey, page) {
  const res = await fetchWithRetry(`https://api.themoviedb.org/3/trending/movie/week?api_key=${tmdbKey}&language=en-US&page=${page}`);
  if (!res.ok) throw new Error('tmdb trending movie failed');
  const data = await res.json();
  return (data.results || [])
    .filter(m => isAlreadyReleased(m.release_date))
    .slice(0, PER_PAGE).map(m => ({
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
    .filter(s => isAlreadyReleased(s.first_air_date))
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

async function trendingAnimeLiveJikan(page) {
  const res = await fetchWithRetry(`https://api.jikan.moe/v4/top/anime?filter=airing&limit=${PER_PAGE}&page=${page}`);
  if (!res.ok) throw new Error('jikan trending failed');
  const data = await res.json();
  const list = data.data || [];
  if (list.length === 0) throw new Error('jikan trending empty');
  return list.map(a => ({
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

// Kitsu's trending endpoint isn't paginated the way Jikan's is — it just returns its
// current top list — so this only ever serves page 1. Deeper pages skip straight to
// AniList if Jikan is unavailable.
async function trendingAnimeLiveKitsu(page) {
  if (page > 1) throw new Error('kitsu trending has no page beyond 1');
  const res = await fetchWithRetry(`https://kitsu.io/api/edge/trending/anime`);
  if (!res.ok) throw new Error('kitsu trending failed');
  const data = await res.json();
  const list = (data.data || []).filter(a => isAlreadyReleased(a.attributes && a.attributes.startDate)).slice(0, PER_PAGE);
  if (list.length === 0) throw new Error('kitsu trending empty');
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

// Used only when Jikan AND Kitsu are both unreachable — AniList's own "currently
// trending anime" list, same shape as everywhere else so the frontend never has to
// know which source it came from.
async function trendingAnimeLiveAniList(page) {
  const query = `query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      media(type: ANIME, sort: TRENDING_DESC, status: RELEASING) {
        id
        title { romaji english native }
        format
        status
        episodes
        averageScore
        popularity
        description(asHtml: false)
        coverImage { large }
        startDate { year }
        trailer { id site }
        nextAiringEpisode { episode airingAt }
      }
    }
  }`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query, variables: { page, perPage: PER_PAGE } }),
  });
  if (!res.ok) throw new Error('anilist trending failed');
  const data = await res.json();
  const list = (data.data && data.data.Page && data.data.Page.media) || [];
  return list.map(a => ({
    source: 'anilist', type: 'anime', subtype: a.format || null, externalId: `anilist-${a.id}`,
    title: a.title.english || a.title.romaji,
    altTitles: [a.title.romaji, a.title.english, a.title.native].filter(Boolean),
    year: (a.startDate && a.startDate.year) || null,
    posterUrl: (a.coverImage && a.coverImage.large) || null,
    summary: (a.description || '').replace(/<[^>]+>/g, ''),
    episodes: a.episodes || null, runtimeMinutes: null, statusText: a.status || null,
    ratingValue: a.averageScore ? Math.round(a.averageScore) / 10 : null, ratingSource: 'AniList',
    popularityScore: a.popularity || 0,
    trailerUrl: (a.trailer && a.trailer.site === 'youtube') ? `https://www.youtube.com/watch?v=${a.trailer.id}` : null,
    extraNote: (a.nextAiringEpisode) ? `Next episode: ${new Date(a.nextAiringEpisode.airingAt * 1000).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}` : null,
  }));
}

async function trendingAnimeLive(page) {
  try {
    return await trendingAnimeLiveJikan(page);
  } catch (e) {
    try {
      return await trendingAnimeLiveKitsu(page);
    } catch (e2) {
      return await trendingAnimeLiveAniList(page);
    }
  }
}

// Fetches ONE category, trying the cache first, falling back to a live fetch, and
// caching only that category on success. A failure returns [] without ever touching
// the cache — so a bad moment for a source never gets "locked in" for 6 hours.
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
