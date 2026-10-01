// Save this file as: api/upcoming.js  (inside the "api" folder at your project root)
// Powers the "Upcoming" tab in Discover — announced titles across movies, series,
// and anime, sorted by whichever comes soonest.
//
// Now cached via Vercel KV, same pattern as search.js/popular.js. Previously this
// hit Jikan live on every single open of the Upcoming tab with no caching at all —
// combined with Jikan's own occasional slowness/rate-limiting, that's exactly what
// made the anime side of this feel inconsistent ("works sometimes, not others").
// Serving a cached result means it only needs to succeed live once per cache
// window, not on every single page load.

async function getKv() {
  try {
    const mod = await import('@vercel/kv');
    return mod.kv;
  } catch (e) { return null; }
}

const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const CACHE_SECONDS = 60 * 60 * 6; // 6 hours — episode/premiere schedules don't shift fast enough to need fresher than this

function formatDateISOish(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) { return dateStr; }
}

async function fetchWithRetry(url, retries = 2, delayMs = 900, options) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (attempt === retries) return res;
    } catch (e) {
      if (attempt === retries) throw e;
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
}

// Anime sources have nowhere else to fall back to here, so a single quick retry is
// enough — matches the fast-fail approach used in search.js/popular.js rather than
// the long TMDB-style retry, since there's no second source to move on to anyway.
async function fetchAnimeSourceFast(url) {
  return fetchWithRetry(url, 1, 300);
}

async function upcomingMovies(tmdbKey) {
  const res = await fetchWithRetry(`https://api.themoviedb.org/3/movie/upcoming?api_key=${tmdbKey}&language=en-US&region=US`);
  if (!res.ok) throw new Error('tmdb upcoming movies failed');
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
    releaseDate: m.release_date || null,
    extraNote: m.release_date ? `Releases: ${formatDateISOish(m.release_date)}` : null,
    needsDetail: true,
  }));
}

async function upcomingSeries(tmdbKey) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const res = await fetchWithRetry(`https://api.themoviedb.org/3/discover/tv?api_key=${tmdbKey}&language=en-US&sort_by=popularity.desc&first_air_date.gte=${todayStr}`);
  if (!res.ok) throw new Error('tmdb upcoming tv failed');
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
      releaseDate: s.first_air_date || null,
      extraNote: s.first_air_date ? `Premieres: ${formatDateISOish(s.first_air_date)}` : null,
      needsDetail: true,
    }));
}

// Anime that hasn't premiered yet at all (announced new seasons/shows).
async function upcomingAnimeNotYetAired() {
  const res = await fetchAnimeSourceFast(`https://api.jikan.moe/v4/seasons/upcoming?limit=15`);
  if (!res.ok) throw new Error('jikan upcoming failed');
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
    releaseDate: (a.aired && a.aired.from) ? a.aired.from.slice(0, 10) : null,
    extraNote: (a.aired && a.aired.from) ? `Premieres: ${formatDateISOish(a.aired.from)}` : null,
  }));
}

// Anime that IS currently airing, with its EXACT next episode date/time — switched
// from Jikan's broadcast-day guesswork (Jikan only reports a weekday like "Sundays",
// so the actual date had to be computed/approximated) to AniList's nextAiringEpisode
// field, which gives a precise Unix timestamp for the next episode directly. More
// accurate, and spreads load away from Jikan, which this whole feature depends on
// heavily elsewhere already.
async function upcomingAnimeAiring() {
  const query = `query { Page(page: 1, perPage: 25) { media(type: ANIME, status: RELEASING, sort: POPULARITY_DESC) { id title { romaji english native } format episodes averageScore popularity description(asHtml: false) coverImage { large } startDate { year } nextAiringEpisode { airingAt episode } trailer { id site } } } }`;
  const res = await fetchWithRetry('https://graphql.anilist.co', 1, 500, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error('anilist airing anime failed');
  const data = await res.json();
  const list = (data.data && data.data.Page && data.data.Page.media) || [];
  return list
    .filter(a => a.nextAiringEpisode && a.nextAiringEpisode.airingAt)
    .map(a => {
      const airingDate = new Date(a.nextAiringEpisode.airingAt * 1000).toISOString().slice(0, 10);
      return {
        source: 'anilist', type: 'anime', subtype: a.format || null, externalId: `anilist-${a.id}`,
        title: a.title.english || a.title.romaji,
        altTitles: [a.title.romaji, a.title.english, a.title.native].filter(Boolean),
        year: (a.startDate && a.startDate.year) || null,
        posterUrl: (a.coverImage && a.coverImage.large) || null,
        summary: (a.description || '').replace(/<[^>]+>/g, ''),
        episodes: a.episodes || null, runtimeMinutes: null, statusText: 'Currently Airing',
        ratingValue: a.averageScore ? Math.round(a.averageScore) / 10 : null, ratingSource: 'AniList',
        popularityScore: a.popularity || 0,
        trailerUrl: (a.trailer && a.trailer.site === 'youtube') ? `https://www.youtube.com/watch?v=${a.trailer.id}` : null,
        releaseDate: airingDate,
        extraNote: `New episode: ${formatDateISOish(airingDate)} (Ep ${a.nextAiringEpisode.episode})`,
      };
    });
}

async function buildUpcoming() {
  const [m, s, aUpcoming, aAiring] = await Promise.allSettled([
    upcomingMovies(process.env.TMDB_API_KEY),
    upcomingSeries(process.env.TMDB_API_KEY),
    upcomingAnimeNotYetAired(),
    upcomingAnimeAiring(),
  ]);
  const movie = m.status === 'fulfilled' ? m.value : [];
  const series = s.status === 'fulfilled' ? s.value : [];
  const notYetAired = aUpcoming.status === 'fulfilled' ? aUpcoming.value : [];
  const airing = aAiring.status === 'fulfilled' ? aAiring.value : [];

  // The same anime could in principle show up in both anime lists — keep the
  // not-yet-aired entry (its premiere date) over a duplicate airing entry if that
  // ever happens, since a show can't be both mid-broadcast and unaired at once in
  // practice, but this keeps the merge safe either way. Matched by title since the
  // two lists come from different sources (Jikan ids vs AniList ids).
  const seenTitles = new Set(notYetAired.map(a => a.title.toLowerCase()));
  const anime = [...notYetAired, ...airing.filter(a => !seenTitles.has(a.title.toLowerCase()))];

  const combined = [...movie, ...series, ...anime].sort((x, y) => {
    if (!x.releaseDate) return 1;
    if (!y.releaseDate) return -1;
    return new Date(x.releaseDate) - new Date(y.releaseDate);
  });

  return combined;
}

export default async function handler(req, res) {
  const cacheKey = 'upcoming:v2';
  const kv = await getKv();

  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached) return res.status(200).json({ results: cached, cached: true });
    } catch (e) { /* KV unreachable — fall through to a live build */ }
  }

  const combined = await buildUpcoming();

  if (combined.length === 0) {
    return res.status(502).json({ error: 'Upstream sources unavailable right now' });
  }

  if (kv) {
    try { await kv.set(cacheKey, combined, { ex: CACHE_SECONDS }); } catch (e) { /* not fatal */ }
  }

  return res.status(200).json({ results: combined, cached: false });
}
