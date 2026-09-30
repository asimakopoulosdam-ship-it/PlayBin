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

// Anime that hasn't premiered yet at all (announced new seasons/shows). This alone
// used to be the ENTIRE anime side of Upcoming — which is why currently-airing
// anime (by far what most people actually want to know about — "when's the next
// episode of the show I'm already watching") never showed up here at all.
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

// Weekday name (as Jikan gives it, e.g. "Sundays") -> how many days from today
// until that weekday next occurs (0 = today).
function daysUntilWeekday(dayName) {
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const idx = names.findIndex(d => dayName && dayName.toLowerCase().includes(d));
  if (idx === -1) return null;
  const today = new Date().getUTCDay();
  let diff = idx - today;
  if (diff < 0) diff += 7;
  return diff;
}
function nextDateForWeekday(dayName) {
  const days = daysUntilWeekday(dayName);
  if (days == null) return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Anime that IS currently airing, with its next episode's date worked out from the
// weekly broadcast day Jikan reports (there's no per-episode air-date endpoint for
// currently-airing anime the way TMDB has next_episode_to_air for TV — the weekday
// is the best signal available, same approach the app already uses client-side for
// library items in fetchUpcomingForItems).
async function upcomingAnimeAiring() {
  const res = await fetchAnimeSourceFast(`https://api.jikan.moe/v4/seasons/now?limit=25`);
  if (!res.ok) throw new Error('jikan seasons now failed');
  const data = await res.json();
  const list = data.data || [];
  return list
    .filter(a => a.broadcast && a.broadcast.day)
    .map(a => {
      const nextDate = nextDateForWeekday(a.broadcast.day);
      if (!nextDate) return null;
      return {
        source: 'jikan', type: 'anime', subtype: a.type || null, externalId: `jikan-${a.mal_id}`,
        title: a.title_english || a.title,
        altTitles: [a.title, a.title_english, a.title_japanese].filter(Boolean),
        year: (a.aired && a.aired.from) ? a.aired.from.slice(0, 4) : (a.year || null),
        posterUrl: (a.images && a.images.jpg && (a.images.jpg.large_image_url || a.images.jpg.image_url)) || null,
        summary: a.synopsis || '',
        episodes: a.episodes || null, runtimeMinutes: null, statusText: a.status,
        ratingValue: a.score || null, ratingSource: 'MAL', popularityScore: a.members || 0,
        trailerUrl: (a.trailer && (a.trailer.url || (a.trailer.youtube_id ? `https://www.youtube.com/watch?v=${a.trailer.youtube_id}` : null))) || null,
        releaseDate: nextDate,
        extraNote: `New episode: ${formatDateISOish(nextDate)}${a.broadcast.string ? ` (${a.broadcast.string})` : ''}`,
      };
    })
    .filter(Boolean);
}

export default async function handler(req, res) {
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
  // practice, but this keeps the merge safe either way.
  const seen = new Set(notYetAired.map(a => a.externalId));
  const anime = [...notYetAired, ...airing.filter(a => !seen.has(a.externalId))];

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
