// Save this file as: api/popular.js  (inside the "api" folder at your project root)
//
// Powers the "Zapping" swipe feature — unlike Trending Now (this week's hot titles),
// this returns overall POPULAR titles regardless of when they came out, so classics
// show up too, not just what's currently buzzing. Same fallback + caching approach
// as api/trending.js.
//
// Query params:
//   ?type=movie | series | anime | mix   (mix = interleaved combination, default)
//   ?page=N

async function getKv() {
  try {
    const mod = await import('@vercel/kv');
    return mod.kv;
  } catch (e) { return null; }
}

const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const CACHE_SECONDS = 60 * 60 * 24; // 24 hours — overall popularity shifts slowly
const PER_PAGE = 10;

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

async function popularMoviesLive(tmdbKey, page) {
  const res = await fetchWithRetry(`https://api.themoviedb.org/3/movie/popular?api_key=${tmdbKey}&language=en-US&page=${page}`);
  if (!res.ok) throw new Error('tmdb popular movie failed');
  const data = await res.json();
  return (data.results || []).slice(0, PER_PAGE).map(m => ({
    source: 'tmdb', type: 'movie', externalId: `tmdb-${m.id}`, tmdbId: m.id,
    title: m.title,
    year: m.release_date ? m.release_date.slice(0, 4) : null,
    posterUrl: m.poster_path ? `${TMDB_IMG}${m.poster_path}` : null,
    summary: m.overview || '',
    episodes: null, runtimeMinutes: null, statusText: null,
    ratingValue: m.vote_average || null, ratingSource: 'TMDB', popularityScore: m.popularity || 0,
    trailerUrl: null, extraNote: null, needsDetail: true,
  }));
}

async function popularSeriesLive(tmdbKey, page) {
  const res = await fetchWithRetry(`https://api.themoviedb.org/3/tv/popular?api_key=${tmdbKey}&language=en-US&page=${page}`);
  if (!res.ok) throw new Error('tmdb popular tv failed');
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
      trailerUrl: null, extraNote: null, needsDetail: true,
    }));
}

async function popularAnimeLiveJikan(page) {
  // bypopularity ranks by MAL member/popularity count, not score — matches "popular"
  // rather than "critically top-rated", and isn't restricted to currently-airing.
  const res = await fetchWithRetry(`https://api.jikan.moe/v4/top/anime?filter=bypopularity&limit=${PER_PAGE}&page=${page}`);
  if (!res.ok) throw new Error('jikan popular failed');
  const data = await res.json();
  const list = data.data || [];
  if (list.length === 0) throw new Error('jikan popular empty');
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
    extraNote: null,
  }));
}

async function popularAnimeLiveKitsu(page) {
  const res = await fetchWithRetry(`https://kitsu.io/api/edge/anime?sort=-userCount&page[limit]=${PER_PAGE}&page[offset]=${(page - 1) * PER_PAGE}`);
  if (!res.ok) throw new Error('kitsu popular failed');
  const data = await res.json();
  const list = data.data || [];
  if (list.length === 0) throw new Error('kitsu popular empty');
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

async function popularAnimeLiveAniList(page) {
  const query = `query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      media(type: ANIME, sort: POPULARITY_DESC) {
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
      }
    }
  }`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query, variables: { page, perPage: PER_PAGE } }),
  });
  if (!res.ok) throw new Error('anilist popular failed');
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
    extraNote: null,
  }));
}

async function popularAnimeLive(page) {
  try { return await popularAnimeLiveJikan(page); }
  catch (e) {
    try { return await popularAnimeLiveKitsu(page); }
    catch (e2) { return await popularAnimeLiveAniList(page); }
  }
}

async function getCategory(kv, cacheKey, liveFn) {
  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached) return cached;
    } catch (e) { /* fall through to live */ }
  }
  try {
    const list = await liveFn();
    if (kv && list.length > 0) {
      try { await kv.set(cacheKey, list, { ex: CACHE_SECONDS }); } catch (e) { /* not fatal */ }
    }
    return list;
  } catch (e) { return []; }
}

export default async function handler(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const type = ['movie', 'series', 'anime', 'mix'].includes(req.query.type) ? req.query.type : 'mix';
  const kv = await getKv();
  const tmdbKey = process.env.TMDB_API_KEY;

  if (type === 'movie') {
    const list = await getCategory(kv, `popular:movie:page:${page}`, () => popularMoviesLive(tmdbKey, page));
    return res.status(200).json({ results: list, page, type });
  }
  if (type === 'series') {
    const list = await getCategory(kv, `popular:series:page:${page}`, () => popularSeriesLive(tmdbKey, page));
    return res.status(200).json({ results: list, page, type });
  }
  if (type === 'anime') {
    const list = await getCategory(kv, `popular:anime:page:${page}`, () => popularAnimeLive(page));
    return res.status(200).json({ results: list, page, type });
  }

  // mix: a bit of all three, interleaved
  const [movie, series, anime] = await Promise.all([
    getCategory(kv, `popular:movie:page:${page}`, () => popularMoviesLive(tmdbKey, page)),
    getCategory(kv, `popular:series:page:${page}`, () => popularSeriesLive(tmdbKey, page)),
    getCategory(kv, `popular:anime:page:${page}`, () => popularAnimeLive(page)),
  ]);
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
  return res.status(200).json({ results: combined, page, type });
}
