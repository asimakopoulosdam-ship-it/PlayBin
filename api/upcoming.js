// Save this file as: api/upcoming.js  (inside the "api" folder at your project root)
// Powers the "Upcoming" tab in Discover — announced titles across movies, series,
// and anime, sorted by whichever comes soonest. Same simple approach as search.js /
// trending.js — no caching yet, just a secure proxy with automatic retry.

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

async function upcomingAnime() {
  const res = await fetchWithRetry(`https://api.jikan.moe/v4/seasons/upcoming?limit=15`);
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

export default async function handler(req, res) {
  const [m, s, a] = await Promise.allSettled([
    upcomingMovies(process.env.TMDB_API_KEY),
    upcomingSeries(process.env.TMDB_API_KEY),
    upcomingAnime(),
  ]);
  const movie = m.status === 'fulfilled' ? m.value : [];
  const series = s.status === 'fulfilled' ? s.value : [];
  const anime = a.status === 'fulfilled' ? a.value : [];

  const combined = [...movie, ...series, ...anime].sort((x, y) => {
    if (!x.releaseDate) return 1;
    if (!y.releaseDate) return -1;
    return new Date(x.releaseDate) - new Date(y.releaseDate);
  });

  if (combined.length === 0) {
    return res.status(502).json({ error: 'Upstream sources unavailable right now' });
  }

  return res.status(200).json({ results: combined, cached: false });
}
