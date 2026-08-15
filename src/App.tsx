import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Tv2, Clapperboard, Sparkles, LayoutList, Search, CircleUserRound,
  Plus, X, Star, Clock3, CheckCircle2, PlayCircle, ArrowLeft, Trash2,
  ListChecks, Ticket, Flame, Loader2, Pencil, Check, PlayCircle as PlayIcon,
  CalendarDays, Film, Settings as SettingsIcon, ChevronDown, Zap, Heart
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

/* ---------------------------------- constants ---------------------------------- */

const APP_NAME = 'Playbin';

const TYPE_META = {
  series: { label: 'Series', singular: 'Series', color: '#4FA8FF', icon: Tv2, defaultMinutes: 45 },
  movie:  { label: 'Movies', singular: 'Movie', color: '#E8A33D', icon: Clapperboard, defaultMinutes: 110 },
  anime:  { label: 'Anime', singular: 'Anime', color: '#F9A8D4', icon: Sparkles, defaultMinutes: 24 },
};

const TYPE_ORDER = ['movie', 'series', 'anime'];

const STATUS_META = {
  planned:   { label: 'Want to Watch', short: 'Planned', icon: ListChecks, color: '#8892B0' },
  watching:  { label: 'Watching', short: 'Watching', icon: PlayCircle, color: '#F5A623' },
  completed: { label: 'Watched', short: 'Watched', icon: CheckCircle2, color: '#7ED957' },
};

const EMOJI_SETS = {
  series: ['📺', '🕵️', '👑', '🚀', '🏙️', '🧟'],
  movie:  ['🎬', '🍿', '🎭', '🔫', '💔', '🌌'],
  anime:  ['⛩️', '⚔️', '🐉', '🌸', '👻', '🎌'],
};

const ITEMS_KEY = 'wl-items-v1';
const PROFILE_KEY = 'wl-profile-v1';
const SEARCH_HISTORY_KEY = 'wl-search-history-v1';
const APPEARANCE_MODE_KEY = 'wl-appearance-mode-v1';
const APPEARANCE_MODES = [
  { key: 'normal', label: 'Normal' },
  { key: 'dark', label: 'Dark mode' },
  { key: 'white', label: 'White mode' },
  { key: 'neon', label: 'Neon' },
];

// Paste your own free TMDB API key here (themoviedb.org → Settings → API).
// This is a client-side app, so this key will be visible in the shipped code —
// that's normal and expected for TMDB's client-side key model, not a mistake.
const TMDB_API_KEY = '2b62dfba88093af4ceb731b0c218f01c';

// Paste the email you want bug reports sent to. No server needed — this just opens
// the user's own email app with the message pre-filled.
const SUPPORT_EMAIL = 'playbinreport@yahoo.com';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

// Paste your Supabase project URL and anon/public key (Settings → API in your
// Supabase dashboard). The anon key is meant to be public/client-side — real
// protection comes from the Row Level Security policies on the tables, not from
// hiding this key.
const SUPABASE_URL = 'PASTE_YOUR_SUPABASE_URL_HERE';
const SUPABASE_ANON_KEY = 'PASTE_YOUR_SUPABASE_ANON_KEY_HERE';
// If Supabase hasn't been set up yet (still the placeholder values), the app runs in
// local-only mode instead of crashing — accounts/cloud sync just won't be available
// until real keys are pasted in above.
const SUPABASE_CONFIGURED = SUPABASE_URL && SUPABASE_URL !== 'PASTE_YOUR_SUPABASE_URL_HERE'
  && SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== 'PASTE_YOUR_SUPABASE_ANON_KEY_HERE';
let supabaseClient = null;
if (SUPABASE_CONFIGURED) {
  try { supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY); }
  catch (e) { console.error('Supabase failed to initialize', e); }
}

/* ---------------------------------- generic helpers ---------------------------------- */

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

// Any modal/bottom-sheet calls this on mount. Without it, a touch that starts on the
// sheet can end up scrolling the page behind it too (iOS Safari's default behavior),
// which is exactly the "can't scroll, or the wrong thing scrolls" feeling. Deliberately
// simple (no position:fixed trick) — that approach is known to sometimes fight with
// iOS Safari's handling of nested scrollable elements, which is worse than this.
function useBodyScrollLock() {
  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    const prevBody = body.style.overflow;
    const prevHtml = html.style.overflow;
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    return () => {
      body.style.overflow = prevBody;
      html.style.overflow = prevHtml;
    };
  }, []);
}

function computeMinutes(item) {
  if (item.type === 'movie') {
    return item.status === 'completed' ? (Number(item.movieMinutes) || TYPE_META.movie.defaultMinutes) : 0;
  }
  const eps = item.externalId ? (item.watchedEpisodeIds || []).length : (Number(item.episodesWatched) || 0);
  const epLen = Number(item.episodeMinutes) || TYPE_META[item.type].defaultMinutes;
  return eps * epLen;
}

function formatWatchTime(totalMinutes) {
  let remaining = Math.max(0, Math.floor(totalMinutes));
  const years = Math.floor(remaining / (60 * 24 * 365));
  remaining -= years * 60 * 24 * 365;
  const months = Math.floor(remaining / (60 * 24 * 30));
  remaining -= months * 60 * 24 * 30;
  const days = Math.floor(remaining / (60 * 24));
  remaining -= days * 60 * 24;
  const hours = Math.floor(remaining / 60);
  return { years, months, days, hours, totalHours: Math.round((totalMinutes / 60) * 10) / 10 };
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatDateGr(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) { return iso; }
}

/* ---------------------------------- storage ---------------------------------- */

// Persistence uses the browser's own localStorage — works everywhere (CodePen, a real
// hosted app, StackBlitz), unlike Claude's window.storage which only exists inside
// Claude.ai itself. This is what the real, standalone app should ship with.
function storageGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.error('Storage failed', key, e); }
}

async function loadItems() { return storageGet(ITEMS_KEY, []); }
async function saveItems(items) { storageSet(ITEMS_KEY, items); }
async function loadProfile() { return storageGet(PROFILE_KEY, { name: '' }); }
async function saveProfile(profile) { storageSet(PROFILE_KEY, profile); }
async function loadSearchHistory() { return storageGet(SEARCH_HISTORY_KEY, []); }
async function saveSearchHistory(list) { storageSet(SEARCH_HISTORY_KEY, list); }

/* ---------------------------------- account (Supabase) ---------------------------------- */
/* Signed out: everything above (localStorage) keeps working exactly as before — the app
   never requires an account. Signed in: the same data lives in Supabase instead, synced
   across every device the person signs into. */

async function signInWithGoogle() {
  if (!supabaseClient) { alert("Accounts aren't set up yet — this app still works fully without one."); return; }
  await supabaseClient.auth.signInWithOAuth({ provider: 'google' });
}
async function signOutCloud() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
}

async function loadItemsCloud(userId) {
  const { data, error } = await supabaseClient.from('items').select('data').eq('user_id', userId);
  if (error || !data) return [];
  return data.map(row => row.data);
}
async function saveItemsCloud(userId, items) {
  const now = new Date().toISOString();
  try {
    if (items.length > 0) {
      const rows = items.map(it => ({ id: it.id, user_id: userId, data: it, updated_at: now }));
      await supabaseClient.from('items').upsert(rows);
    }
    // Clean up anything removed locally (e.g. after a delete) so the cloud copy stays in sync.
    const { data: existing } = await supabaseClient.from('items').select('id').eq('user_id', userId);
    const localIds = new Set(items.map(it => it.id));
    const toDelete = (existing || []).filter(r => !localIds.has(r.id)).map(r => r.id);
    if (toDelete.length > 0) {
      await supabaseClient.from('items').delete().in('id', toDelete);
    }
  } catch (e) { console.error('Cloud save failed', e); }
}
async function loadProfileCloud(userId) {
  const { data } = await supabaseClient.from('profiles').select('name').eq('user_id', userId).maybeSingle();
  return { name: (data && data.name) || '' };
}
async function saveProfileCloud(userId, profile) {
  try {
    await supabaseClient.from('profiles').upsert({ user_id: userId, name: profile.name || '', updated_at: new Date().toISOString() });
  } catch (e) { console.error('Cloud profile save failed', e); }
}

/* ---------------------------------- live database search ---------------------------------- */
/* Zero dependency on Claude / Anthropic: these call the real, free, keyless public APIs
   directly from the browser. This is exactly what will ship in the real standalone app.
   Series -> TMDB (TV)   Anime -> Jikan/MyAnimeList   Movies -> TMDB
   All routed through /api/search and /api/trending (your own Vercel Function + KV
   cache) so a repeat search stays fast and available even if TMDB/MyAnimeList hiccups. */

async function searchViaProxy(type, q) {
  const res = await fetch(`/api/search?type=${type}&q=${encodeURIComponent(q)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `search-${type}-failed`);
  }
  const data = await res.json();
  return data.results || [];
}

async function searchSeriesDB(q) { return searchViaProxy('series', q); }
async function searchAnimeDB(q) {
  const raw = await searchViaProxy('anime', q);
  // Collapse "Re:Zero Season 1 / Season 2 / Season 3" style duplicates into one
  // entry before anything else in the app ever sees this list — see
  // mergeAnimeSeasonEntries() for why this lives here instead of further downstream.
  if (raw.length <= 1) return raw;
  try { return await mergeAnimeSeasonEntries(raw); } catch (e) { return raw; }
}
async function searchMovieDB(q) { return searchViaProxy('movie', q); }

// Retries once after a short pause — used by the remaining direct-to-source calls
// below (detail/season/episode lookups aren't cached server-side yet).
async function fetchWithRetry(url, retries = 2, delayMs = 1200) {
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

async function fetchSeriesDetail(tmdbId) {
  const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US&append_to_response=videos`);
  if (!res.ok) throw new Error('tmdb-tv detail');
  const s = await res.json();
  const trailer = (s.videos && s.videos.results || []).find(v => v.site === 'YouTube' && v.type === 'Trailer')
    || (s.videos && s.videos.results || [])[0];
  const nextEp = s.next_episode_to_air;
  return {
    episodes: s.number_of_episodes || null,
    runtimeMinutes: (s.episode_run_time && s.episode_run_time[0]) || null,
    statusText: (s.genres || []).map(g => g.name).slice(0, 2).join(', ') || null,
    trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    extraNote: nextEp ? `Next episode: ${formatDateGr(nextEp.air_date)}` : (s.status === 'Ended' ? 'This series has ended' : null),
  };
}

// Trending Now — what's popular this week, shown when the search box is empty.
// Also routed through the cache (api/trending.js), refreshed every ~6 hours server-side.
// Supports paging so Discover can keep loading more as you scroll down.
async function fetchTrendingAll(page = 1) {
  const res = await fetch(`/api/trending?page=${page}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || [];
}

// "Zapping" — overall popular titles (not this week's trending), type-scoped to
// whatever filter tab is active, or a mix of all three when no filter is applied.
async function fetchPopular(type = 'mix', page = 1) {
  const res = await fetch(`/api/popular?type=${type}&page=${page}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || [];
}


// "You might also like" — same idea across sources, mapped into the same shape as
// search results so the existing add-to-library flow works on them unchanged.
async function fetchSimilarTitles(item) {
  if (!item.externalId) return [];
  const dbId = item.externalId.split('-').slice(1).join('-');
  try {
    if (item.type === 'movie') {
      const res = await fetch(`https://api.themoviedb.org/3/movie/${dbId}/similar?api_key=${TMDB_API_KEY}&language=en-US`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.results || []).slice(0, 8).map(m => ({
        type: 'movie', externalId: `tmdb-${m.id}`, title: m.title,
        posterUrl: m.poster_path ? `${TMDB_IMG}${m.poster_path}` : null,
        year: m.release_date ? m.release_date.slice(0, 4) : null,
        summary: m.overview || '', ratingValue: m.vote_average || null, ratingSource: 'TMDB',
        popularityScore: m.popularity || 0, episodes: null, runtimeMinutes: null, statusText: null, trailerUrl: null, needsDetail: true,
      }));
    }
    if (item.type === 'series') {
      const res = await fetch(`https://api.themoviedb.org/3/tv/${dbId}/similar?api_key=${TMDB_API_KEY}&language=en-US`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.results || [])
        .filter(s => !(s.original_language === 'ja' && (s.genre_ids || []).includes(16)))
        .slice(0, 8).map(s => ({
          type: 'series', externalId: `tmdbtv-${s.id}`, title: s.name,
          posterUrl: s.poster_path ? `${TMDB_IMG}${s.poster_path}` : null,
          year: s.first_air_date ? s.first_air_date.slice(0, 4) : null,
          summary: s.overview || '', ratingValue: s.vote_average || null, ratingSource: 'TMDB',
          popularityScore: s.popularity || 0, episodes: null, runtimeMinutes: null, statusText: null, trailerUrl: null, needsDetail: true,
        }));
    }
    if (item.type === 'anime') {
      // dbId here is only a real Jikan/MAL id for items that came from Jikan in the
      // first place. For AniList-sourced items (externalId "anilist-XXXX", used when
      // Jikan was down at search time), that same number means something completely
      // different on MAL — querying Jikan's recommendations with it would silently
      // return recommendations for the WRONG anime instead of just failing. Skip it.
      if (!item.externalId.startsWith('jikan-')) return [];
      const res = await fetch(`https://api.jikan.moe/v4/anime/${dbId}/recommendations`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || []).slice(0, 8).map(r => ({
        type: 'anime', externalId: `jikan-${r.entry.mal_id}`, title: r.entry.title,
        posterUrl: (r.entry.images && r.entry.images.jpg && r.entry.images.jpg.image_url) || null,
        year: null, summary: '', ratingValue: null, ratingSource: 'MAL', popularityScore: 0,
        episodes: null, runtimeMinutes: null, statusText: null, trailerUrl: null,
      }));
    }
  } catch (e) { return []; }
  return [];
}

async function fetchMovieDetail(tmdbId) {
  const res = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}&language=en-US&append_to_response=videos`);
  if (!res.ok) throw new Error('tmdb detail');
  const m = await res.json();
  const trailer = (m.videos && m.videos.results || []).find(v => v.site === 'YouTube' && v.type === 'Trailer')
    || (m.videos && m.videos.results || []).find(v => v.site === 'YouTube');
  return {
    runtimeMinutes: m.runtime || null,
    statusText: (m.genres || []).map(g => g.name).slice(0, 2).join(', ') || null,
    trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
  };
}

function daysUntil(dateStr) {
  const days = Math.ceil((new Date(dateStr + 'T00:00:00') - new Date(new Date().toDateString())) / (1000 * 60 * 60 * 24));
  return days;
}

// Converts a raw day count into whatever unit reads best inside the countdown
// circle — plain days for anything close, months once it's further out, years for
// truly distant releases — so the circle never has to squeeze in an awkward number
// like "412 Days".
function formatCountdownBadge(days) {
  if (days == null) return { value: '–', unit: '' };
  if (days <= 0) return { value: 'Now', unit: '' };
  if (days < 60) return { value: days, unit: days === 1 ? 'Day' : 'Days' };
  if (days < 365) {
    const months = Math.round(days / 30);
    return { value: months, unit: months === 1 ? 'Month' : 'Months' };
  }
  const years = Math.round(days / 365);
  return { value: years, unit: years === 1 ? 'Year' : 'Years' };
}
function daysUntilWeekday(dayName) {
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const idx = names.findIndex(d => dayName && dayName.toLowerCase().includes(d));
  if (idx === -1) return null;
  const today = new Date().getDay();
  let diff = idx - today;
  if (diff < 0) diff += 7;
  return diff;
}

// Checks each in-progress / planned library item for a known upcoming episode or
// release date. Fetched live each time the Upcoming view opens rather than cached —
// air dates shift often enough that a stale countdown would be misleading.
async function fetchUpcomingForItems(candidates) {
  const settled = await Promise.allSettled(candidates.map(async (it) => {
    if (!it.externalId) return null;
    const dbId = it.externalId.split('-').slice(1).join('-');

    if (it.type === 'series') {
      const res = await fetch(`https://api.themoviedb.org/3/tv/${dbId}?api_key=${TMDB_API_KEY}&language=en-US`);
      if (!res.ok) return null;
      const data = await res.json();
      const next = data.next_episode_to_air;
      if (!next || !next.air_date) return null;
      const days = daysUntil(next.air_date);
      if (days < 0) return null;
      return { item: it, days, label: `Season ${next.season_number}, Episode ${next.episode_number}` };
    }

    if (it.type === 'movie') {
      const res = await fetch(`https://api.themoviedb.org/3/movie/${dbId}?api_key=${TMDB_API_KEY}&language=en-US`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.release_date) return null;
      const days = daysUntil(data.release_date);
      if (days < 0) return null;
      return { item: it, days, label: 'Release' };
    }

    if (it.type === 'anime') {
      // Only a genuine Jikan/MAL id means anything here — for Kitsu- or AniList-
      // sourced items the same number refers to a totally different anime on MAL,
      // so querying Jikan with it would silently show the wrong countdown.
      if (!it.externalId || !it.externalId.startsWith('jikan-')) return null;
      const res = await fetch(`https://api.jikan.moe/v4/anime/${dbId}`);
      if (!res.ok) return null;
      const data = await res.json();
      const a = data.data;
      if (!a) return null;
      if (a.status === 'Not yet aired' && a.aired && a.aired.from) {
        const days = daysUntil(a.aired.from.slice(0, 10));
        if (days < 0) return null;
        return { item: it, days, label: 'Premiere' };
      }
      if (a.status === 'Currently Airing' && a.broadcast && a.broadcast.day) {
        const days = daysUntilWeekday(a.broadcast.day);
        if (days == null) return null;
        return { item: it, days, label: 'New episode' };
      }
      return null;
    }
    return null;
  }));
  return settled.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value).sort((a, b) => a.days - b.days);
}

// Series: TMDB gives real season numbers; one call per season (in parallel) for the episode list.
async function fetchSeriesSeasons(tmdbId) {
  const showRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`);
  if (!showRes.ok) throw new Error('tmdb-tv show');
  const show = await showRes.json();
  const seasonNumbers = (show.seasons || []).map(s => s.season_number).filter(n => n !== undefined && n !== null);
  const seasons = await Promise.all(seasonNumbers.map(async sn => {
    const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${sn}?api_key=${TMDB_API_KEY}&language=en-US`);
    if (!res.ok) return { seasonNumber: sn, episodes: [] };
    const data = await res.json();
    return {
      seasonNumber: sn,
      episodes: (data.episodes || []).map(e => ({ id: `${sn}x${e.episode_number}`, number: e.episode_number, name: e.name, airdate: e.air_date })),
    };
  }));
  return seasons.filter(s => s.episodes.length > 0).sort((a, b) => a.seasonNumber - b.seasonNumber);
}

// Anime: Jikan paginates episodes (100 per page), so we load lazily, page by page.
async function fetchAnimeEpisodesPage(malId, page = 1) {
  const res = await fetchWithRetry(`https://api.jikan.moe/v4/anime/${malId}/episodes?page=${page}`);
  if (!res.ok) throw new Error('jikan episodes');
  const data = await res.json();
  return {
    episodes: (data.data || []).map(e => ({ id: `ep${e.mal_id}`, number: e.mal_id, name: e.title, airdate: e.aired })),
    hasNext: !!(data.pagination && data.pagination.has_next_page),
    lastPage: (data.pagination && data.pagination.last_visible_page) || page,
  };
}

// MyAnimeList doesn't split anime into real numbered seasons like TMDB does for TV,
// so we build "seasons" by grouping episodes by the year they aired — the same trick
// Hobi uses for long-running anime like Bleach. Episodes without an air date land in
// a trailing "Unscheduled" group rather than being dropped.
//
// Long-running shows (One Piece, etc.) can have 10+ pages — fetching those one at a
// time made this noticeably slow. Page 1 tells us the total page count, so the rest
// are fetched in small parallel batches instead (a gentle pace, to stay within
// Jikan's rate limit rather than firing everything at once).
async function fetchAnimeEpisodesForId(malId) {
  const first = await fetchAnimeEpisodesPage(malId, 1);
  let all = [...first.episodes];
  const lastPage = Math.min(first.lastPage, 20); // generous cap so even very long-running anime resolve fully

  const remainingPages = [];
  for (let p = 2; p <= lastPage; p++) remainingPages.push(p);

  const BATCH_SIZE = 3;
  for (let i = 0; i < remainingPages.length; i += BATCH_SIZE) {
    const batch = remainingPages.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(p => fetchAnimeEpisodesPage(malId, p)));
    results.forEach(r => { all = all.concat(r.episodes); });
    if (i + BATCH_SIZE < remainingPages.length) await new Promise(r => setTimeout(r, 350));
  }
  return all;
}

async function fetchAnimeRelations(malId) {
  try {
    // No retries here on purpose: this is only used for the "merge multi-season
    // anime" enhancement, which is best-effort. If Jikan is struggling (as it is
    // during the outages this app has hit before), retrying 2-3 times per lookup
    // would stack up into many seconds of dead time and make search feel frozen.
    // Failing instantly here just means that one franchise doesn't get merged —
    // search itself stays fast either way.
    const res = await fetchWithRetry(`https://api.jikan.moe/v4/anime/${malId}/relations`, 0);
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch (e) { return []; }
}

// Minimal single-anime lookup used only to order merged seasons chronologically and
// to label them with their real name (e.g. "Re:Zero − Starting Life in Another World
// Season 2" rather than a generic "Season 2").
async function fetchAnimeBasicInfo(malId) {
  try {
    const res = await fetchWithRetry(`https://api.jikan.moe/v4/anime/${malId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.data;
    if (!a) return null;
    return {
      malId: String(malId),
      title: a.title_english || a.title,
      airedFrom: (a.aired && a.aired.from) || null,
      subtype: a.type || null,
    };
  } catch (e) { return null; }
}

// ---- Merging multi-season anime into a single library entry ----
//
// Previously this app tried to merge Sequel/Prequel chains (e.g. Re:Zero S1+S2+S3)
// but had a real bug: each season independently discovered the full chain and
// "absorbed" the others into itself, while ALL FIVE seasons still stayed as separate
// visible entries in the results list — so a 5-season anime showed up 5 times, each
// one wrongly claiming to contain all 5. That's why it got turned off.
//
// The fix here is the shared cache below: every id discovered while walking a chain
// gets the SAME cached chain (same array), keyed by every id in it. That means
// whichever season a search happens to surface first, resolving its chain always
// gives the exact same group — so the dedup pass that follows only ever keeps ONE
// representative per franchise, no matter which season triggered the lookup first.
// ---- Manual overrides for known multi-season franchises ----
//
// A handful of major franchises (long-running or split into numbered "parts" like
// Bleach) either have messy/incomplete relation data on Jikan, or need their chain
// resolved even while Jikan's live relations endpoint is down. This list is checked
// FIRST, before any network call — if a season's id is in here, the whole chain
// resolves instantly from this list, no live lookup needed at all.
//
// IMPORTANT: this only lists WHICH Jikan ids belong together, in order. It does NOT
// hardcode any episode data — episode titles, air dates, and counts are still always
// fetched live (Jikan, or Kitsu/AniList if Jikan is down) per season id, so they stay
// current automatically. Add a new line here only when a whole new season/part of a
// franchise is announced — that's rare, so this needs almost no upkeep.
const ANIME_FRANCHISE_OVERRIDES = [
  // Bleach -> Bleach: Thousand-Year Blood War Parts 1-3 (Part 4 "The Calamity" not
  // yet added — its Jikan id wasn't confirmed with full certainty. To add it: search
  // "Bleach Calamity" on myanimelist.net, copy the number from the URL
  // (myanimelist.net/anime/NUMBER/...), and append it to this array.)
  ['269', '41467', '53998', '56784'],
];
const ANIME_OVERRIDE_LOOKUP = new Map();
ANIME_FRANCHISE_OVERRIDES.forEach(chain => chain.forEach(id => ANIME_OVERRIDE_LOOKUP.set(id, chain)));

// ---- Title-based franchise grouping (works across Jikan/Kitsu/AniList alike) ----
//
// The id-based overrides above only help when a season's id is a genuine Jikan id.
// During an actual Jikan outage, search results for a franchise come from Kitsu or
// AniList instead — sources with their own, unrelated id numbering — so id matching
// alone can't merge them. Title matching does: whichever database found "Bleach:
// Thousand-Year Blood War - The Separation", it still starts with "Bleach", so it
// still groups with every other Bleach season regardless of source.
//
// Add a new { key, pattern } here only for franchises that keep showing up split
// into confusing duplicate seasons; this list is intentionally short; everything
// else still merges automatically via live Jikan relations when Jikan is reachable.
const ANIME_TITLE_FRANCHISE_GROUPS = [
  { key: 'bleach', pattern: /^bleach\b/i },
  { key: 'mha', pattern: /^(my hero academia|boku no hero academia)\b/i },
  { key: 'aot', pattern: /^(attack on titan|shingeki no kyojin)\b/i },
  { key: 'demon-slayer', pattern: /^(demon slayer|kimetsu no yaiba)\b/i },
  { key: 'jjk', pattern: /^jujutsu kaisen\b/i },
  { key: 'fairy-tail', pattern: /^fairy tail\b/i },
  { key: 'black-clover', pattern: /^black clover\b/i },
  { key: 'haikyuu', pattern: /^haiky[uū]+/i },
  { key: 'sao', pattern: /^sword art online\b/i },
  { key: 'fire-force', pattern: /^(fire force|enen no shouboutai)\b/i },
  { key: 'promised-neverland', pattern: /^(the )?(promised neverland|yakusoku no neverland)\b/i },
  { key: 'tokyo-ghoul', pattern: /^tokyo ghoul\b/i },
  { key: 're-zero', pattern: /^re[:\s-]*zero\b/i },
  { key: 'mushoku-tensei', pattern: /^mushoku tensei\b/i },
  { key: 'slime', pattern: /^(that time i got reincarnated as a slime|tensei shitara slime datta ken)\b/i },
  { key: 'overlord', pattern: /^overlord\b/i },
  { key: 'konosuba', pattern: /^(konosuba|kono subarashii sekai)\b/i },
  { key: 'classroom-elite', pattern: /^(classroom of the elite|youkoso jitsuryoku)\b/i },
  { key: 'vinland-saga', pattern: /^vinland saga\b/i },
  { key: 'made-in-abyss', pattern: /^made in abyss\b/i },
  { key: 'rent-a-gf', pattern: /^(rent-a-girlfriend|kanojo,? okarishimasu)\b/i },
  { key: 'hxh', pattern: /^hunter\s*[x×]\s*hunter\b/i },
  { key: 'assassination-classroom', pattern: /^(assassination classroom|ansatsu kyoushitsu)\b/i },
  { key: 'shield-hero', pattern: /^((the )?rising of the shield hero|tate no yuusha)\b/i },
  { key: 'food-wars', pattern: /^(food wars|shokugeki no so+ma)\b/i },
  { key: 'steins-gate', pattern: /^steins;?gate\b/i },
  // Note: merges the 2003 original with Brotherhood on purpose, per request — they're
  // different adaptations of the same manga, not sequential seasons, but grouped
  // together here anyway since that's what was asked for.
  { key: 'fma', pattern: /^fullmetal alchemist\b/i },
  { key: 'danmachi', pattern: /^(danmachi|is it wrong to try to pick up girls)\b/i },
  { key: '7-deadly-sins', pattern: /^((the )?seven deadly sins|nanatsu no taizai)\b/i },
  { key: 'log-horizon', pattern: /^log horizon\b/i },
  { key: 'hanako-kun', pattern: /^(toilet-bound hanako-kun|jibaku shounen hanako-kun)\b/i },
  { key: 'code-geass', pattern: /^code geass\b/i },
  { key: 'noragami', pattern: /^noragami\b/i },
  { key: 'devil-part-timer', pattern: /^((the )?devil is a part-timer|hataraku maou-?sama)\b/i },
  { key: 'irregular-magic-hs', pattern: /^(the irregular at magic high school|mahouka koukou no rettousei)\b/i },
  { key: 'world-trigger', pattern: /^world trigger\b/i },
  { key: 'kaguya-sama', pattern: /^kaguya-sama\b/i },
  { key: 'spy-x-family', pattern: /^spy\s*[x×]\s*family\b/i },
  { key: 'bungo-stray-dogs', pattern: /^bungou? stray dogs\b/i },
  { key: 'seraph-end', pattern: /^(seraph of the end|owari no seraph)\b/i },
  { key: 'blue-lock', pattern: /^blue lock\b/i },
  { key: 'dr-stone', pattern: /^dr\.?\s*stone\b/i },
  { key: 'quintessential-quintuplets', pattern: /^((the )?quintessential quintuplets|go-?toubun no hanayome)\b/i },
  { key: 'takagi-san', pattern: /^(karakai jouzu no takagi-san|teasing master takagi-san)\b/i },
  { key: 'hellsing', pattern: /^hellsing\b/i },
  { key: 'nisekoi', pattern: /^nisekoi\b/i },
  { key: 'golden-kamuy', pattern: /^golden kamuy\b/i },
  { key: 'misfit-demon-king', pattern: /^((the )?misfit of demon king academy|maou gakuin no futekigousha)\b/i },
  { key: 'shangri-la-frontier', pattern: /^shangri-la frontier\b/i },
  { key: 'solo-leveling', pattern: /^(solo leveling|ore dake level up na ken)\b/i },
  { key: 'mashle', pattern: /^mashle\b/i },
  { key: 'wind-breaker', pattern: /^wind breaker\b/i },
  { key: 'frieren', pattern: /^(frieren|sousou no frieren)\b/i },
  { key: 'eminence-shadow', pattern: /^((the )?eminence in shadow|kage no jitsuryokusha)\b/i },
  { key: 'horimiya', pattern: /^horimiya\b/i },
  { key: 'to-your-eternity', pattern: /^(to your eternity|fumetsu no anata e)\b/i },
  { key: 'dandadan', pattern: /^dandadan\b/i },
  { key: 'kingdom', pattern: /^kingdom\b/i },
  // Merges the 2001 original with the 2019 reboot too, same call as Fullmetal
  // Alchemist above — different adaptations of the same manga, grouped together
  // on purpose per request.
  { key: 'fruits-basket', pattern: /^fruits basket\b/i },
  { key: 'one-punch-man', pattern: /^one[- ]punch man\b/i },
  { key: 'mob-psycho', pattern: /^mob psycho 100\b/i },
  { key: 'kuroko-basket', pattern: /^(kuroko's basketball|kuroko no basket(ball)?|kuroko no basu?ke(tto)?)\b/i },
  { key: 'ace-of-diamond', pattern: /^(ace of diamond|diamond no ace)\b/i },
  { key: 'yowamushi-pedal', pattern: /^yowamushi pedal\b/i },
  { key: 'free', pattern: /^free!/i },
  { key: 'prince-of-tennis', pattern: /^(the prince of tennis|tennis no ouji-?sama)\b/i },
  { key: 'saiki-k', pattern: /^((the )?disastrous life of saiki k|saiki kusuo)\b/i },
  { key: 'march-lion', pattern: /^(march comes in like a lion|san-?gatsu no lion)\b/i },
  { key: 'silver-spoon', pattern: /^(silver spoon|gin no saji)\b/i },
  { key: 'clannad', pattern: /^clannad\b/i },
  { key: 'haruhi', pattern: /^((the )?melancholy of haruhi suzumiya|suzumiya haruhi no yuu?utsu)\b/i },
  { key: 'goblin-slayer', pattern: /^goblin slayer\b/i },
  { key: 'beastars', pattern: /^beastars\b/i },
  { key: '86-eighty-six', pattern: /^(86|eighty-six)\b/i },
  { key: 'tower-of-god', pattern: /^tower of god\b/i },
  { key: 'god-of-high-school', pattern: /^(the )?god of high school\b/i },
  { key: 'zom-100', pattern: /^zom\s?100\b/i },
  { key: 'ranking-of-kings', pattern: /^(ranking of kings|ousama ranking)\b/i },
  { key: 'kakegurui', pattern: /^kakegurui\b/i },
  // Messiest entry on this list — spans multiple studios/eras (Baki the Grappler
  // 2001, the 2018 Netflix Baki, Baki Hanma, Baki Dou). All grouped together on
  // purpose, same call as Fullmetal Alchemist/Fruits Basket above. Worth double
  // checking this one once it's live.
  { key: 'baki', pattern: /^baki\b/i },
  { key: 'girls-und-panzer', pattern: /^girls (und|and) panzer\b/i },
  { key: 'tanya-evil', pattern: /^((the )?saga of tanya the evil|youjo senki)\b/i },
  { key: 'elusive-samurai', pattern: /^((the )?elusive samurai|nige jouzu no wakagimi)\b/i },
  { key: 'link-click', pattern: /^link click\b/i },
  { key: 'trapped-dating-sim', pattern: /^(trapped in a dating sim|otome game (no|wa) sekai)\b/i },
  { key: 'polar-opposites', pattern: /^you and i are polar opposites\b/i },
  { key: 'clevatess', pattern: /^clevatess\b/i },
  { key: 'skeleton-knight', pattern: /^(skeleton knight in another world|gaikotsu kishi)\b/i },
  { key: 'grand-blue', pattern: /^grand blue\b/i },
  { key: '100-girlfriends', pattern: /^(the 100 girlfriends|100-?kanojo)\b/i },
  { key: 'iruma-kun', pattern: /^(welcome to demon school|mairimashite)\b/i },
  { key: 'hana-kimi', pattern: /^hana-?kimi\b/i },
  { key: 'azur-lane', pattern: /^azur lane\b/i },
];

function franchiseGroupKeyForTitle(title) {
  const t = (title || '').trim();
  const group = ANIME_TITLE_FRANCHISE_GROUPS.find(g => g.pattern.test(t));
  return group ? group.key : null;
}

const animeMergeChainCache = new Map(); // malId (string) -> Promise<string[]>

async function fetchAnimeMergeChainIds(malId) {
  const startId = String(malId);

  // Only real Jikan/MAL ids are plain numbers. Anime results that came from the
  // AniList or Kitsu fallback (used when Jikan itself is down) carry ids like
  // "anilist-269" or "kitsu-269" — those simply don't get merged this way (title
  // grouping above handles the known cases instead); everything else about them
  // (poster, title, add-to-library) still works normally.
  if (!/^\d+$/.test(startId)) return [startId];

  if (ANIME_OVERRIDE_LOOKUP.has(startId)) return ANIME_OVERRIDE_LOOKUP.get(startId);

  if (animeMergeChainCache.has(startId)) return animeMergeChainCache.get(startId);

  const promise = (async () => {
    const seen = new Set([startId]);
    const queue = [startId];
    while (queue.length > 0) {
      const current = queue.shift();
      const relations = await fetchAnimeRelations(current);
      const relatedIds = relations
        .filter(r => r.relation === 'Sequel' || r.relation === 'Prequel')
        .flatMap(r => (r.entry || []).filter(e => e.type === 'anime'))
        .map(e => String(e.mal_id));
      for (const id of relatedIds) {
        if (!seen.has(id)) { seen.add(id); queue.push(id); }
      }
    }
    return Array.from(seen);
  })();

  animeMergeChainCache.set(startId, promise);
  promise.then(ids => { ids.forEach(id => { if (!animeMergeChainCache.has(id)) animeMergeChainCache.set(id, promise); }); })
    .catch(() => {});
  return promise;
}

// Runs once over a raw anime results list (search or "you might also like") and
// collapses every known franchise down to a single representative entry — the
// earliest-airing season present in that same list — tagged with every merged
// member's full info so the item modal can later pull every season's real episodes,
// regardless of which database each season came from.
async function mergeAnimeSeasonEntries(animeList) {
  if (!animeList || animeList.length <= 1) return animeList || [];
  const processed = new Set();
  const output = [];

  // Pass 1: title-based franchise groups (works across Jikan/Kitsu/AniList). Only
  // TV-format entries are eligible — a side movie/OVA sharing the franchise name
  // shouldn't get swallowed into the merged "seasons" list.
  const byFranchiseKey = new Map();
  animeList.forEach((r, idx) => {
    // TV and ONA (Netflix-original releases, e.g. Baki) both count as "real seasons"
    // eligible for merging. Movies, OVAs, Specials, and Music videos stay excluded —
    // those are side content that shouldn't get swallowed into the main season list.
    const isEligible = !r.subtype || ['TV', 'ONA'].includes(String(r.subtype).toUpperCase());
    if (!isEligible) return;
    const key = franchiseGroupKeyForTitle(r.title);
    if (!key) return;
    if (!byFranchiseKey.has(key)) byFranchiseKey.set(key, []);
    byFranchiseKey.get(key).push({ r, idx });
  });

  byFranchiseKey.forEach((members) => {
    if (members.length <= 1) return; // nothing to merge, leave it alone
    members.forEach(({ r }) => processed.add(r.externalId));
    const sorted = [...members].sort((a, b) => parseInt(a.r.year || '9999', 10) - parseInt(b.r.year || '9999', 10));
    const canonical = sorted[0].r;
    const meta = sorted.map(({ r }) => ({ externalId: r.externalId, title: r.title, year: r.year, episodes: r.episodes }));
    output.push({ ...canonical, mergedAnimeIds: meta.map(m => m.externalId), mergedAnimeMeta: meta, seasonCount: meta.length });
  });

  // Pass 2: whatever's left, try the id-based Jikan relations chain (only works for
  // genuinely Jikan-sourced entries — see fetchAnimeMergeChainIds). Every distinct
  // franchise is resolved IN PARALLEL rather than one at a time — each lookup is an
  // independent network call, so doing them sequentially was the main reason search
  // felt slow whenever several different multi-season anime showed up in one query.
  const remaining = animeList.filter(r => !processed.has(r.externalId));
  const candidateIds = Array.from(new Set(
    remaining.map(r => (r.externalId || '').replace('jikan-', '')).filter(id => /^\d+$/.test(id))
  ));
  const chainResults = await Promise.all(candidateIds.map(async (id) => {
    try { return [id, await fetchAnimeMergeChainIds(id)]; }
    catch (e) { return [id, [id]]; }
  }));
  const chainById = new Map(chainResults);

  remaining.forEach((r) => {
    if (processed.has(r.externalId)) return; // already claimed by an earlier group in this pass
    const malId = (r.externalId || '').replace('jikan-', '');
    const chainIds = chainById.get(malId) || [malId];

    const presentInList = animeList.filter(x => chainIds.includes((x.externalId || '').replace('jikan-', '')));
    presentInList.forEach(x => processed.add(x.externalId));

    const canonical = presentInList.reduce((best, cur) => {
      if (!best) return cur;
      const by = parseInt(best.year || '9999', 10);
      const cy = parseInt(cur.year || '9999', 10);
      return cy < by ? cur : best;
    }, null) || r;

    if (chainIds.length > 1) {
      const meta = presentInList
        .sort((a, b) => parseInt(a.year || '9999', 10) - parseInt(b.year || '9999', 10))
        .map(x => ({ externalId: x.externalId, title: x.title, year: x.year, episodes: x.episodes }));
      output.push({ ...canonical, mergedAnimeIds: chainIds, mergedAnimeMeta: meta, seasonCount: chainIds.length });
    } else {
      output.push(canonical);
    }
  });

  return output;
}

// Episode list for a merged (multi-season) anime item: one real Jikan malId per
// season, ordered by air date, each kept as its own clearly-labeled season rather
// than blended together — this is what makes "Season 1 / Season 2 / Season 3" show
// up correctly instead of the old year-grouping confusion.
async function fetchAnimeSeasonsMerged(malIds) {
  const infos = (await Promise.all(malIds.map(id => fetchAnimeBasicInfo(id)))).filter(Boolean);
  const ordered = infos.sort((a, b) => {
    if (!a.airedFrom && !b.airedFrom) return 0;
    if (!a.airedFrom) return 1;
    if (!b.airedFrom) return -1;
    return new Date(a.airedFrom) - new Date(b.airedFrom);
  });

  const seasons = [];
  let seasonNum = 1;
  for (const info of ordered) {
    let eps = [];
    try { eps = await fetchAnimeEpisodesForId(info.malId); } catch (e) { eps = []; }
    if (eps.length === 0) continue;
    seasons.push({
      seasonNumber: seasonNum,
      seasonTitle: info.title,
      // Prefixed with the source malId so episode ids never collide across seasons
      // that came from different underlying Jikan entries.
      episodes: eps.map(e => ({ ...e, id: `${info.malId}-${e.id}` })),
    });
    seasonNum++;
  }
  return seasons;
}

async function fetchAnimeSeasons(malId) {
  const all = await fetchAnimeEpisodesForId(malId);

  const byYear = {};
  all.forEach(e => {
    const year = e.airdate ? e.airdate.slice(0, 4) : 'unscheduled';
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(e);
  });
  const years = Object.keys(byYear).filter(y => y !== 'unscheduled').sort((a, b) => a - b);
  const seasons = years.map(y => ({ seasonNumber: y, episodes: byYear[y] }));
  if (byYear.unscheduled) seasons.push({ seasonNumber: 'Unscheduled', episodes: byYear.unscheduled });
  return seasons;
}

// Kitsu — used for anime items that were found via the Kitsu fallback (when Jikan
// was down at search time). Unlike AniList, Kitsu has a real per-episode endpoint
// with actual titles and air dates, so this keeps the "Episodes" list meaningful
// instead of falling back to generic "Episode 1, 2, 3..." placeholders.
async function fetchAnimeEpisodesKitsu(kitsuId) {
  let all = [];
  let offset = 0;
  const limit = 20;
  const HARD_CAP = 2000; // safety net for absurdly long-running shows
  while (offset < HARD_CAP) {
    const res = await fetchWithRetry(`https://kitsu.io/api/edge/anime/${kitsuId}/episodes?page[limit]=${limit}&page[offset]=${offset}&sort=number`);
    if (!res.ok) break;
    const data = await res.json();
    const page = (data.data || []).map(e => {
      const attrs = e.attributes || {};
      const titles = attrs.titles || {};
      return {
        id: `kitsuep${e.id}`,
        number: attrs.number,
        name: attrs.canonicalTitle || titles.en || titles.en_jp || null,
        airdate: attrs.airdate || null,
        seasonNumber: attrs.seasonNumber || null,
      };
    });
    all = all.concat(page);
    if (page.length < limit) break;
    offset += limit;
  }
  return all;
}

async function fetchAnimeSeasonsKitsu(kitsuId) {
  const all = await fetchAnimeEpisodesKitsu(kitsuId);

  // Kitsu sometimes tags episodes with their own seasonNumber directly — use that
  // when present (most accurate), otherwise fall back to grouping by air year like
  // the Jikan path does.
  const hasSeasonNumbers = all.some(e => e.seasonNumber != null);
  if (hasSeasonNumbers) {
    const bySeason = {};
    all.forEach(e => {
      const sn = e.seasonNumber || 1;
      if (!bySeason[sn]) bySeason[sn] = [];
      bySeason[sn].push(e);
    });
    return Object.keys(bySeason).sort((a, b) => a - b).map(sn => ({ seasonNumber: Number(sn), episodes: bySeason[sn] }));
  }

  const byYear = {};
  all.forEach(e => {
    const year = e.airdate ? e.airdate.slice(0, 4) : 'unscheduled';
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(e);
  });
  const years = Object.keys(byYear).filter(y => y !== 'unscheduled').sort((a, b) => a - b);
  const seasons = years.map(y => ({ seasonNumber: y, episodes: byYear[y] }));
  if (byYear.unscheduled) seasons.push({ seasonNumber: 'Unscheduled', episodes: byYear.unscheduled });
  return seasons;
}

// AniList only shows up for anime Jikan couldn't answer (see the search fallback) —
// it doesn't expose a rich per-episode title list the way Jikan does, so each related
// entry becomes a simple numbered checklist from its own episode count. Less detail
// per episode, but the seasons still get merged together, same idea as the Jikan side.
async function fetchAniListMediaInfo(anilistId) {
  const query = `query ($id: Int) { Media(id: $id, type: ANIME) { id episodes title { romaji english } startDate { year } relations { edges { relationType node { id type format } } } } }`;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query, variables: { id: Number(anilistId) } }),
  });
  const data = await res.json();
  return (data.data && data.data.Media) || null;
}

async function fetchAnimeSeasonsAniList(anilistId, totalEpisodesHint) {
  try {
    const info = await fetchAniListMediaInfo(anilistId).catch(() => null);
    const total = (info && info.episodes) || totalEpisodesHint || 0;
    if (!total) return [];
    return [{ seasonNumber: 1, episodes: Array.from({ length: total }, (_, i) => ({ id: `anilistep${anilistId}-${i + 1}`, number: i + 1, name: `Episode ${i + 1}`, airdate: null })) }];
  } catch (e) { return []; }
}

// Episode list for a franchise merged across POSSIBLY DIFFERENT sources (e.g. one
// season found via Jikan, another via Kitsu because Jikan was briefly down that day).
// Each member fetches its episodes through its own normal per-source path — nothing
// here is hardcoded except which seasons belong together — then everything is
// stitched into one ordered, clearly-labeled list.
async function fetchAnimeSeasonsAcrossSources(members) {
  const perMember = await Promise.all(members.map(async (m) => {
    try {
      const dbId = (m.externalId || '').split('-').slice(1).join('-');
      let subSeasons = [];
      if (m.externalId.startsWith('kitsu-')) subSeasons = await fetchAnimeSeasonsKitsu(dbId);
      else if (m.externalId.startsWith('anilist-')) subSeasons = await fetchAnimeSeasonsAniList(dbId, m.episodes);
      else if (m.externalId.startsWith('jikan-')) subSeasons = await fetchAnimeSeasons(dbId);
      return { member: m, subSeasons };
    } catch (e) { return { member: m, subSeasons: [] }; }
  }));

  const flattened = [];
  perMember.forEach(({ member, subSeasons }) => {
    if (!subSeasons || subSeasons.length === 0) return;
    if (subSeasons.length === 1) {
      flattened.push({ seasonTitle: member.title, episodes: subSeasons[0].episodes });
    } else {
      // The member itself already split into multiple year-based groups (e.g. a
      // very long-running original series) — keep those, just labeled under this
      // season's own name too so it's clear which part of the franchise they're in.
      subSeasons.forEach(s => {
        flattened.push({ seasonTitle: `${member.title} — ${seasonLabel(s)}`, episodes: s.episodes });
      });
    }
  });

  return flattened.map((s, i) => ({ seasonNumber: i + 1, seasonTitle: s.seasonTitle, episodes: s.episodes }));
}

// Same shape either way, so callers don't need to branch on type themselves.
async function fetchSeasonsFor(item) {
  const dbId = (item.externalId || '').split('-').slice(1).join('-');
  if (item.type === 'series') return fetchSeriesSeasons(dbId);
  if (item.mergedAnimeMeta && item.mergedAnimeMeta.length > 1) return fetchAnimeSeasonsAcrossSources(item.mergedAnimeMeta);
  if (item.mergedAnimeIds && item.mergedAnimeIds.length > 1) return fetchAnimeSeasonsMerged(item.mergedAnimeIds);
  if (item.externalId && item.externalId.startsWith('kitsu-')) return fetchAnimeSeasonsKitsu(dbId);
  if (item.externalId && item.externalId.startsWith('anilist-')) return fetchAnimeSeasonsAniList(dbId, item.totalEpisodes || item.episodes);
  return fetchAnimeSeasons(dbId);
}

function normalizeTitle(t) {
  return (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

// Ranks a category by how well its best match fits the query, so "Naruto" shows Anime
// first instead of always Movies → Series → Anime regardless of relevance.
// Combines how well the title matches with how well-known the title is, so an
// obscure exact match (e.g. an obscure "Matrix" show from 1993) doesn't automatically
// beat the famous title people actually meant (e.g. "The Matrix", 1999) just because
// its title happens to match more literally. Popularity is on wildly different scales
// across sources (TMDB ~0-500, Jikan members can be 100,000+), so it's compressed with
// a log scale before being combined with the match tier.
function searchScore(result, query) {
  const nq = normalizeTitle(query);
  const nt = normalizeTitle(result.title);
  let tier = 5;
  if (nq && nt) {
    if (nt === nq) tier = 40;
    else if (nt.startsWith(nq) || nq.startsWith(nt)) tier = 30;
    else if (nt.includes(nq) || nq.includes(nt)) tier = 20;
  }
  const popBonus = Math.min(60, Math.log10((result.popularityScore || 0) + 1) * 20);
  // When someone searches an anime name, they almost always mean the main TV series,
  // not a side-movie or OVA that happens to share the name — nudge those down a bit
  // rather than letting them outrank the series on popularity alone.
  const subtypePenalty = (result.type === 'anime' && result.subtype && result.subtype !== 'TV') ? 15 : 0;
  return tier + popBonus - subtypePenalty;
}

async function searchAllSources(q) {
  const [seriesR, animeR, movieR] = await Promise.allSettled([
    searchSeriesDB(q), searchAnimeDB(q), searchMovieDB(q),
  ]);
  const errors = {
    series: seriesR.status === 'rejected' ? String(seriesR.reason && seriesR.reason.message || seriesR.reason) : null,
    anime: animeR.status === 'rejected' ? String(animeR.reason && animeR.reason.message || animeR.reason) : null,
    movie: movieR.status === 'rejected' ? String(movieR.reason && movieR.reason.message || movieR.reason) : null,
  };
  const animeList = animeR.status === 'fulfilled' ? animeR.value : [];
  let seriesList = seriesR.status === 'fulfilled' ? seriesR.value : [];

  // Whatever Jikan already identified as anime should never also show up as a "series"
  // result. Match against every known title/alt-title (English, romaji, Japanese) and
  // allow one to contain the other, since TMDB and MAL don't always use the same name
  // (e.g. "Attack on Titan" vs "Shingeki no Kyojin").
  if (animeList.length > 0) {
    const animeTitleList = animeList.flatMap(a => (a.altTitles && a.altTitles.length ? a.altTitles : [a.title]))
      .map(normalizeTitle).filter(Boolean);
    seriesList = seriesList.filter(s => {
      const ns = normalizeTitle(s.title);
      if (!ns) return true;
      return !animeTitleList.some(nt => ns === nt || (ns.length > 3 && nt.length > 3 && (ns.includes(nt) || nt.includes(ns))));
    });
  }

  return {
    series: seriesList,
    anime: animeList,
    movie: movieR.status === 'fulfilled' ? movieR.value : [],
    anyError: seriesR.status === 'rejected' || animeR.status === 'rejected' || movieR.status === 'rejected',
    allFailed: seriesR.status === 'rejected' && animeR.status === 'rejected' && movieR.status === 'rejected',
    errors,
  };
}

/* ---------------------------------- small UI atoms ---------------------------------- */

// Official rating shown as stars (out of 5), never as a raw "x/10" number.
function ExternalStars({ value, source, size = 12 }) {
  if (!value) return null;
  const filledStars = Math.round((value / 10) * 5);
  return (
    <span className="ext-stars" style={{ fontSize: size }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} style={{ color: i < filledStars ? '#F5A623' : '#4A5178' }}>{i < filledStars ? '★' : '☆'}</span>
      ))}
      {source && <span className="ext-stars-source">{source}</span>}
    </span>
  );
}

function Poster({ item, size = 56 }) {
  const meta = TYPE_META[item.type];
  const posterUrl = item.posterUrl;
  return (
    <div className="poster" style={{ '--c': meta.color, width: size, height: size * 1.28 }}>
      {posterUrl ? (
        <img src={posterUrl} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} />
      ) : (
        <span style={{ fontSize: size * 0.42 }}>{item.emoji || '🎞️'}</span>
      )}
    </div>
  );
}

function ItemRow({ item, onClick, showType }) {
  const meta = TYPE_META[item.type];
  const isEpisodic = item.type !== 'movie';
  const watchedCount = item.externalId ? (item.watchedEpisodeIds || []).length : (item.episodesWatched || 0);
  return (
    <button className="item-row" onClick={onClick}>
      <Poster item={item} size={46} />
      <div className="item-info">
        <div className="item-title">{item.title}</div>
        <div className="item-meta">
          {showType && <span className="chip" style={{ '--c': meta.color }}>{meta.singular}</span>}
          {isEpisodic ? (
            <span className="dim">{watchedCount}{item.totalEpisodes ? `/${item.totalEpisodes}` : ''} ep</span>
          ) : (
            <span className="dim">{item.movieMinutes || TYPE_META.movie.defaultMinutes}′</span>
          )}
          {item.rating ? <span className="dim">★ {item.rating}/10</span> : null}
        </div>
      </div>
      <span className="status-dot" style={{ '--c': STATUS_META[item.status].color }} />
    </button>
  );
}

// Swipe left → reveals Delete. Swipe right → reveals quick actions ("+1 episode" /
// "Mark all watched" for series & anime, just "Mark watched" for movies).
const SWIPE_OPEN_LEFT = -84;   // px the row shifts to reveal the delete panel on the right
const SWIPE_OPEN_RIGHT = 150;  // px the row shifts to reveal quick actions on the left

function SwipeableItemRow({ item, onClick, showType, onDelete, onAdvanceEpisode, onMarkAllWatched }) {
  const [dragX, setDragX] = useState(0);
  const [open, setOpen] = useState(null); // 'left' | 'right' | null
  const startX = useRef(null);
  const startedOpen = useRef(null);
  const dragging = useRef(false);
  const isEpisodic = item.type !== 'movie';
  const isFullyWatched = isEpisodic && item.totalEpisodes && (item.watchedEpisodeIds || []).length >= item.totalEpisodes;

  const baseX = open === 'left' ? SWIPE_OPEN_LEFT : open === 'right' ? SWIPE_OPEN_RIGHT : 0;
  const x = dragging.current ? dragX : baseX;

  const onPointerDown = (e) => {
    dragging.current = true;
    startedOpen.current = open;
    startX.current = (e.touches ? e.touches[0].clientX : e.clientX);
    setDragX(baseX);
  };
  const onPointerMove = (e) => {
    if (!dragging.current || startX.current == null) return;
    const clientX = (e.touches ? e.touches[0].clientX : e.clientX);
    let next = (startedOpen.current === 'left' ? SWIPE_OPEN_LEFT : startedOpen.current === 'right' ? SWIPE_OPEN_RIGHT : 0) + (clientX - startX.current);
    next = Math.max(SWIPE_OPEN_LEFT, Math.min(SWIPE_OPEN_RIGHT, next));
    setDragX(next);
  };
  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (dragX <= SWIPE_OPEN_LEFT / 2) setOpen('left');
    else if (dragX >= SWIPE_OPEN_RIGHT / 2) setOpen('right');
    else setOpen(null);
    startX.current = null;
  };
  const close = () => setOpen(null);

  return (
    <div className="swipe-row">
      <div className="swipe-actions swipe-actions-left">
        {isEpisodic && !isFullyWatched && (
          <button className="swipe-action advance" onClick={() => { onAdvanceEpisode(item); close(); }}>
            <PlayCircle size={16} />
            <span>+1 ep</span>
          </button>
        )}
        <button className="swipe-action markwatched" onClick={() => { onMarkAllWatched(item); close(); }}>
          <CheckCircle2 size={16} />
          <span>{isEpisodic ? 'All watched' : 'Watched'}</span>
        </button>
      </div>
      <div className="swipe-actions swipe-actions-right">
        <button className="swipe-action delete" onClick={() => { onDelete(item.id); close(); }}>
          <Trash2 size={18} />
        </button>
      </div>
      <div
        className="swipe-content"
        style={{ transform: `translateX(${x}px)`, transition: dragging.current ? 'none' : 'transform 0.2s ease' }}
        onTouchStart={onPointerDown} onTouchMove={onPointerMove} onTouchEnd={endDrag}
        onMouseDown={onPointerDown} onMouseMove={e => dragging.current && onPointerMove(e)} onMouseUp={endDrag} onMouseLeave={endDrag}
      >
        <ItemRow item={item} showType={showType} onClick={() => (open ? close() : onClick())} />
      </div>
    </div>
  );
}

function EmptyState({ text, cta }) {
  return (
    <div className="empty-state">
      <div className="empty-emoji">🎞️</div>
      <p>{text}</p>
      {cta && <span className="empty-cta">{cta}</span>}
    </div>
  );
}

/* ---------------------------------- Splash ---------------------------------- */

function SplashScreen({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1500);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="splash" onClick={onDone}>
      <div className="splash-frame">
        <div className="sprockets top">{Array.from({ length: 10 }).map((_, i) => <i key={i} />)}</div>
        <div className="splash-mid">
          <Ticket size={34} className="splash-ticket" />
          <h1>{APP_NAME}</h1>
          <p>Movies · Series · Anime</p>
        </div>
        <div className="sprockets bottom">{Array.from({ length: 10 }).map((_, i) => <i key={i} />)}</div>
      </div>
      <span className="splash-skip">tap anywhere</span>
    </div>
  );
}

/* ---------------------------------- Search result card + strip ---------------------------------- */

function UpcomingTimeline({ rows }) {
  return (
    <div className="upcoming-timeline">
      <div className="upcoming-timeline-track" />
      {rows.map(r => {
        const badge = formatCountdownBadge(r.days);
        return (
          <div className="upcoming-timeline-row" key={r.id}>
            <div className="upcoming-timeline-badge-col">
              <div className="upcoming-timeline-day">
                <span className="upcoming-timeline-day-n">{badge.value}</span>
                {badge.unit && <span className="upcoming-timeline-day-u">{badge.unit}</span>}
              </div>
            </div>
            <button className="upcoming-timeline-content" onClick={r.onOpen}>
              <div className="upcoming-timeline-poster">
                {r.posterUrl ? <img src={r.posterUrl} alt="" /> : <r.icon size={18} />}
              </div>
              <div className="upcoming-timeline-info">
                <div className="upcoming-timeline-title">{r.title}</div>
                {r.metaLine && <div className="upcoming-timeline-meta-row"><r.icon size={12} />{r.metaLine}</div>}
                {r.dateLine && <div className="upcoming-timeline-meta-row"><Clock3 size={12} />{r.dateLine}</div>}
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ResultRow({ result, inLibrary, libraryItemId, onOpen, onQuickAdd, onRemoveFromLibrary }) {
  const meta = TYPE_META[result.type];
  const Icon = meta.icon;
  const [imgError, setImgError] = useState(false);
  const showImg = result.posterUrl && !imgError;
  // Tapping "In list" again removes it — the common case is an accidental tap while
  // browsing search results, and undoing that shouldn't require a trip to My Shows.
  const handleAddClick = () => {
    if (inLibrary && libraryItemId && onRemoveFromLibrary) onRemoveFromLibrary(libraryItemId);
    else onQuickAdd(result);
  };
  return (
    <div className="result-row" style={{ '--c': meta.color }}>
      <button className="result-row-main" onClick={() => onOpen(result)}>
        <div className="result-row-poster">
          {showImg ? (
            <img src={result.posterUrl} alt="" loading="lazy" onError={() => setImgError(true)} />
          ) : (
            <div className="result-poster-fallback"><Film size={20} /></div>
          )}
        </div>
        <div className="result-row-info">
          <div className="result-row-title-line">
            <Icon size={13} />
            <span className="result-row-title">{result.title}</span>
          </div>
          <div className="result-row-meta">
            {result.type === 'series' ? (result.statusText || result.year || '') : (result.year || '')}
            {result.type === 'anime' && result.subtype && result.subtype !== 'TV' && (
              <span className="chip chip-mini" style={{ '--c': '#F5A623' }}>{result.subtype}</span>
            )}
            {result.type === 'anime' && result.seasonCount > 1 && (
              <span className="chip chip-mini" style={{ '--c': '#7ED957' }}>{result.seasonCount} seasons</span>
            )}
            <ExternalStars value={result.ratingValue} source={result.ratingSource} size={11} />
          </div>
        </div>
      </button>
      <button className={`result-row-add ${inLibrary ? 'in-list' : ''}`} onClick={handleAddClick}>
        {inLibrary ? <Check size={16} /> : <Plus size={16} />}
        <span>{inLibrary ? 'In list' : (result.type === 'movie' ? 'Movie' : result.type === 'series' ? 'Series' : 'Anime')}</span>
      </button>
    </div>
  );
}

// "Zapping" — a Tinder-style swipe deck over popular titles. Swipe (or tap the
// heart/X buttons) right to add "Want to watch", left to skip and move on.
function ZapCardContent({ result, onOpen }) {
  const meta = TYPE_META[result.type];
  const Icon = meta.icon;
  return (
    <div className="zap-card-inner" onClick={onOpen}>
      <div className="zap-card-poster">
        {result.posterUrl ? <img src={result.posterUrl} alt="" /> : <Icon size={40} />}
      </div>
      <div className="zap-card-info">
        <span className="chip" style={{ '--c': meta.color }}>{meta.singular}</span>
        <div className="zap-card-title">{result.title}</div>
        <div className="zap-card-meta">
          {result.year || ''}
          <ExternalStars value={result.ratingValue} source={result.ratingSource} size={12} />
        </div>
      </div>
    </div>
  );
}

function SwipeDeck({ items, onQuickAdd, onOpen, onNeedMore }) {
  const [index, setIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const dragging = useRef(false);
  const startX = useRef(null);
  const [exitDir, setExitDir] = useState(null);

  const current = items[index];
  const upNext = items[index + 1];

  useEffect(() => {
    if (items.length > 0 && index >= items.length - 3 && onNeedMore) onNeedMore();
  }, [index, items.length]);

  const onPointerDown = (e) => {
    dragging.current = true;
    startX.current = (e.touches ? e.touches[0].clientX : e.clientX);
  };
  const onPointerMove = (e) => {
    if (!dragging.current || startX.current == null) return;
    const clientX = (e.touches ? e.touches[0].clientX : e.clientX);
    setDragX(clientX - startX.current);
  };
  const finishSwipe = (dir, status) => {
    setExitDir(dir);
    if (dir !== 'left' && current) onQuickAdd(current, status || 'planned');
    setTimeout(() => {
      setIndex(i => i + 1);
      setDragX(0);
      setExitDir(null);
    }, 200);
  };
  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (dragX > 100) finishSwipe('right');
    else if (dragX < -100) finishSwipe('left');
    else setDragX(0);
    startX.current = null;
  };

  if (!current) {
    return (
      <div className="zap-empty">
        <Zap size={26} />
        <p className="dim">That's everyone for now — check back later for more.</p>
      </div>
    );
  }

  const rotate = dragX / 18;
  const cardStyle = exitDir
    ? { transform: `translateX(${exitDir === 'right' ? 600 : -600}px) rotate(${exitDir === 'right' ? 30 : -30}deg)`, transition: 'transform 0.2s ease', opacity: 0 }
    : { transform: `translateX(${dragX}px) rotate(${rotate}deg)`, transition: dragging.current ? 'none' : 'transform 0.2s ease' };

  return (
    <div className="zap-deck">
      <div className="zap-stack">
        {upNext && (
          <div className="zap-card zap-card-behind">
            <ZapCardContent result={upNext} />
          </div>
        )}
        <div
          className="zap-card"
          style={cardStyle}
          onTouchStart={onPointerDown} onTouchMove={onPointerMove} onTouchEnd={onPointerUp}
          onMouseDown={onPointerDown} onMouseMove={e => dragging.current && onPointerMove(e)} onMouseUp={onPointerUp} onMouseLeave={onPointerUp}
        >
          <ZapCardContent result={current} onOpen={() => onOpen(current)} />
          {dragX > 40 && <div className="zap-stamp zap-stamp-like">WANT TO WATCH</div>}
          {dragX < -40 && <div className="zap-stamp zap-stamp-skip">SKIP</div>}
        </div>
      </div>
      <div className="zap-actions">
        <button className="zap-action-btn zap-skip" onClick={() => finishSwipe('left')}><X size={22} /></button>
        <button className="zap-action-btn zap-plan" onClick={() => finishSwipe('right', 'planned')}><Heart size={19} /></button>
        <button className="zap-action-btn zap-watched" onClick={() => finishSwipe('right', 'completed')}><CheckCircle2 size={19} /></button>
      </div>
    </div>
  );
}

function ResultSection({ title, color, results, items, onOpen, onQuickAdd, onRemoveFromLibrary }) {
  if (!results || results.length === 0) return null;
  return (
    <div className="result-section">
      <div className="group-title" style={{ color }}>{title}</div>
      <div className="result-list">
        {results.map(r => {
          const matched = items.find(i => i.externalId === r.externalId && i.type === r.type);
          return (
            <ResultRow
              key={r.externalId}
              result={r}
              inLibrary={!!matched}
              libraryItemId={matched ? matched.id : null}
              onOpen={onOpen}
              onQuickAdd={onQuickAdd}
              onRemoveFromLibrary={onRemoveFromLibrary}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------- Result detail sheet ---------------------------------- */

function ResultDetailSheet({ result, items, onClose, onAdd, onOpenEpisodes, onQuickAdd, onOpenResult }) {
  useBodyScrollLock();
  const [detail, setDetail] = useState(result);
  const [loadingMore, setLoadingMore] = useState(!!result.needsDetail);
  const [imgError, setImgError] = useState(false);
  const [seasons, setSeasons] = useState(null);
  const [loadingSeasons, setLoadingSeasons] = useState(false);
  const [similar, setSimilar] = useState(null);
  const [addedSimilar, setAddedSimilar] = useState(() => new Set());
  const meta = TYPE_META[result.type];
  const existingItem = items.find(i => i.externalId === result.externalId && i.type === result.type);
  const already = !!existingItem;
  const watchedSet = new Set((existingItem && existingItem.watchedEpisodeIds) || []);
  const dbId = (result.externalId || '').split('-').slice(1).join('-');

  useEffect(() => {
    let cancelled = false;
    if (result.needsDetail && result.tmdbId) {
      const fetcher = result.type === 'series' ? fetchSeriesDetail : fetchMovieDetail;
      fetcher(result.tmdbId).then(extra => {
        if (!cancelled) setDetail(d => ({ ...d, ...extra }));
      }).catch(() => {}).finally(() => { if (!cancelled) setLoadingMore(false); });
    }
    if (result.type !== 'movie') {
      setLoadingSeasons(true);
      fetchSeasonsFor(result).then(r => { if (!cancelled) setSeasons(r); })
        .catch(() => {}).finally(() => { if (!cancelled) setLoadingSeasons(false); });
    }
    fetchSimilarTitles(result).then(r => { if (!cancelled) setSimilar(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, [result]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal detail-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="chip" style={{ '--c': meta.color }}>{meta.singular}</span>
          <button className="icon-x" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="detail-hero">
          <div className="detail-poster">
            {detail.posterUrl && !imgError ? <img src={detail.posterUrl} alt="" onError={() => setImgError(true)} /> : <div className="result-poster-fallback"><Film size={26} /></div>}
          </div>
          <div className="detail-hero-info">
            <div className="detail-title">{detail.title}</div>
            <div className="detail-year">{detail.year || ''}{detail.statusText ? ` · ${detail.statusText}` : ''}</div>
            <div style={{ marginBottom: 6 }}><ExternalStars value={detail.ratingValue} source={detail.ratingSource} size={14} /></div>
            <div className="detail-facts">
              {detail.type !== 'movie' && (
                <span>{detail.episodes != null ? `${detail.episodes} episodes` : 'episode count unknown'}</span>
              )}
              {detail.runtimeMinutes ? (
                detail.type === 'movie'
                  ? <span>{(detail.runtimeMinutes / 60).toFixed(1)}h</span>
                  : <span>{detail.runtimeMinutes}′ /ep</span>
              ) : (loadingMore ? <span>loading…</span> : null)}
            </div>
            {detail.extraNote && <div className="detail-note">{detail.extraNote}</div>}
          </div>
        </div>

        {detail.summary && <p className="detail-summary">{detail.summary}</p>}

        <div className="modal-actions two-choice">
          {detail.trailerUrl && (
            <button className="trailer-btn" onClick={() => window.open(detail.trailerUrl, '_blank', 'noopener,noreferrer')}>
              <PlayIcon size={16} /> Trailer
            </button>
          )}
        </div>
        {already ? (
          <div className="already-note"><Check size={15} /> Already in your list</div>
        ) : (
          <div className="choice-row">
            <button className="choice-btn watched" onClick={() => onAdd(detail, 'completed')}>
              <CheckCircle2 size={16} /> I've watched it
            </button>
            <button className="choice-btn" style={{ '--c': meta.color }} onClick={() => onAdd(detail, 'planned')}>
              <ListChecks size={16} /> Want to watch
            </button>
          </div>
        )}

        {/* Same checklist preview you'd see once it's in My Shows — tapping it adds the
            show to your list ("Want to watch") if it isn't there yet. */}
        {result.type !== 'movie' && (
          <>
            <div className="field-label" style={{ marginTop: 16 }}>Episodes</div>
            {loadingSeasons && <p className="dim" style={{ padding: '6px 2px 4px' }}>Loading seasons…</p>}
            {seasons && seasons.length > 0 && (
              <div className="item-list">
                {seasons.map(s => (
                  <SeasonRow key={s.seasonNumber} season={s} watchedSet={watchedSet} onOpen={() => onOpenEpisodes(detail, s)} />
                ))}
              </div>
            )}
          </>
        )}

        {similar && similar.length > 0 && (
          <div className="im-similar-section">
            <div className="im-card-label" style={{ marginTop: 16 }}>You might also like</div>
            <div className="similar-scroll">
              {similar.map(s => {
                const alreadyAdded = addedSimilar.has(s.externalId);
                return (
                  <div key={s.externalId} className="similar-card" onClick={() => onOpenResult(s)}>
                    <div className="similar-poster">
                      {s.posterUrl ? <img src={s.posterUrl} alt="" /> : <Film size={18} />}
                    </div>
                    <div className="similar-title">{s.title}</div>
                    <button
                      className="similar-add"
                      disabled={alreadyAdded}
                      onClick={(e) => { e.stopPropagation(); onQuickAdd(s, 'planned'); setAddedSimilar(prev => new Set(prev).add(s.externalId)); }}
                    >
                      {alreadyAdded ? <Check size={13} /> : <Plus size={13} />}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- Discover (home) ---------------------------------- */

function DiscoverScreen({ items, onOpen, onQuickAdd, onOpenEpisodes, onDelete, profileName }) {
  const [discoverTab, setDiscoverTab] = useState('search'); // 'search' | 'upcoming'
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'movie' | 'series' | 'anime' — applies while in Search
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [results, setResults] = useState(null);
  // A real back-stack instead of a single value — so drilling into a "You might also
  // like" suggestion and pressing back returns to the result you came from, not all
  // the way out to the search list.
  const [resultStack, setResultStack] = useState([]);
  const activeResult = resultStack.length > 0 ? resultStack[resultStack.length - 1] : null;
  const openResult = (result) => setResultStack(stack => [...stack, result]);
  const closeResult = () => setResultStack(stack => stack.slice(0, -1));
  const [history, setHistory] = useState([]);
  const [trending, setTrending] = useState(null);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [trendingPage, setTrendingPage] = useState(1);
  const [loadingMoreTrending, setLoadingMoreTrending] = useState(false);
  const [trendingExhausted, setTrendingExhausted] = useState(false);
  const [zappingOn, setZappingOn] = useState(false);
  const [zapItems, setZapItems] = useState(null);
  const [zapLoading, setZapLoading] = useState(false);
  const [zapLoadingMore, setZapLoadingMore] = useState(false);
  const [zapPage, setZapPage] = useState(1);

  // Re-fetch the popular deck whenever Zapping turns on, or the type filter changes
  // while it's already on — Movies tab zaps popular movies, Anime tab zaps popular
  // anime, "all" zaps a mix of everything, same as the rest of Discover.
  useEffect(() => {
    if (!zappingOn) return;
    setZapLoading(true);
    setZapItems(null);
    setZapPage(1);
    const zapType = typeFilter === 'all' ? 'mix' : typeFilter;
    fetchPopular(zapType, 1)
      .then(raw => mergeAnimeWithinTrendingBatch(raw))
      .then(setZapItems)
      .catch(() => setZapItems([]))
      .finally(() => setZapLoading(false));
  }, [zappingOn, typeFilter]);
  const [upcomingGlobal, setUpcomingGlobal] = useState(null);
  const [loadingUpcomingGlobal, setLoadingUpcomingGlobal] = useState(false);
  const [upcomingQuery, setUpcomingQuery] = useState('');
  const debounceRef = useRef(null);

  // Trending is a combined, interleaved movie/series/anime list — this collapses
  // multi-season anime within THAT batch the same way search results already do,
  // then rebuilds the list in its original order with the merged entries in place.
  const mergeAnimeWithinTrendingBatch = async (batch) => {
    const animeItems = batch.filter(r => r.type === 'anime');
    if (animeItems.length === 0) return batch;
    let mergedAnime = animeItems.length > 1 ? animeItems : animeItems;
    if (animeItems.length > 1) {
      try { mergedAnime = await mergeAnimeSeasonEntries(animeItems); } catch (e) { mergedAnime = animeItems; }
    }
    // Trending only ever contains what's currently popular/airing — a franchise's
    // OTHER seasons usually aren't trending themselves, so they never make it into
    // this batch to merge against. For anything recognized as a known multi-season
    // franchise that's still on its own after the batch-only merge, do a quick
    // background search (the same one the Search tab uses) to pull in its full
    // season set instead of just whichever one happens to be trending.
    mergedAnime = await Promise.all(mergedAnime.map(async (item) => {
      if (item.mergedAnimeIds && item.mergedAnimeIds.length > 1) return item; // already merged
      const key = franchiseGroupKeyForTitle(item.title);
      if (!key) return item;
      try {
        const query = item.title.split(':')[0].replace(/\s+season\s*\d+$/i, '').trim();
        const searchResults = await searchAnimeDB(query);
        const fullMatch = searchResults.find(r => franchiseGroupKeyForTitle(r.title) === key && r.mergedAnimeIds && r.mergedAnimeIds.length > 1);
        return fullMatch || item;
      } catch (e) { return item; }
    }));

    const mergedById = new Map(mergedAnime.map(a => [a.externalId, a]));
    const seen = new Set();
    return batch
      .map(item => {
        if (item.type !== 'anime') return item;
        if (mergedById.has(item.externalId) && !seen.has(item.externalId)) {
          seen.add(item.externalId);
          return mergedById.get(item.externalId);
        }
        return null; // absorbed into another season's merged entry — drop it
      })
      .filter(Boolean);
  };

  useEffect(() => { loadSearchHistory().then(setHistory); }, []);
  useEffect(() => {
    (async () => {
      setTrendingLoading(true);
      try {
        const raw = await fetchTrendingAll(1);
        setTrending(await mergeAnimeWithinTrendingBatch(raw));
      } catch (e) { setTrending([]); }
      setTrendingLoading(false);
    })();
  }, []);
  useEffect(() => {
    if (discoverTab === 'upcoming' && upcomingGlobal === null && !loadingUpcomingGlobal) {
      setLoadingUpcomingGlobal(true);
      fetch('/api/upcoming').then(r => r.json()).then(d => setUpcomingGlobal(d.results || []))
        .catch(() => setUpcomingGlobal([])).finally(() => setLoadingUpcomingGlobal(false));
    }
  }, [discoverTab]);

  // A plain "Show more" button — simpler and more reliable than auto-loading on scroll.
  const loadMoreTrending = async () => {
    if (loadingMoreTrending || trendingExhausted) return;
    setLoadingMoreTrending(true);
    const nextPage = trendingPage + 1;
    try {
      let more = await fetchTrendingAll(nextPage);
      if (more.length === 0) setTrendingExhausted(true);
      else {
        more = await mergeAnimeWithinTrendingBatch(more);
        setTrending(prev => {
          const existingIds = new Set((prev || []).map(r => r.externalId));
          const deduped = more.filter(r => !existingIds.has(r.externalId));
          return [...(prev || []), ...deduped];
        });
        setTrendingPage(nextPage);
      }
    } catch (e) { setTrendingExhausted(true); }
    setLoadingMoreTrending(false);
  };

  const addToHistory = (q) => {
    setHistory(h => {
      const next = [q, ...h.filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 10);
      saveSearchHistory(next);
      return next;
    });
  };
  const clearHistory = () => { setHistory([]); saveSearchHistory([]); };

  const localMatches = query.trim()
    ? items.filter(i => i.title.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults(null); setSearching(false); setSearchError(''); return; }
    setSearching(true);
    setSearchError('');
    debounceRef.current = setTimeout(async () => {
      addToHistory(q);
      try {
        const r = await searchAllSources(q);
        setResults(r);
        if (r.allFailed) {
          setSearchError("Couldn't reach the database right now — check your connection and try again in a moment.");
        }
      } catch (e) {
        setSearchError("Couldn't connect to the database. Try again.");
        setResults(null);
      } finally { setSearching(false); }
    }, 450);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const handleAddFromResult = (detail, status) => {
    onQuickAdd(detail, status);
    setResultStack([]);
  };

  const filteredResultsCount = results
    ? (typeFilter === 'all' || typeFilter === 'movie' ? results.movie.length : 0)
      + (typeFilter === 'all' || typeFilter === 'series' ? results.series.length : 0)
      + (typeFilter === 'all' || typeFilter === 'anime' ? results.anime.length : 0)
    : 0;
  const hasAnyResults = results && filteredResultsCount > 0;

  return (
    <div className="screen discover-screen">
      <div className="discover-top">
        <div className="discover-brand">
          <Ticket size={16} />
          <span>{APP_NAME}</span>
        </div>
        {profileName ? <span className="discover-greet">Hi, {profileName}</span> : null}
      </div>

      <div className="tabs-row">
        <button className={`tab-btn ${discoverTab === 'search' && typeFilter === 'all' ? 'active' : ''}`} onClick={() => { setDiscoverTab('search'); setTypeFilter('all'); }}>
          <Search size={14} /> Search
        </button>
        <button className={`tab-btn ${discoverTab === 'upcoming' ? 'active' : ''}`} onClick={() => setDiscoverTab('upcoming')}>
          <CalendarDays size={14} /> Upcoming
        </button>
        <button className={`tab-btn ${discoverTab === 'search' && typeFilter === 'movie' ? 'active' : ''}`} onClick={() => { setDiscoverTab('search'); setTypeFilter('movie'); }}>
          <Film size={14} /> Movies
        </button>
        <button className={`tab-btn ${discoverTab === 'search' && typeFilter === 'series' ? 'active' : ''}`} onClick={() => { setDiscoverTab('search'); setTypeFilter('series'); }}>
          <Tv2 size={14} /> Series
        </button>
        <button className={`tab-btn ${discoverTab === 'search' && typeFilter === 'anime' ? 'active' : ''}`} onClick={() => { setDiscoverTab('search'); setTypeFilter('anime'); }}>
          <Sparkles size={14} /> Anime
        </button>
      </div>

      {discoverTab === 'search' && (
      <>
      <div className="search-box">
        <Search size={16} />
        <input
          placeholder="What do you want to watch? e.g. Matrix, One Piece, Breaking Bad..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {searching && <Loader2 size={15} className="spin" />}
      </div>

      {!query.trim() && (
        history.length > 0 ? (
          <div className="history-block">
            <div className="history-head">
              <span>Recent searches</span>
              <button onClick={clearHistory}>Clear</button>
            </div>
            <div className="history-chips">
              {history.map(h => (
                <button key={h} className="history-chip" onClick={() => setQuery(h)}>
                  <Search size={12} /> {h}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState text="Type a title to search movies, series, and anime live." />
        )
      )}

      {!query.trim() && (
        <div className="group" style={{ marginTop: 18 }}>
          <div className="zap-header-row">
            <div className="group-title" style={{ color: '#7ED957', margin: 0 }}>Trending now</div>
            <button className={`zap-toggle-btn ${zappingOn ? 'active' : ''}`} onClick={() => setZappingOn(z => !z)}>
              <Zap size={13} /> {zappingOn ? 'Exit Zapping' : 'Zapping'}
            </button>
          </div>
          {zappingOn ? (
            zapLoading && !zapItems ? (
              <p className="dim" style={{ padding: '4px 2px' }}>Loading…</p>
            ) : (
              <SwipeDeck
                items={zapItems || []}
                onQuickAdd={onQuickAdd}
                onOpen={openResult}
                onNeedMore={() => {
                  if (zapLoadingMore) return;
                  setZapLoadingMore(true);
                  const nextPage = zapPage + 1;
                  const zapType = typeFilter === 'all' ? 'mix' : typeFilter;
                  fetchPopular(zapType, nextPage).then(async more => {
                    if (more.length > 0) {
                      more = await mergeAnimeWithinTrendingBatch(more);
                      setZapItems(prev => [...(prev || []), ...more]);
                      setZapPage(nextPage);
                    }
                  }).finally(() => setZapLoadingMore(false));
                }}
              />
            )
          ) : (
          trendingLoading ? (
            <p className="dim" style={{ padding: '4px 2px' }}>Loading…</p>
          ) : trending && trending.filter(r => typeFilter === 'all' || r.type === typeFilter).length > 0 ? (
            <>
              <div className="result-list">
                {trending.filter(r => typeFilter === 'all' || r.type === typeFilter).map(r => {
                  const matched = items.find(i => i.externalId === r.externalId && i.type === r.type);
                  return (
                    <ResultRow
                      key={r.externalId}
                      result={r}
                      inLibrary={!!matched}
                      libraryItemId={matched ? matched.id : null}
                      onOpen={openResult}
                      onQuickAdd={onQuickAdd}
                      onRemoveFromLibrary={onDelete}
                    />
                  );
                })}
              </div>
              {!trendingExhausted && (
                <button className="show-more-btn" onClick={loadMoreTrending} disabled={loadingMoreTrending}>
                  {loadingMoreTrending ? <Loader2 size={15} className="spin" /> : 'Show more'}
                </button>
              )}
              {trendingExhausted && <p className="dim" style={{ padding: '10px 2px', textAlign: 'center' }}>That's everything for now.</p>}
            </>
          ) : (
            <p className="dim" style={{ padding: '4px 2px' }}>Couldn't load trending titles right now.</p>
          )
          )}
        </div>
      )}

      {searchError && !hasAnyResults && <p className="inline-error" style={{ marginTop: 10 }}>{searchError}</p>}

      {localMatches.length > 0 && (
        <div className="group" style={{ marginTop: 14 }}>
          <div className="group-title" style={{ color: '#8892B0' }}>In your library</div>
          <div className="item-list">
            {localMatches.slice(0, 5).map(it => <ItemRow key={it.id} item={it} showType onClick={() => onOpen(it)} />)}
          </div>
        </div>
      )}

      {query.trim().length >= 2 && !searching && results && !hasAnyResults && !searchError && (
        <p className="dim" style={{ padding: '10px 2px' }}>No matches in the database.</p>
      )}

      {results && hasAnyResults && (
        <div className="group" style={{ marginTop: 16 }}>
          <div className="group-title" style={{ color: '#7ED957' }}>Results</div>
          <div className="result-list">
            {[
              ...(typeFilter === 'all' || typeFilter === 'movie' ? results.movie : []),
              ...(typeFilter === 'all' || typeFilter === 'series' ? results.series : []),
              ...(typeFilter === 'all' || typeFilter === 'anime' ? results.anime : []),
            ]
              .sort((a, b) => searchScore(b, query) - searchScore(a, query))
              .map(r => {
                const matched = items.find(i => i.externalId === r.externalId && i.type === r.type);
                return (
                  <ResultRow
                    key={r.externalId}
                    result={r}
                    inLibrary={!!matched}
                    libraryItemId={matched ? matched.id : null}
                    onOpen={openResult}
                    onQuickAdd={onQuickAdd}
                    onRemoveFromLibrary={onDelete}
                  />
                );
              })}
          </div>
        </div>
      )}
      </>
      )}

      {discoverTab === 'upcoming' && (
        <div className="group" style={{ marginTop: 4 }}>
          <div className="search-box" style={{ marginBottom: 16 }}>
            <Search size={16} />
            <input
              placeholder="Search upcoming titles…"
              value={upcomingQuery}
              onChange={e => setUpcomingQuery(e.target.value)}
            />
          </div>
          {loadingUpcomingGlobal && <p className="dim" style={{ padding: '10px 2px' }}>Loading upcoming titles…</p>}
          {!loadingUpcomingGlobal && upcomingGlobal && upcomingGlobal.length === 0 && (
            <EmptyState text="Couldn't load upcoming titles right now." cta="Try again in a moment" />
          )}
          {!loadingUpcomingGlobal && upcomingGlobal && upcomingGlobal.length > 0 && (() => {
            const q = upcomingQuery.trim().toLowerCase();
            const filtered = q ? upcomingGlobal.filter(r => r.title.toLowerCase().includes(q)) : upcomingGlobal;
            if (filtered.length === 0) return <p className="dim" style={{ padding: '10px 2px' }}>No upcoming titles match "{upcomingQuery}".</p>;
            return (
              <UpcomingTimeline rows={filtered.map(r => ({
                id: r.externalId,
                title: r.title,
                posterUrl: r.posterUrl,
                icon: TYPE_META[r.type].icon,
                metaLine: r.extraNote,
                dateLine: r.releaseDate ? formatDateGr(r.releaseDate) : null,
                days: r.releaseDate ? daysUntil(r.releaseDate) : null,
                onOpen: () => openResult(r),
              }))} />
            );
          })()}
        </div>
      )}

      {activeResult && (
        <ResultDetailSheet
          key={activeResult.externalId}
          result={activeResult}
          items={items}
          onClose={closeResult}
          onAdd={handleAddFromResult}
          onOpenEpisodes={onOpenEpisodes}
          onQuickAdd={onQuickAdd}
          onOpenResult={openResult}
        />
      )}
    </div>
  );
}

/* ---------------------------------- My Shows ---------------------------------- */

const SORT_OPTIONS = [
  { key: 'recent', label: 'Recent' },
  { key: 'rating', label: 'Rating' },
  { key: 'alpha', label: 'A–Z' },
];

function sortItems(list, sortBy) {
  const copy = [...list];
  if (sortBy === 'rating') return copy.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  if (sortBy === 'alpha') return copy.sort((a, b) => a.title.localeCompare(b.title));
  return copy.sort((a, b) => (b.dateWatched || b.dateAdded || '').localeCompare(a.dateWatched || a.dateAdded || ''));
}

// Search scoped to one type, used from My Shows' "+" — only real, verified titles from
// the database can be added here; nothing freeform or unconfirmed.
function TypeSearchSheet({ type, items, onClose, onQuickAdd, onOpenEpisodes, onDelete }) {
  useBodyScrollLock();
  const meta = TYPE_META[type];
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [resultStack, setResultStack] = useState([]);
  const activeResult = resultStack.length > 0 ? resultStack[resultStack.length - 1] : null;
  const openResult = (result) => setResultStack(stack => [...stack, result]);
  const closeResult = () => setResultStack(stack => stack.slice(0, -1));
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults(null); setSearching(false); setError(''); return; }
    setSearching(true); setError('');
    debounceRef.current = setTimeout(async () => {
      try {
        const fn = type === 'movie' ? searchMovieDB : type === 'series' ? searchSeriesDB : searchAnimeDB;
        const r = await fn(q);
        setResults(r);
      } catch (e) {
        setError("Couldn't search right now — try again in a moment.");
        setResults(null);
      } finally { setSearching(false); }
    }, 450);
    return () => clearTimeout(debounceRef.current);
  }, [query, type]);

  const handleAdd = (detail, status) => {
    onQuickAdd(detail, status);
    setResultStack([]);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="chip" style={{ '--c': meta.color }}>{meta.singular}</span>
          <button className="icon-x" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="search-box">
          <Search size={16} />
          <input
            placeholder={`Search for a real ${meta.singular.toLowerCase()} title…`}
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          {searching && <Loader2 size={15} className="spin" />}
        </div>

        {error && <p className="inline-error" style={{ marginTop: 10 }}>{error}</p>}

        {query.trim().length >= 2 && !searching && results && results.length === 0 && !error && (
          <p className="dim" style={{ padding: '12px 2px' }}>
            No {meta.singular.toLowerCase()} found with that name — check the spelling and try again. Only real, verified titles can be added.
          </p>
        )}

        {results && results.length > 0 && (
          <div className="result-list" style={{ marginTop: 14 }}>
            {results.map(r => {
              const matched = items.find(i => i.externalId === r.externalId && i.type === r.type);
              return (
                <ResultRow
                  key={r.externalId}
                  result={r}
                  inLibrary={!!matched}
                  libraryItemId={matched ? matched.id : null}
                  onOpen={openResult}
                  onQuickAdd={(res, status) => handleAdd(res, status)}
                  onRemoveFromLibrary={onDelete}
                />
              );
            })}
          </div>
        )}
      </div>

      {activeResult && (
        <ResultDetailSheet
          key={activeResult.externalId}
          result={activeResult}
          items={items}
          onClose={closeResult}
          onAdd={handleAdd}
          onOpenEpisodes={onOpenEpisodes}
          onQuickAdd={onQuickAdd}
          onOpenResult={openResult}
        />
      )}
    </div>
  );
}

function MyShowsScreen({ items, onOpen, onQuickAdd, onOpenEpisodes, onDelete, onAdvanceEpisode, onMarkAllWatched }) {
  const [activeType, setActiveType] = useState('movie');
  const [sortBy, setSortBy] = useState('recent');
  const [searchOpen, setSearchOpen] = useState(false);
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  const [upcomingList, setUpcomingList] = useState(null);
  const [loadingUpcoming, setLoadingUpcoming] = useState(false);
  const meta = TYPE_META[activeType];
  const filtered = items.filter(i => i.type === activeType);
  const groups = ['watching', 'planned', 'completed'].map(st => ({
    status: st,
    list: sortItems(filtered.filter(i => i.status === st), sortBy),
  }));

  const openUpcoming = async () => {
    setUpcomingOpen(true);
    setLoadingUpcoming(true);
    const candidates = items.filter(i => i.status === 'watching' || i.status === 'planned');
    try {
      const list = await fetchUpcomingForItems(candidates);
      setUpcomingList(list);
    } catch (e) { setUpcomingList([]); }
    setLoadingUpcoming(false);
  };

  return (
    <div className="screen">
      <h1 className="page-title" style={{ '--c': '#7ED957' }}>My Shows</h1>

      <div className="upcoming-row">
        <button
          className={`upcoming-circle ${upcomingOpen ? 'active' : ''}`}
          onClick={() => upcomingOpen ? setUpcomingOpen(false) : openUpcoming()}
        >
          {upcomingList && upcomingList.length > 0 && !upcomingOpen && <span className="upcoming-badge">{upcomingList.length}</span>}
          <CalendarDays size={19} />
          <span>Upcoming</span>
        </button>
      </div>

      {upcomingOpen ? (
        <div className="group">
          {loadingUpcoming && <p className="dim" style={{ padding: '10px 2px' }}>Checking what's coming up…</p>}
          {!loadingUpcoming && upcomingList && upcomingList.length === 0 && (
            <EmptyState text="Nothing upcoming right now." cta="Shows you're watching or plan to watch will show here once dates are announced" />
          )}
          {!loadingUpcoming && upcomingList && upcomingList.length > 0 && (
            <UpcomingTimeline rows={upcomingList.map(u => ({
              id: u.item.id,
              title: u.item.title,
              posterUrl: u.item.posterUrl,
              icon: TYPE_META[u.item.type].icon,
              metaLine: u.label,
              dateLine: null,
              days: u.days,
              onOpen: () => onOpen(u.item),
            }))} />
          )}
        </div>
      ) : (
        <>
          <div className="type-tiles">
            {TYPE_ORDER.map(t => {
              const tMeta = TYPE_META[t];
              const Icon = tMeta.icon;
              const count = items.filter(i => i.type === t).length;
              return (
                <button
                  key={t}
                  className={`type-tile ${activeType === t ? 'active' : ''}`}
                  style={{ '--c': tMeta.color }}
                  onClick={() => setActiveType(t)}
                >
                  <Icon size={22} />
                  <span>{tMeta.label}</span>
                  <span className="type-tile-count">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="myshows-list-head">
            <span className="group-title" style={{ color: meta.color, margin: 0 }}>{meta.label} you've added</span>
            <button className="add-btn" style={{ '--c': meta.color }} onClick={() => setSearchOpen(true)}><Plus size={18} /></button>
          </div>

          {filtered.length > 0 && (
            <div className="sort-row">
              {SORT_OPTIONS.map(s => (
                <button key={s.key} className={`sort-btn ${sortBy === s.key ? 'active' : ''}`} onClick={() => setSortBy(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {filtered.length === 0 ? (
            <EmptyState text={`You haven't added any ${meta.singular.toLowerCase()} yet.`} cta="Tap + to search for it" />
          ) : (
            groups.map(g => g.list.length > 0 && (
              <div className="group" key={g.status}>
                <div className="group-title" style={{ color: STATUS_META[g.status].color }}>
                  {STATUS_META[g.status].label} · {g.list.length}
                </div>
                <div className="item-list">
                  {g.list.map(it => (
                    <SwipeableItemRow
                      key={it.id}
                      item={it}
                      onClick={() => onOpen(it)}
                      onDelete={onDelete}
                      onAdvanceEpisode={onAdvanceEpisode}
                      onMarkAllWatched={onMarkAllWatched}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}

      {searchOpen && (
        <TypeSearchSheet
          type={activeType}
          items={items}
          onClose={() => setSearchOpen(false)}
          onQuickAdd={onQuickAdd}
          onOpenEpisodes={onOpenEpisodes}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

function AccordionSection({ title, accentColor, defaultOpen, children }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="im-card">
      <div className="im-card-accent" style={{ background: accentColor }} />
      <button className="accordion-header" onClick={() => setOpen(o => !o)}>
        <span className="im-card-label" style={{ margin: 0 }}>{title}</span>
        <ChevronDown size={16} className={`accordion-chevron ${open ? 'open' : ''}`} />
      </button>
      {open && <div className="accordion-body">{children}</div>}
    </div>
  );
}

function SettingsSheet({ onClose, appearanceMode, onSetAppearanceMode, session, onExport, onImportClick, importMsg }) {
  useBodyScrollLock();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="chip" style={{ '--c': '#7ED957' }}>Settings</span>
          <button className="icon-x" onClick={onClose}><X size={18} /></button>
        </div>

        <AccordionSection title="Appearance" accentColor="#8892B0" defaultOpen>
          <div className="appearance-mode-list">
            {APPEARANCE_MODES.map(m => (
              <button
                key={m.key}
                className={`appearance-mode-btn ${appearanceMode === m.key ? 'active' : ''}`}
                onClick={() => onSetAppearanceMode(m.key)}
              >
                <span className="seg-dot" style={{ background: appearanceMode === m.key ? '#7ED957' : 'var(--muted)', opacity: appearanceMode === m.key ? 1 : 0.4 }} />
                {m.label}
              </button>
            ))}
          </div>
          <p className="dim" style={{ marginTop: 10 }}>
            Dark and White mode keep posters, cover art, and colored labels in their real colors — only plain navigation/menu chrome turns neutral. Neon boosts saturation across the app.
          </p>
        </AccordionSection>

        <AccordionSection title="Account status" accentColor="#7ED957">
          {session ? (
            <div className="cloud-status" style={{ marginBottom: 0 }}>
              <CheckCircle2 size={15} />
              <span>Connected as {session.user.email}</span>
            </div>
          ) : (
            <p className="dim">Not connected to Google — your library lives on this device only.</p>
          )}
        </AccordionSection>

        <AccordionSection title="Backup" accentColor="#F5A623">
          <div className="backup-row" style={{ marginTop: 0 }}>
            <button className="backup-btn" onClick={onExport}>
              <Ticket size={14} /> Export backup
            </button>
            <button className="backup-btn" onClick={onImportClick}>
              <ListChecks size={14} /> Import backup
            </button>
          </div>
          {importMsg && <p className="dim" style={{ textAlign: 'center', marginTop: 8 }}>{importMsg}</p>}
        </AccordionSection>

        <AccordionSection title="Help" accentColor="#4FA8FF">
          <p className="im-description">Need a hand with something? Send us a message and we'll get back to you.</p>
          <a
            className="report-bug-link"
            style={{ marginTop: 10 }}
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Playbin Help')}`}
          >
            <Flame size={14} /> Contact support
          </a>
        </AccordionSection>
      </div>
    </div>
  );
}

function AccountScreen({ items, onOpen, profileName, onSaveName, onImport, session, onSignIn, onSignOut, appearanceMode, onSetAppearanceMode }) {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(profileName || '');
  const [importMsg, setImportMsg] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => { setNameDraft(profileName || ''); }, [profileName]);

  const totalMinutes = items.reduce((sum, it) => sum + computeMinutes(it), 0);
  const t = formatWatchTime(totalMinutes);

  const byType = TYPE_ORDER.map(type => {
    const mins = items.filter(i => i.type === type).reduce((s, i) => s + computeMinutes(i), 0);
    return { type, hours: Math.round((mins / 60) * 10) / 10 };
  });

  const history = items
    .filter(i => i.dateWatched)
    .sort((a, b) => b.dateWatched.localeCompare(a.dateWatched))
    .slice(0, 25);

  const commitName = () => {
    setEditing(false);
    onSaveName(nameDraft.trim());
  };

  const exportBackup = () => {
    const payload = { items, profile: { name: profileName || '' }, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `playbin-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.items)) throw new Error('bad file');
        onImport(data);
        setImportMsg(`Imported ${data.items.length} titles.`);
      } catch (err) {
        setImportMsg("Couldn't read that file — make sure it's a Playbin backup.");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="screen">
      <div className="account-title-row">
        <h1 className="page-title" style={{ '--c': '#7ED957', margin: 0 }}>Account</h1>
        <button className="settings-gear-btn" onClick={() => setSettingsOpen(true)}><SettingsIcon size={19} /></button>
      </div>
      <div style={{ height: 16 }} />

      {session ? (
        <div className="cloud-status">
          <CheckCircle2 size={15} />
          <span>Synced as {session.user.email}</span>
          <button onClick={onSignOut}>Sign out</button>
        </div>
      ) : (
        <button className="google-signin-btn" onClick={onSignIn}>
          <span className="google-g">G</span>
          Sign in with Google — sync across devices
        </button>
      )}

      <div className="profile-card">
        <div className="profile-avatar"><CircleUserRound size={26} /></div>
        {editing ? (
          <div className="profile-edit-row">
            <input
              className="profile-input"
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              placeholder="Your name..."
              autoFocus
              onKeyDown={e => e.key === 'Enter' && commitName()}
            />
            <button className="profile-ok" onClick={commitName}><Check size={16} /></button>
          </div>
        ) : (
          <button className="profile-name-btn" onClick={() => setEditing(true)}>
            <span>{profileName ? profileName : 'Add your name'}</span>
            <Pencil size={13} />
          </button>
        )}
      </div>

      <div className="time-card">
        <div className="time-card-label">Total watch time</div>
        <div className="time-breakdown">
          {t.years > 0 && <TimeChip n={t.years} u="years" />}
          {(t.years > 0 || t.months > 0) && <TimeChip n={t.months} u="months" />}
          <TimeChip n={t.days} u="days" />
          <TimeChip n={t.hours} u="hours" />
        </div>
        <div className="time-total">≈ {t.totalHours} hours total</div>
      </div>

      <div className="type-breakdown">
        {byType.map(({ type, hours }) => {
          const tMeta = TYPE_META[type];
          const Icon = tMeta.icon;
          return (
            <div className="type-stat" key={type} style={{ '--c': tMeta.color }}>
              <Icon size={18} />
              <span className="type-stat-h">{hours}h</span>
              <span className="type-stat-l">{tMeta.label}</span>
            </div>
          );
        })}
      </div>

      <div className="group-title" style={{ color: '#7ED957' }}>History</div>
      {history.length === 0 ? (
        <EmptyState text="No history yet." cta="Anything you mark as Watching or Watched will show up here" />
      ) : (
        <div className="item-list">
          {history.map(it => (
            <button className="item-row" key={it.id} onClick={() => onOpen(it)}>
              <Poster item={it} size={42} />
              <div className="item-info">
                <div className="item-title">{it.title}</div>
                <div className="item-meta">
                  <span className="chip" style={{ '--c': TYPE_META[it.type].color }}>{TYPE_META[it.type].singular}</span>
                  <span className="dim">{timeAgo(it.dateWatched)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={handleImportFile} />

      <a
        className="report-bug-link"
        href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Playbin Bug Report')}&body=${encodeURIComponent('Describe what happened:\n\n\nWhat did you expect to happen instead?\n\n')}`}
      >
        <Flame size={14} /> Report a bug
      </a>

      {settingsOpen && (
        <SettingsSheet
          onClose={() => setSettingsOpen(false)}
          appearanceMode={appearanceMode}
          onSetAppearanceMode={onSetAppearanceMode}
          session={session}
          onExport={exportBackup}
          onImportClick={() => fileInputRef.current && fileInputRef.current.click()}
          importMsg={importMsg}
        />
      )}
    </div>
  );
}

function TimeChip({ n, u }) {
  return (
    <div className="time-chip">
      <span className="time-chip-n">{n}</span>
      <span className="time-chip-u">{u}</span>
    </div>
  );
}

/* ---------------------------------- Add / Edit modal ---------------------------------- */

function ItemModal({ draft, onClose, onSave, onDelete, onOpenEpisodes, onQuickAdd, items }) {
  useBodyScrollLock();
  const [form, setForm] = useState(draft);
  const meta = TYPE_META[form.type];
  const isEpisodic = form.type !== 'movie';
  const isNew = !draft.id || draft.__isNew;
  const isFromDb = !!form.externalId;
  const dbId = (form.externalId || '').split('-').slice(1).join('-');

  // Tapping a "You might also like" card opens it here, on top of this modal — a small
  // stack so going a level deeper (that title's own recommendations) and back works
  // the same way it does from Discover, instead of just closing everything.
  const [similarStack, setSimilarStack] = useState([]);
  const activeSimilarResult = similarStack.length > 0 ? similarStack[similarStack.length - 1] : null;
  const openSimilarResult = (result) => setSimilarStack(stack => [...stack, result]);
  const closeSimilarResult = () => setSimilarStack(stack => stack.slice(0, -1));

  // Items added before Description/Notes were split out still have the show's own
  // synopsis sitting in "notes" — treat that as the description, and show Notes as
  // empty until the person actually writes something, rather than asking them to
  // delete and re-add anything.
  const legacySummaryInNotes = isFromDb && !form.summary && !!form.notes;
  const displaySummary = form.summary || (legacySummaryInNotes ? form.notes : '');

  const [seasons, setSeasons] = useState(null);
  const [loadingSeasons, setLoadingSeasons] = useState(false);
  const [similar, setSimilar] = useState(null);
  const [addedSimilar, setAddedSimilar] = useState(() => new Set());
  const watchedSet = new Set(form.watchedEpisodeIds || []);

  useEffect(() => {
    if (isFromDb) {
      let cancelled = false;
      fetchSimilarTitles(form).then(r => { if (!cancelled) setSimilar(r); }).catch(() => {});
      return () => { cancelled = true; };
    }
  }, [form.id]);

  useEffect(() => {
    if (isFromDb && form.type !== 'movie' && dbId) {
      let cancelled = false;
      setLoadingSeasons(true);
      fetchSeasonsFor(form).then(r => { if (!cancelled) setSeasons(r); })
        .catch(() => {}).finally(() => { if (!cancelled) setLoadingSeasons(false); });
      return () => { cancelled = true; };
    }
  }, [form.id]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const persistNow = (updated) => {
    const now = new Date().toISOString();
    onSave({
      ...updated,
      title: updated.title.trim(),
      dateAdded: updated.dateAdded || now,
      dateWatched: (updated.status === 'watching' || updated.status === 'completed') ? (updated.dateWatched || now) : updated.dateWatched,
      id: updated.id || uid(),
    });
  };

  // For anything already in the library, every change saves immediately — no separate
  // "Save" tap needed anywhere in this screen. Only a brand-new, not-yet-added item
  // still needs an explicit Save (that's the "add it" action).
  const setAndPersist = (k, v) => {
    const updated = { ...form, [k]: v };
    setForm(updated);
    if (!isNew) persistNow(updated);
  };

  // Picking "Watched" for a series/anime checks off every episode too, instead of
  // leaving the status and checklist out of sync with each other.
  const handleStatusChange = (k) => {
    let updated = { ...form, status: k };
    if (k === 'completed' && isEpisodic) {
      if (isFromDb && seasons && seasons.length > 0) {
        const allIds = seasons.flatMap(s => s.episodes.map(e => e.id));
        updated = { ...updated, watchedEpisodeIds: allIds, totalEpisodes: allIds.length || form.totalEpisodes };
      } else if (!isFromDb) {
        updated = { ...updated, episodesWatched: form.totalEpisodes || form.episodesWatched };
      }
    }
    setForm(updated);
    if (!isNew) persistNow(updated);
  };


  const save = () => {
    if (!form.title.trim()) return;
    persistNow(form);
  };

  const statusColor = STATUS_META[form.status].color;
  const hoursValue = ((Number(form.movieMinutes) || TYPE_META.movie.defaultMinutes) / 60).toFixed(1);
  const setHours = (v) => setAndPersist('movieMinutes', Math.max(0, Math.round(parseFloat(v || 0) * 60)));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal item-modal-v2" style={{ '--c': meta.color }} onClick={e => e.stopPropagation()}>
        <div className="im-glow" style={{ background: `radial-gradient(circle, color-mix(in srgb, ${meta.color} 35%, transparent), transparent 70%)` }} />
        <div className="modal-head">
          <span className="chip" style={{ '--c': meta.color }}>{meta.singular}</span>
          <button className="icon-x" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="im-hero">
          <div className="im-hero-poster">
            {form.posterUrl ? <img src={form.posterUrl} alt="" /> : (form.emoji ? <span>{form.emoji}</span> : <meta.icon size={26} />)}
          </div>
          <div className="im-hero-info">
            {isFromDb ? (
              <div className="im-title">{form.title}</div>
            ) : (
              <input
                className="im-title-input"
                placeholder="Title..."
                value={form.title}
                onChange={e => set('title', e.target.value)}
                autoFocus
              />
            )}
            {isFromDb && <ExternalStars value={form.externalRating} source={form.externalRatingSource} size={13} />}
          </div>
        </div>

        {!isFromDb && (
          <div className="emoji-row">
            {EMOJI_SETS[form.type].map(e => (
              <button key={e} className={`emoji-btn ${form.emoji === e ? 'active' : ''}`}
                style={{ '--c': meta.color }} onClick={() => set('emoji', e)}>{e}</button>
            ))}
          </div>
        )}

        <div className="im-card">
          <div className="im-card-accent" style={{ background: statusColor }} />
          <div className="im-card-label">Status</div>
          <div className="segmented">
            {Object.entries(STATUS_META).map(([k, sm]) => (
              <button key={k} className={`seg-btn ${form.status === k ? 'active' : ''}`}
                style={{ '--c': sm.color }} onClick={() => handleStatusChange(k)}>
                <span className="seg-dot" style={{ background: sm.color, opacity: form.status === k ? 1 : 0.45 }} />
                {sm.short}
              </button>
            ))}
          </div>

          {isEpisodic && !isFromDb && (
            <div className="im-inline-row two">
              <div>
                <div className="im-inline-label">Watched</div>
                <input type="number" min="0" value={form.episodesWatched ?? 0}
                  onChange={e => setAndPersist('episodesWatched', e.target.value)} />
              </div>
              <div>
                <div className="im-inline-label">Total (optional)</div>
                <input type="number" min="0" value={form.totalEpisodes ?? ''}
                  onChange={e => setAndPersist('totalEpisodes', e.target.value)} />
              </div>
            </div>
          )}
          {!isEpisodic && (
            <div className="im-inline-row">
              <span className="im-inline-label" style={{ margin: 0 }}>Runtime</span>
              <div className="im-runtime-input">
                <input type="number" step="0.1" min="0" value={hoursValue} onChange={e => setHours(e.target.value)} />
                <span>hrs</span>
              </div>
            </div>
          )}
        </div>

        {/* Episodes live right here, inline — no extra tap to reach them. Works the same
            way for series (real seasons) and anime (seasons grouped by air year). */}
        {isEpisodic && isFromDb && (
          <div className="im-card">
            <div className="im-card-accent" style={{ background: meta.color }} />
            <div className="im-card-label">Episodes</div>
            {loadingSeasons && <p className="dim" style={{ padding: '2px 2px 4px' }}>Loading seasons…</p>}
            {seasons && seasons.length > 0 && (
              <div className="item-list">
                {seasons.map(s => (
                  <SeasonRow key={s.seasonNumber} season={s} watchedSet={watchedSet} onOpen={() => onOpenEpisodes(form, s)} />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="im-card">
          <div className="im-card-accent" style={{ background: '#F5A623' }} />
          <div className="im-card-top">
            <div className="im-card-label" style={{ margin: 0 }}>Your rating</div>
            <div className="im-rating-value">{form.rating || '–'}<span>/10</span></div>
          </div>
          <div className="rating-row">
            {Array.from({ length: 10 }).map((_, i) => {
              const val = i + 1;
              return (
                <button key={val} className="rate-dot" onClick={() => setAndPersist('rating', form.rating === val ? null : val)}>
                  <Star size={17} fill={form.rating >= val ? '#F5A623' : 'none'} stroke={form.rating >= val ? '#F5A623' : '#4A5178'} />
                </button>
              );
            })}
          </div>
        </div>

        {isFromDb && displaySummary && (
          <div className="im-card">
            <div className="im-card-accent" style={{ background: '#4FA8FF' }} />
            <div className="im-card-label">Description</div>
            <p className="im-description">{displaySummary}</p>
          </div>
        )}

        <div className="im-card">
          <div className="im-card-accent" style={{ background: meta.color }} />
          <div className="im-card-label">Notes</div>
          <textarea rows={2} placeholder="Your own thoughts, optional..." value={legacySummaryInNotes ? '' : (form.notes || '')}
            onChange={e => set('notes', e.target.value)}
            onBlur={() => { if (!isNew) persistNow(form); }} />
        </div>

        <div className="modal-actions">
          {isNew ? (
            <button className="save-btn" style={{ '--c': meta.color }} onClick={save} disabled={!form.title.trim()}>
              Save
            </button>
          ) : (
            <button className="danger-btn danger-btn-wide" onClick={() => onDelete(form.id)}>
              <Trash2 size={16} /> Delete
            </button>
          )}
        </div>

        {isFromDb && similar && similar.length > 0 && (
          <div className="im-similar-section">
            <div className="im-card-label" style={{ marginTop: 4 }}>You might also like</div>
            <div className="similar-scroll">
              {similar.map(s => {
                const already = addedSimilar.has(s.externalId);
                return (
                  <div key={s.externalId} className="similar-card" onClick={() => openSimilarResult(s)}>
                    <div className="similar-poster">
                      {s.posterUrl ? <img src={s.posterUrl} alt="" /> : <Film size={18} />}
                    </div>
                    <div className="similar-title">{s.title}</div>
                    <button
                      className="similar-add"
                      disabled={already}
                      onClick={(e) => { e.stopPropagation(); onQuickAdd(s, 'planned'); setAddedSimilar(prev => new Set(prev).add(s.externalId)); }}
                    >
                      {already ? <Check size={13} /> : <Plus size={13} />}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeSimilarResult && (
          <ResultDetailSheet
            key={activeSimilarResult.externalId}
            result={activeSimilarResult}
            items={items || []}
            onClose={closeSimilarResult}
            onAdd={(detail, status) => { onQuickAdd(detail, status); setSimilarStack([]); }}
            onOpenEpisodes={onOpenEpisodes}
            onQuickAdd={onQuickAdd}
            onOpenResult={openSimilarResult}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- Bottom nav ---------------------------------- */

/* ---------------------------------- Episodes tracker ---------------------------------- */

function EpisodeRow({ ep, watched, onToggle }) {
  return (
    <button className="ep-row" onClick={() => onToggle(ep.id)}>
      <div className="ep-row-text">
        <div className="ep-row-title">{ep.name || `Episode ${ep.number}`}</div>
        <div className="ep-row-sub">{ep.airdate ? formatDateGr(ep.airdate) : ''}</div>
      </div>
      <span className={`ep-check ${watched ? 'checked' : ''}`}>{watched && <Check size={13} />}</span>
    </button>
  );
}

function seasonLabel(season) {
  if (season.seasonTitle) return `Season ${season.seasonNumber} — ${season.seasonTitle}`;
  if (season.seasonNumber === 'Unscheduled') return 'Unscheduled';
  if (season.seasonNumber === 0) return 'Specials';
  return `Season ${season.seasonNumber}`;
}

function SeasonRow({ season, watchedSet, onOpen }) {
  const total = season.episodes.length;
  const watched = season.episodes.filter(e => watchedSet.has(e.id)).length;
  const pct = total ? Math.round((watched / total) * 100) : 0;
  return (
    <button className="season-row" onClick={() => onOpen(season)}>
      <div className="season-row-text">
        <div className="season-row-title">{seasonLabel(season)}</div>
        <div className="season-bar"><div className="season-bar-fill" style={{ width: `${pct}%` }} /></div>
      </div>
      <span className="season-count">{watched}/{total}</span>
      <span className="episodes-btn-arrow">›</span>
    </button>
  );
}

function EpisodesSheet({ item, initialSeason, onClose, onToggle, onToggleMany, onEditInfo }) {
  useBodyScrollLock();
  const [seasons, setSeasons] = useState(null);
  const [loading, setLoading] = useState(!initialSeason);
  const [error, setError] = useState('');
  const [activeSeason, setActiveSeason] = useState(initialSeason || null);
  const [confirmData, setConfirmData] = useState(null); // { epId, precedingIds }
  const watchedSet = new Set(item.watchedEpisodeIds || []);
  const cameWithPreset = !!initialSeason; // opened straight from a season row picked in the modal — no "back to seasons" step here

  useEffect(() => {
    let cancelled = false;
    if (!initialSeason) {
      setLoading(true); setError('');
      fetchSeasonsFor(item).then(r => {
        if (cancelled) return;
        setSeasons(r);
      }).catch(() => !cancelled && setError('No episodes found right now.')).finally(() => !cancelled && setLoading(false));
    }
    return () => { cancelled = true; };
  }, [item.id]);

  const episodeList = activeSeason ? activeSeason.episodes : [];
  const showingEpisodeList = !!activeSeason;

  // Tapping an episode to check it: if earlier episodes in this same list are still
  // unwatched, ask whether to catch those up too, instead of silently skipping them.
  const handleEpisodeTap = (epId) => {
    if (watchedSet.has(epId)) { onToggle(epId); return; } // unchecking — no need to ask anything
    const idx = episodeList.findIndex(e => e.id === epId);
    const precedingIds = episodeList.slice(0, idx).filter(e => !watchedSet.has(e.id)).map(e => e.id);
    if (precedingIds.length > 0) {
      setConfirmData({ epId, precedingIds });
    } else {
      onToggle(epId);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal detail-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <button className="icon-x" onClick={() => (activeSeason && !cameWithPreset ? setActiveSeason(null) : onClose())}>
            {activeSeason && !cameWithPreset ? <ArrowLeft size={18} /> : <X size={18} />}
          </button>
          <span className="chip" style={{ '--c': TYPE_META[item.type].color }}>
            {activeSeason ? seasonLabel(activeSeason) : item.title}
          </span>
          {!activeSeason && onEditInfo && (
            <button className="mark-all-btn" onClick={() => onEditInfo(item)}><Pencil size={14} /></button>
          )}
          {showingEpisodeList && episodeList.length > 0 && (
            <button className="mark-all-btn" onClick={() => onToggleMany(episodeList.map(e => e.id), !episodeList.every(e => watchedSet.has(e.id)))}>
              <ListChecks size={15} />
            </button>
          )}
        </div>

        {loading && <p className="dim" style={{ padding: '20px 2px' }}>Loading episodes…</p>}
        {error && <p className="inline-error">{error}</p>}

        {!loading && !error && !showingEpisodeList && seasons && (
          <div className="item-list">
            {seasons.map(s => (
              <SeasonRow key={s.seasonNumber} season={s} watchedSet={watchedSet} onOpen={setActiveSeason} />
            ))}
          </div>
        )}

        {!loading && !error && showingEpisodeList && (
          <div className="item-list">
            {episodeList.map(ep => (
              <EpisodeRow key={ep.id} ep={ep} watched={watchedSet.has(ep.id)} onToggle={handleEpisodeTap} />
            ))}
          </div>
        )}

        {confirmData && (
          <div className="confirm-overlay" onClick={() => setConfirmData(null)}>
            <div className="confirm-box" onClick={e => e.stopPropagation()}>
              <p>Along with this one, mark the {confirmData.precedingIds.length} earlier episodes as watched too?</p>
              <div className="confirm-actions">
                <button className="confirm-no" onClick={() => { onToggle(confirmData.epId); setConfirmData(null); }}>
                  No, just this one
                </button>
                <button className="confirm-yes" onClick={() => { onToggleMany([...confirmData.precedingIds, confirmData.epId], true); setConfirmData(null); }}>
                  Yes, all of them
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- Bottom nav ---------------------------------- */

function BottomNav({ view, onNav }) {
  return (
    <div className="bottom-nav">
      <button className={`nav-btn ${view === 'myshows' ? 'active' : ''}`} style={{ '--c': '#7ED957' }} onClick={() => onNav('myshows')}>
        <LayoutList size={20} />
        <span>My Shows</span>
      </button>
      <button className={`nav-btn nav-center ${view === 'discover' ? 'active' : ''}`} style={{ '--c': '#7ED957' }} onClick={() => onNav('discover')}>
        <span className="nav-center-circle"><Search size={20} /></span>
        <span>Discover</span>
      </button>
      <button className={`nav-btn ${view === 'account' ? 'active' : ''}`} style={{ '--c': '#7ED957' }} onClick={() => onNav('account')}>
        <CircleUserRound size={20} />
        <span>Account</span>
      </button>
    </div>
  );
}

/* ---------------------------------- App root ---------------------------------- */

export default function App() {
  const [booted, setBooted] = useState(false);
  const [items, setItems] = useState([]);
  const [profile, setProfile] = useState({ name: '' });
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('discover');
  // Tapping the nav icon for the screen you're already on resets it (closes any
  // sub-view like "Upcoming", clears an in-progress search) instead of doing nothing.
  const [resetTick, setResetTick] = useState({ discover: 0, myshows: 0, account: 0 });
  const handleNav = (v) => {
    if (v === view) setResetTick(t => ({ ...t, [v]: t[v] + 1 }));
    else setView(v);
  };
  const [modal, setModal] = useState(null);
  const [episodesItem, setEpisodesItem] = useState(null);
  const [presetSeason, setPresetSeason] = useState(null);
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appearanceMode, setAppearanceModeState] = useState('normal');
  useEffect(() => { setAppearanceModeState(storageGet(APPEARANCE_MODE_KEY, 'normal')); }, []);
  const setAppearanceMode = (mode) => {
    setAppearanceModeState(mode);
    storageSet(APPEARANCE_MODE_KEY, mode);
  };
  const [maintenance, setMaintenance] = useState(null); // null = still checking, or {message} when on

  // Checked once on load — flip app_config.maintenance_mode in Supabase any time to
  // take the app offline for everyone instantly, no redeploy needed.
  useEffect(() => {
    if (!supabaseClient) { setMaintenance(false); return; }
    supabaseClient.from('app_config').select('maintenance_mode, maintenance_message').eq('id', 1).maybeSingle()
      .then(({ data }) => {
        if (data && data.maintenance_mode) setMaintenance({ message: data.maintenance_message });
        else setMaintenance(false);
      })
      .catch(() => setMaintenance(false)); // if the check itself fails, don't lock people out
  }, []);

  // Watch for sign-in / sign-out, including the moment the Google redirect completes.
  useEffect(() => {
    if (!supabaseClient) { setAuthChecked(true); return; }
    supabaseClient.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthChecked(true);
    });
    const { data: listener } = supabaseClient.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Loads from Supabase when signed in, from localStorage otherwise. The first time
  // someone signs in with an empty cloud library, their local one is copied up once —
  // nothing is ever deleted locally, so there's no way to lose data by signing in.
  useEffect(() => {
    if (!authChecked) return;
    let cancelled = false;
    setLoaded(false);
    (async () => {
      if (session) {
        let cloudItems = await loadItemsCloud(session.user.id);
        if (cloudItems.length === 0) {
          const localItems = await loadItems();
          if (localItems.length > 0) {
            await saveItemsCloud(session.user.id, localItems);
            cloudItems = localItems;
          }
        }
        const cloudProfile = await loadProfileCloud(session.user.id);
        if (cancelled) return;
        setItems(cloudItems);
        setProfile(cloudProfile);
      } else {
        const [list, prof] = await Promise.all([loadItems(), loadProfile()]);
        if (cancelled) return;
        setItems(list);
        setProfile(prof || { name: '' });
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [session, authChecked]);

  const persist = useCallback((next) => {
    setItems(next);
    if (session) saveItemsCloud(session.user.id, next);
    else saveItems(next);
  }, [session]);

  const upsertItem = (item) => {
    const exists = items.some(i => i.id === item.id);
    const next = exists ? items.map(i => i.id === item.id ? item : i) : [...items, item];
    persist(next);
    setModal(null);
  };
  const deleteItem = (id) => { persist(items.filter(i => i.id !== id)); setModal(null); };

  // Toggling episodes writes straight to storage — no need to hit "Αποθήκευση" first.
  const toggleEpisodeWatched = (itemId, episodeId) => {
    const next = items.map(it => {
      if (it.id !== itemId) return it;
      const set = new Set(it.watchedEpisodeIds || []);
      set.has(episodeId) ? set.delete(episodeId) : set.add(episodeId);
      const watchedEpisodeIds = Array.from(set);
      // Checking off the last remaining episode finishes the show automatically —
      // no need to also flip the status picker by hand.
      const isNowComplete = it.totalEpisodes && watchedEpisodeIds.length >= it.totalEpisodes;
      return {
        ...it, watchedEpisodeIds,
        status: isNowComplete ? 'completed' : (watchedEpisodeIds.length > 0 && it.status === 'planned' ? 'watching' : it.status),
        dateWatched: new Date().toISOString(),
      };
    });
    persist(next);
    setModal(m => (m && m.id === itemId) ? { ...m, watchedEpisodeIds: next.find(i => i.id === itemId).watchedEpisodeIds, status: next.find(i => i.id === itemId).status } : m);
  };

  const toggleManyEpisodes = (itemId, episodeIds, markWatched) => {
    const next = items.map(it => {
      if (it.id !== itemId) return it;
      const set = new Set(it.watchedEpisodeIds || []);
      episodeIds.forEach(id => markWatched ? set.add(id) : set.delete(id));
      const watchedEpisodeIds = Array.from(set);
      const isNowComplete = it.totalEpisodes && watchedEpisodeIds.length >= it.totalEpisodes;
      return {
        ...it, watchedEpisodeIds,
        status: isNowComplete ? 'completed' : (watchedEpisodeIds.length > 0 && it.status === 'planned' ? 'watching' : it.status),
        dateWatched: new Date().toISOString(),
      };
    });
    persist(next);
  };

  // Swipe-right quick action #1: mark just the next unwatched episode as watched
  // (e.g. you're on 12 → this checks off 13), without opening the full checklist.
  const advanceOneEpisode = async (item) => {
    if (item.type === 'movie') return;
    if (!item.externalId) {
      const next = items.map(it => it.id === item.id
        ? { ...it, episodesWatched: (Number(it.episodesWatched) || 0) + 1, status: it.status === 'planned' ? 'watching' : it.status, dateWatched: new Date().toISOString() }
        : it);
      persist(next);
      return;
    }
    const watchedSet = new Set(item.watchedEpisodeIds || []);
    try {
      const seasons = await fetchSeasonsFor(item);
      const allIds = seasons.flatMap(s => s.episodes.map(e => e.id));
      const nextEp = allIds.find(id => !watchedSet.has(id));
      if (nextEp) toggleEpisodeWatched(item.id, nextEp);
    } catch (e) { /* couldn't reach the episode list — nothing to advance safely */ }
  };

  // Swipe-right quick action #2: mark the whole thing as fully watched.
  const quickMarkAllWatched = async (item) => {
    const now = new Date().toISOString();
    if (item.type === 'movie' || !item.externalId) {
      const next = items.map(it => it.id === item.id ? {
        ...it, status: 'completed', dateWatched: now,
        episodesWatched: it.type !== 'movie' ? (it.totalEpisodes || it.episodesWatched) : it.episodesWatched,
      } : it);
      persist(next);
      return;
    }
    try {
      const seasons = await fetchSeasonsFor(item);
      const watchedEpisodeIds = seasons.flatMap(s => s.episodes.map(e => e.id));
      const next = items.map(it => it.id === item.id ? {
        ...it, status: 'completed', watchedEpisodeIds,
        totalEpisodes: watchedEpisodeIds.length || it.totalEpisodes,
        dateWatched: now,
      } : it);
      persist(next);
    } catch (e) { /* couldn't reach the episode list — leave it as-is rather than guess */ }
  };

  const openNew = (type, prefill) => {
    setModal({
      __isNew: true, id: null, type, title: '', status: 'planned', rating: null,
      episodesWatched: 0, totalEpisodes: '', episodeMinutes: TYPE_META[type].defaultMinutes,
      movieMinutes: TYPE_META.movie.defaultMinutes, emoji: EMOJI_SETS[type][0],
      posterUrl: null, externalId: null, externalRating: null, externalRatingSource: null, watchedEpisodeIds: [],
      notes: '', dateAdded: null, dateWatched: null,
      ...(prefill || {}),
    });
  };
  const openExisting = (item) => setModal({ ...item });

  // One-tap add straight from a search result — mirrors the "Add Show / Add Movie" pattern,
  // no form to fill in. status defaults to 'planned' (from the row's quick-add +) but the
  // detail sheet can pass 'completed' for "I've watched it" straight away.
  const quickAddFromResult = async (result, status = 'planned') => {
    const type = TYPE_META[result.type] ? result.type : 'movie';
    const now = new Date().toISOString();
    const isEpisodic = type !== 'movie';
    let watchedEpisodeIds = [];
    // When a result represents multiple merged seasons, the individual result's own
    // "episodes" count only reflects its own season — leave the total unset until the
    // real merged episode list loads, rather than showing a misleadingly low number.
    let totalEpisodes = (result.mergedAnimeIds && result.mergedAnimeIds.length > 1) ? '' : (result.episodes || '');

    // Marking "I've watched it" on a series/anime should check off every real episode too —
    // fetch the actual episode IDs so the checklist inside My Shows lines up correctly.
    if (status === 'completed' && isEpisodic && result.externalId) {
      try {
        const seasons = await fetchSeasonsFor(result);
        watchedEpisodeIds = seasons.flatMap(s => s.episodes.map(e => e.id));
        if (watchedEpisodeIds.length) totalEpisodes = watchedEpisodeIds.length;
      } catch (e) { /* fine — item still saves as completed, episodes can be checked manually later */ }
    }

    const newItem = {
      id: uid(), type, title: result.title, status, rating: null,
      episodesWatched: 0, totalEpisodes,
      episodeMinutes: result.runtimeMinutes || TYPE_META[type].defaultMinutes,
      movieMinutes: result.runtimeMinutes || TYPE_META.movie.defaultMinutes,
      emoji: EMOJI_SETS[type][0],
      posterUrl: result.posterUrl || null,
      externalId: result.externalId,
      externalRating: result.ratingValue || null,
      externalRatingSource: result.ratingSource || null,
      watchedEpisodeIds,
      summary: result.summary || '', // the show's own synopsis — kept separate from the user's own notes
      notes: '',
      // Carries the full Sequel/Prequel chain forward so the item modal's episode list
      // (fetchSeasonsFor) can pull every season, not just the one that was searched.
      mergedAnimeIds: (result.mergedAnimeIds && result.mergedAnimeIds.length > 1) ? result.mergedAnimeIds : null,
      mergedAnimeMeta: (result.mergedAnimeMeta && result.mergedAnimeMeta.length > 1) ? result.mergedAnimeMeta : null,
      seasonCount: result.seasonCount || null,
      dateAdded: now, dateWatched: status === 'completed' ? now : null,
    };
    persist([...items, newItem]);
    return newItem;
  };

  // Tapping the episode checklist preview on a search result (before it's even in your
  // library) adds it as "Θέλω να το δω" first, then opens the real checklist for it.
  const openEpisodesFromResult = async (result, season) => {
    const existing = items.find(i => i.externalId === result.externalId && i.type === result.type);
    const item = existing || await quickAddFromResult(result, 'planned');
    setEpisodesItem(item);
    setPresetSeason(season || null);
  };

  const saveProfileName = (name) => {
    const next = { ...profile, name };
    setProfile(next);
    if (session) saveProfileCloud(session.user.id, next);
    else saveProfile(next);
  };

  const importBackup = (data) => {
    persist(data.items || []);
    const nextProfile = { name: (data.profile && data.profile.name) || profile.name };
    setProfile(nextProfile);
    if (session) saveProfileCloud(session.user.id, nextProfile);
    else saveProfile(nextProfile);
  };

  if (maintenance) {
    return (
      <div className="mw-root">
        <GlobalStyle />
        <div className="maintenance-screen">
          <Ticket size={36} className="maintenance-icon" />
          <h1>Playbin</h1>
          <p>{maintenance.message}</p>
        </div>
      </div>
    );
  }

  if (!booted) {
    return (
      <div className="mw-root">
        <GlobalStyle />
        <SplashScreen onDone={() => setBooted(true)} />
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="mw-root loading-root">
        <GlobalStyle />
        <Loader2 size={26} className="spin" color="#8892B0" />
      </div>
    );
  }

  return (
    <div className={`mw-root ${appearanceMode !== 'normal' ? `mode-${appearanceMode}` : ''}`}>
      <GlobalStyle />
      <div className="view-area">
        {view === 'discover' && (
          <DiscoverScreen
            key={resetTick.discover}
            items={items}
            onOpen={openExisting}
            onQuickAdd={quickAddFromResult}
            onOpenEpisodes={openEpisodesFromResult}
            onDelete={deleteItem}
            profileName={profile.name}
          />
        )}
        {view === 'myshows' && (
          <MyShowsScreen
            key={resetTick.myshows}
            items={items}
            onOpen={openExisting}
            onQuickAdd={quickAddFromResult}
            onOpenEpisodes={openEpisodesFromResult}
            onDelete={deleteItem}
            onAdvanceEpisode={advanceOneEpisode}
            onMarkAllWatched={quickMarkAllWatched}
          />
        )}
        {view === 'account' && (
          <AccountScreen
            key={resetTick.account}
            items={items}
            onOpen={openExisting}
            profileName={profile.name}
            onSaveName={saveProfileName}
            onImport={importBackup}
            session={session}
            onSignIn={signInWithGoogle}
            onSignOut={signOutCloud}
            appearanceMode={appearanceMode}
            onSetAppearanceMode={setAppearanceMode}
          />
        )}
      </div>

      <BottomNav view={view} onNav={handleNav} />

      {modal && (
        <ItemModal draft={modal} onClose={() => setModal(null)} onSave={upsertItem} onDelete={deleteItem}
          onOpenEpisodes={(item, season) => { setEpisodesItem(item); setPresetSeason(season || null); }}
          onQuickAdd={quickAddFromResult} items={items} />
      )}

      {episodesItem && (
        <EpisodesSheet
          item={items.find(i => i.id === episodesItem.id) || episodesItem}
          initialSeason={presetSeason}
          onClose={() => { setEpisodesItem(null); setPresetSeason(null); }}
          onToggle={(epId) => toggleEpisodeWatched(episodesItem.id, epId)}
          onToggleMany={(epIds, watched) => toggleManyEpisodes(episodesItem.id, epIds, watched)}
          onEditInfo={(item) => { setEpisodesItem(null); setPresetSeason(null); openExisting(item); }}
        />
      )}
    </div>
  );
}

/* ---------------------------------- global style ---------------------------------- */

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Fraunces:ital,wght@0,600;0,700;1,600;1,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap');

      .mw-root {
        --bg: #0B0E1A;
        --surface: #141833;
        --surface2: #1B2047;
        --border: #2A2F52;
        --text: #F2F0E9;
        --muted: #8892B0;
        font-family: 'Inter', system-ui, sans-serif;
        background: var(--bg);
        background-image: radial-gradient(circle at 15% 0%, rgba(126,217,87,0.10), transparent 45%),
                           radial-gradient(circle at 85% 100%, rgba(245,166,35,0.08), transparent 45%);
        color: var(--text);
        min-height: 100vh;
        width: 100%;
        box-sizing: border-box;
        position: relative;
      }
      .mw-root *, .mw-root *::before, .mw-root *::after { box-sizing: border-box; }
      .loading-root { display: flex; align-items: center; justify-content: center; height: 100vh; }
      .maintenance-screen { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 32px; text-align: center; }
      .maintenance-icon { color: #7ED957; margin-bottom: 6px; }
      .maintenance-screen h1 { font-family: 'Bebas Neue'; font-size: 30px; letter-spacing: 0.05em; margin: 0; }
      .maintenance-screen p { color: var(--muted); font-size: 13.5px; max-width: 280px; line-height: 1.5; margin: 0; }
      .spin { animation: mw-spin 0.9s linear infinite; }
      @keyframes mw-spin { to { transform: rotate(360deg); } }
      button { font-family: inherit; cursor: pointer; border: none; background: none; color: inherit; }
      input, textarea { font-family: inherit; color: var(--text); }
      @media (prefers-reduced-motion: reduce) { .mw-root * { animation: none !important; transition: none !important; } }

      /* ---------- Appearance modes ---------- */
      .appearance-mode-list { display: flex; flex-direction: column; gap: 6px; }
      .appearance-mode-btn { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 10px; background: var(--surface2); border: 1px solid var(--border); color: var(--muted); font-size: 13px; font-weight: 600; text-align: left; }
      .appearance-mode-btn.active { color: #7ED957; border-color: #7ED957; background: color-mix(in srgb, #7ED957 12%, var(--surface2)); }
      .accordion-header { display: flex; align-items: center; justify-content: space-between; width: 100%; text-align: left; }
      .accordion-chevron { transition: transform 0.15s ease; color: var(--muted); flex-shrink: 0; }
      .accordion-chevron.open { transform: rotate(180deg); }
      .accordion-body { margin-top: 10px; }

      /* Dark mode: menus/nav/chrome go grayscale, and every navy surface in the
         app (cards, rows, modals, buttons — anything using --surface/--surface2)
         turns pure black via the underlying variables, so nothing gets missed.
         Posters, cover art, and anything carrying its own brand/type color (page
         titles, type tiles, the Upcoming button, "X you've added" labels, the
         active bottom-nav item) keep their real colors throughout. */
      .mode-dark {
        background: #000 !important; background-image: none !important;
        --surface: #000; --surface2: #0A0A0A; --border: #222;
      }
      .mode-dark .tabs-row,
      .mode-dark .search-box,
      .mode-dark .sort-row,
      .mode-dark .backup-row,
      .mode-dark .profile-card,
      .mode-dark .time-card,
      .mode-dark .modal-head,
      .mode-dark .history-chips,
      .mode-dark .history-head,
      .mode-dark .cloud-status,
      .mode-dark .report-bug-link,
      .mode-dark .splash-mid,
      .mode-dark .settings-gear-btn {
        filter: grayscale(1);
      }

      /* White mode: same idea as Dark mode, inverted — light surfaces, dark
         readable text, plain chrome desaturated, brand/type colors and posters
         stay exactly as colorful as usual. */
      .mode-white {
        background: #F2F2F0 !important; background-image: none !important;
        --bg: #F2F2F0; --surface: #FFFFFF; --surface2: #ECECEA; --border: #DADAD6;
        --text: #14161F; --muted: #6B7280;
      }
      .mode-white .bottom-nav {
        background: linear-gradient(180deg, rgba(255,255,255,0.85), rgba(242,242,240,0.98)) !important;
        border-top-color: #DADAD6;
      }
      .mode-white .tabs-row,
      .mode-white .search-box,
      .mode-white .sort-row,
      .mode-white .backup-row,
      .mode-white .profile-card,
      .mode-white .time-card,
      .mode-white .modal-head,
      .mode-white .history-chips,
      .mode-white .history-head,
      .mode-white .cloud-status,
      .mode-white .report-bug-link,
      .mode-white .splash-mid,
      .mode-white .settings-gear-btn {
        filter: grayscale(1);
      }

      /* Neon: colors pushed brighter/more saturated on a pure black canvas. The
         filter is applied per-card (not to the whole growing app container) on
         purpose — mobile Safari/Chrome fail to repaint NEW content appended inside
         an already-filtered, dynamically growing container (e.g. loading more via
         "Show more") until the page is scrolled. Applying filter to each
         individually-mounted card instead avoids that bug entirely, since every new
         card paints fresh with its own filter. */
      .mode-neon {
        background: #000 !important; background-image: none !important;
        --surface: #000; --surface2: #0A0A0A; --border: #222;
      }
      .mode-dark .bottom-nav,
      .mode-neon .bottom-nav {
        background: linear-gradient(180deg, rgba(0,0,0,0.85), rgba(0,0,0,0.98)) !important;
      }
      .mode-neon :is(.result-row, .item-row, .upcoming-item-row, .im-card, .modal,
        .season-row, .ep-row, .history-chip, .tab-btn, .type-tile, .bottom-nav,
        .search-box, .discover-top, .time-card, .profile-card, .type-breakdown,
        .cloud-status, .google-signin-btn, .report-bug-link, .splash-mid, .type-stat,
        .time-chip, .backup-btn, .settings-gear-btn, .appearance-mode-btn, .seg-btn,
        .choice-btn, .save-btn, .add-btn, .sort-btn, .history-head) {
        filter: saturate(1.9) contrast(1.08) brightness(1.04);
      }

      /* ---------- Splash ---------- */
      .splash { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; animation: splash-fade 1.5s ease forwards; cursor: pointer; }
      @keyframes splash-fade { 0% { opacity: 0; } 12% { opacity: 1; } 82% { opacity: 1; } 100% { opacity: 0; } }
      .splash-frame { border: 1px solid var(--border); border-radius: 20px; background: var(--surface); padding: 4px 0; width: 260px; box-shadow: 0 20px 60px -20px rgba(0,0,0,0.7); }
      .splash-mid { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 26px 20px; }
      .splash-ticket { color: #7ED957; animation: ticket-pop 1.4s ease; }
      @keyframes ticket-pop { 0% { transform: scale(0.6) rotate(-8deg); opacity: 0; } 40% { transform: scale(1.05) rotate(3deg); opacity: 1; } 100% { transform: scale(1) rotate(0deg); } }
      .splash-mid h1 { font-family: 'Bebas Neue'; font-size: 34px; letter-spacing: 0.06em; margin: 4px 0 0; background: linear-gradient(90deg, #7ED957, #4FA8FF); -webkit-background-clip: text; background-clip: text; color: transparent; }
      .splash-mid p { font-size: 11.5px; color: var(--muted); margin: 0; letter-spacing: 0.03em; }
      .sprockets { display: flex; justify-content: space-between; padding: 0 14px; }
      .sprockets i { display: block; width: 7px; height: 7px; border-radius: 50%; background: var(--bg); border: 1px solid var(--border); margin: 6px 0; }
      .splash-skip { color: var(--muted); font-size: 11px; margin-top: 4px; }

      /* ---------- Layout shell ---------- */
      .view-area { max-width: 480px; margin: 0 auto; padding-bottom: 96px; }
      .screen { padding: 18px 16px 20px; }
      .page-title { font-family: 'Bebas Neue'; font-size: 28px; letter-spacing: 0.03em; color: var(--c, var(--text)); margin: 0 0 16px; }

      /* ---------- Bottom nav ---------- */
      .bottom-nav {
        position: fixed; bottom: 0; left: 0; right: 0; z-index: 40;
        max-width: 480px; margin: 0 auto;
        display: flex; align-items: flex-end; justify-content: space-around;
        background: linear-gradient(180deg, rgba(20,24,51,0.7), rgba(11,14,26,0.98));
        backdrop-filter: blur(10px);
        border-top: 1px solid var(--border);
        padding: 8px 10px calc(10px + env(safe-area-inset-bottom, 0px));
      }
      .nav-btn { display: flex; flex-direction: column; align-items: center; gap: 3px; color: var(--muted); font-size: 10.5px; font-weight: 600; padding: 4px 10px; }
      .nav-btn.active { color: var(--c); }
      .nav-center { transform: translateY(-14px); }
      .nav-center-circle {
        width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
        background: radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--c) 55%, var(--surface2)), var(--surface2));
        border: 1px solid var(--c); color: var(--c);
        box-shadow: 0 8px 20px -6px color-mix(in srgb, var(--c) 60%, transparent);
        margin-bottom: 2px;
        transition: transform 0.15s ease;
      }
      .nav-btn.nav-center.active .nav-center-circle, .nav-btn:active .nav-center-circle { transform: scale(0.94); }

      /* ---------- Discover ---------- */
      .discover-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
      .discover-brand { display: flex; align-items: center; gap: 6px; font-family: 'Bebas Neue'; font-size: 20px; letter-spacing: 0.05em; color: #7ED957; }
      .discover-greet { font-size: 11.5px; color: var(--muted); }

      .search-box { display: flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; color: var(--muted); }
      .history-block { margin-top: 16px; }
      .history-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
      .history-head span { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; color: var(--muted); }
      .history-head button { font-size: 11.5px; color: var(--muted); text-decoration: underline; }
      .history-chips { display: flex; flex-wrap: wrap; gap: 8px; }
      .history-chip { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 100px; background: var(--surface); border: 1px solid var(--border); color: var(--text); font-size: 12.5px; }
      .search-box input { flex: 1; background: none; border: none; outline: none; font-size: 14px; color: var(--text); }
      .inline-error { color: #FF8080; font-size: 12px; margin: 8px 0 0; }


      /* ---------- Result list (search) ---------- */
      .result-section { margin-top: 20px; }
      .result-list { display: flex; flex-direction: column; gap: 8px; }
      .result-row { display: flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 8px; }
      .result-row-main { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; text-align: left; }
      .result-row-poster { position: relative; width: 46px; height: 64px; border-radius: 8px; overflow: hidden; flex-shrink: 0; background: var(--surface2); border: 1px solid color-mix(in srgb, var(--c) 40%, var(--border)); }
      .result-row-poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .result-poster-fallback { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--muted); }
      .result-row-info { flex: 1; min-width: 0; }
      .result-row-title-line { display: flex; align-items: center; gap: 6px; color: var(--c); margin-bottom: 3px; }
      .result-row-title { font-size: 14px; font-weight: 700; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .result-row-meta { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--muted); flex-wrap: wrap; }
      .rating-badge { display: inline-flex; align-items: center; gap: 3px; font-size: 10.5px; font-weight: 700; color: #F5A623; }
      .ext-stars { display: inline-flex; align-items: center; gap: 1px; }
      .ext-stars-source { margin-left: 5px; font-size: 0.75em; font-weight: 700; color: var(--muted); letter-spacing: 0.02em; }
      .result-row-add {
        display: flex; flex-direction: column; align-items: center; gap: 2px; flex-shrink: 0;
        padding: 8px 10px; border-radius: 11px; background: color-mix(in srgb, var(--c) 16%, var(--surface2));
        border: 1px solid var(--c); color: var(--c); font-size: 9.5px; font-weight: 700; min-width: 58px;
      }
      .result-row-add.in-list { color: #7ED957; border-color: #7ED957; background: color-mix(in srgb, #7ED957 16%, var(--surface2)); }
      .result-row-add:disabled { color: #7ED957; border-color: #7ED957; background: color-mix(in srgb, #7ED957 16%, var(--surface2)); opacity: 1; }

      /* ---------- Detail sheet ---------- */
      .detail-modal { }
      .detail-hero { display: flex; gap: 14px; margin-bottom: 14px; }
      .detail-poster { width: 96px; height: 132px; border-radius: 12px; overflow: hidden; background: var(--surface2); border: 1px solid var(--border); flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
      .detail-poster img { width: 100%; height: 100%; object-fit: cover; }
      .detail-hero-info { flex: 1; min-width: 0; padding-top: 2px; }
      .detail-title { font-weight: 700; font-size: 17px; line-height: 1.25; margin-bottom: 4px; }
      .detail-year { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
      .detail-facts { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; color: var(--text); margin-bottom: 6px; }
      .detail-note { font-size: 11.5px; color: #7ED957; font-weight: 600; }
      .detail-summary { font-size: 13px; line-height: 1.55; color: var(--muted); margin: 0 0 6px; }
      .trailer-btn { display: flex; align-items: center; gap: 6px; padding: 12px 16px; border-radius: 12px; background: var(--surface2); border: 1px solid var(--border); font-weight: 600; font-size: 13.5px; white-space: nowrap; }

      /* ---------- My Shows ---------- */
      .tabs-row { display: flex; gap: 8px; margin-bottom: 16px; overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 2px; }
      .tabs-row .tab-btn { flex-shrink: 0; }
      .tab-btn { display: flex; align-items: center; gap: 6px; padding: 9px 16px; border-radius: 100px; font-size: 12.5px; font-weight: 700; color: var(--muted); background: var(--surface); border: 1px solid var(--border); }
      .tab-btn.active { background: color-mix(in srgb, #7ED957 20%, var(--surface)); color: #7ED957; border-color: color-mix(in srgb, #7ED957 55%, transparent); }
      .show-more-btn { display: flex; align-items: center; justify-content: center; width: 100%; margin-top: 12px; padding: 11px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); color: #7ED957; font-weight: 700; font-size: 13.5px; }
      .show-more-btn:disabled { opacity: 0.6; }
      .zap-header-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
      .zap-toggle-btn { display: flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 100px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); font-size: 11.5px; font-weight: 700; }
      .zap-toggle-btn.active { background: color-mix(in srgb, #7ED957 20%, var(--surface)); color: #7ED957; border-color: #7ED957; }
      .zap-deck { display: flex; flex-direction: column; align-items: center; padding: 8px 0 4px; }
      .zap-stack { position: relative; width: 100%; max-width: 300px; height: 400px; }
      .zap-card { position: absolute; inset: 0; border-radius: 20px; overflow: hidden; background: var(--surface); border: 1px solid var(--border); box-shadow: 0 20px 50px -20px rgba(0,0,0,0.6); cursor: grab; touch-action: pan-y; user-select: none; }
      .zap-card-behind { transform: scale(0.94) translateY(10px); opacity: 0.6; z-index: 0; }
      .zap-card:not(.zap-card-behind) { z-index: 1; }
      .zap-card-inner { display: flex; flex-direction: column; height: 100%; }
      .zap-card-poster { flex: 1; background: var(--surface2); display: flex; align-items: center; justify-content: center; color: var(--muted); overflow: hidden; }
      .zap-card-poster img { width: 100%; height: 100%; object-fit: cover; }
      .zap-card-info { padding: 14px 16px 18px; background: linear-gradient(0deg, rgba(11,14,26,0.95), rgba(11,14,26,0.5)); }
      .zap-card-title { font-family: 'Fraunces', serif; font-style: italic; font-weight: 700; font-size: 19px; color: var(--text); margin: 8px 0 6px; line-height: 1.2; }
      .zap-card-meta { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 12px; }
      .zap-stamp { position: absolute; top: 26px; padding: 8px 14px; border: 3px solid; border-radius: 10px; font-weight: 800; font-size: 15px; letter-spacing: 0.04em; transform: rotate(-14deg); z-index: 2; }
      .zap-stamp-like { right: 18px; color: #7ED957; border-color: #7ED957; transform: rotate(-14deg); }
      .zap-stamp-skip { left: 18px; color: #FF6B6B; border-color: #FF6B6B; transform: rotate(14deg); }
      .zap-actions { display: flex; gap: 16px; margin-top: 20px; }
      .zap-action-btn { width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--surface); border: 1px solid var(--border); }
      .zap-action-btn.zap-skip { color: #FF6B6B; }
      .zap-action-btn.zap-skip:active { background: color-mix(in srgb, #FF6B6B 18%, var(--surface)); border-color: #FF6B6B; }
      .zap-action-btn.zap-plan { color: #F5A623; }
      .zap-action-btn.zap-plan:active { background: color-mix(in srgb, #F5A623 18%, var(--surface)); border-color: #F5A623; }
      .zap-action-btn.zap-watched { color: #7ED957; }
      .zap-action-btn.zap-watched:active { background: color-mix(in srgb, #7ED957 18%, var(--surface)); border-color: #7ED957; }
      .zap-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 50px 20px; color: var(--muted); text-align: center; }
      .upcoming-item-poster { width: 48px; height: 68px; border-radius: 9px; overflow: hidden; flex-shrink: 0; background: var(--surface2); display: flex; align-items: center; justify-content: center; color: var(--muted); }
      .upcoming-item-poster img { width: 100%; height: 100%; object-fit: cover; }
      .upcoming-timeline { position: relative; padding-left: 4px; }
      .upcoming-timeline-track { position: absolute; left: 32px; top: 0; bottom: 0; width: 10px; border-radius: 5px; background: linear-gradient(180deg, #B6F09C, #7ED957, #3F8F1F); }
      .upcoming-timeline-row { display: flex; gap: 14px; margin-bottom: 28px; position: relative; }
      .upcoming-timeline-row:last-child { margin-bottom: 0; }
      .upcoming-timeline-badge-col { width: 74px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; padding-top: 4px; }
      .upcoming-timeline-day { width: 68px; height: 68px; border-radius: 50%; background: #7ED957; color: #173404; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 0 0 4px var(--bg); position: relative; z-index: 1; flex-shrink: 0; }
      .upcoming-timeline-day-n { font-weight: 700; font-size: 19px; line-height: 1; }
      .upcoming-timeline-day-u { font-size: 9px; font-weight: 700; letter-spacing: 0.03em; margin-top: 2px; text-transform: uppercase; }
      .upcoming-timeline-content { display: flex; gap: 10px; flex: 1; text-align: left; background: none; border: none; padding: 4px 0 0; min-width: 0; }
      .upcoming-timeline-poster { width: 52px; height: 72px; border-radius: 8px; overflow: hidden; background: var(--surface2); display: flex; align-items: center; justify-content: center; color: var(--muted); flex-shrink: 0; }
      .upcoming-timeline-poster img { width: 100%; height: 100%; object-fit: cover; }
      .upcoming-timeline-info { min-width: 0; }
      .upcoming-timeline-title { font-weight: 700; font-size: 14px; color: var(--text); margin-bottom: 6px; line-height: 1.25; }
      .upcoming-timeline-meta-row { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 11.5px; margin-bottom: 4px; }
      .upcoming-row { display: flex; justify-content: center; margin-bottom: 20px; }
      .upcoming-circle { position: relative; width: 78px; height: 78px; border-radius: 50%; background: radial-gradient(circle at 30% 25%, color-mix(in srgb, #7ED957 30%, var(--surface)), var(--surface)); border: 1.5px solid color-mix(in srgb, #7ED957 45%, var(--border)); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; color: #7ED957; }
      .upcoming-circle span:last-child { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; }
      .upcoming-circle.active { background: #7ED957; color: #0B0E1A; box-shadow: 0 8px 22px rgba(126,217,87,0.35); }
      .upcoming-badge { position: absolute; top: -2px; right: -2px; background: #7ED957; color: #0B0E1A; font-size: 11px; font-weight: 800; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid var(--bg); }
      .upcoming-item-row { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 9px 12px; margin-bottom: 10px; }
      .upcoming-item-info { flex: 1; min-width: 0; }
      .upcoming-item-title { font-family: 'Fraunces'; font-style: italic; font-weight: 700; font-size: 15px; margin-bottom: 3px; }
      .upcoming-item-meta { font-size: 11.5px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
      .countdown-badge { flex-shrink: 0; text-align: center; background: var(--surface2); border-radius: 12px; padding: 7px 11px; }
      .countdown-n { font-family: 'JetBrains Mono'; font-weight: 700; font-size: 16px; line-height: 1; color: #7ED957; }
      .countdown-u { font-size: 8.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }
      .type-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; }
      .type-tile {
        display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 14px 6px;
        border-radius: 14px; background: var(--surface); border: 1px solid var(--border); color: var(--muted);
        position: relative; transition: transform 0.15s ease, border-color 0.15s ease;
      }
      .type-tile span:nth-of-type(1) { font-size: 12px; font-weight: 700; }
      .type-tile.active { color: var(--c); border-color: var(--c); background: color-mix(in srgb, var(--c) 14%, var(--surface)); transform: translateY(-2px); }
      .type-tile-count { position: absolute; top: 6px; right: 8px; font-family: 'JetBrains Mono'; font-size: 10px; color: var(--muted); }
      .myshows-list-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
      .sort-row { display: flex; gap: 6px; margin-bottom: 14px; }
      .sort-btn { padding: 6px 12px; border-radius: 100px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); font-size: 11.5px; font-weight: 600; }
      .sort-btn.active { background: color-mix(in srgb, #7ED957 18%, var(--surface)); border-color: #7ED957; color: #7ED957; }

      /* ---------- shared rows / groups ---------- */
      .group { margin-bottom: 22px; }
      .group-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; margin: 0 2px 8px; }
      .item-list { display: flex; flex-direction: column; gap: 8px; }
      .item-row { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 8px 10px; transition: border-color 0.15s ease, transform 0.1s ease; }
      .swipe-row { position: relative; border-radius: 14px; overflow: hidden; touch-action: pan-y; }
      .swipe-content { position: relative; z-index: 2; }
      .swipe-content .item-row { border-radius: 14px; }
      .swipe-actions { position: absolute; top: 0; bottom: 0; display: flex; align-items: stretch; z-index: 1; }
      .swipe-actions-left { left: 0; width: 150px; }
      .swipe-actions-right { right: 0; width: 84px; }
      .swipe-action { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; border: none; font-size: 10.5px; font-weight: 700; color: #0B0E1A; }
      .swipe-action.advance { background: #4FA8FF; border-radius: 14px 0 0 14px; }
      .swipe-action.markwatched { background: #7ED957; }
      .swipe-action.markwatched:only-child { border-radius: 14px 0 0 14px; }
      .swipe-action.delete { background: #FF6B6B; border-radius: 0 14px 14px 0; }
      .item-row:hover { border-color: var(--muted); }
      .item-row:active { transform: scale(0.99); }
      .item-info { flex: 1; min-width: 0; }
      .item-title { font-weight: 600; font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .item-meta { display: flex; align-items: center; gap: 8px; margin-top: 3px; flex-wrap: wrap; }
      .dim { color: var(--muted); font-size: 11.5px; }
      .chip { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 100px; color: var(--c); background: color-mix(in srgb, var(--c) 16%, transparent); border: 1px solid color-mix(in srgb, var(--c) 40%, transparent); }
      .chip-mini { font-size: 9px; padding: 1px 6px; }
      .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex-shrink: 0; }
      .poster { border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; flex-shrink: 0; background: linear-gradient(155deg, color-mix(in srgb, var(--c) 30%, var(--surface2)), var(--surface2)); border: 1px solid color-mix(in srgb, var(--c) 45%, var(--border)); }
      .poster img { width: 100%; height: 100%; object-fit: cover; }
      .empty-state { text-align: center; padding: 40px 20px; color: var(--muted); }
      .empty-emoji { font-size: 34px; margin-bottom: 10px; }
      .empty-state p { font-size: 14px; margin: 0 0 4px; color: var(--text); }
      .empty-cta { font-size: 12.5px; }
      .add-btn { width: 36px; height: 36px; border-radius: 10px; background: color-mix(in srgb, var(--c) 18%, var(--surface)); border: 1px solid var(--c); color: var(--c); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }

      /* ---------- Account ---------- */
      .google-signin-btn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 13px 16px; border-radius: 12px; background: #fff; color: #1F1F1F; font-weight: 600; font-size: 13.5px; margin-bottom: 18px; }
      .google-g { width: 20px; height: 20px; border-radius: 50%; background: #4285F4; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; flex-shrink: 0; }
      .cloud-status { display: flex; align-items: center; gap: 8px; padding: 11px 14px; border-radius: 12px; background: rgba(126,217,87,0.12); border: 1px solid rgba(126,217,87,0.35); color: #7ED957; font-size: 12.5px; font-weight: 600; margin-bottom: 18px; }
      .cloud-status span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cloud-status button { color: var(--muted); font-size: 11.5px; text-decoration: underline; font-weight: 600; flex-shrink: 0; }
      .profile-card { display: flex; align-items: center; gap: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 12px 14px; margin-bottom: 18px; }
      .profile-avatar { width: 42px; height: 42px; border-radius: 50%; background: color-mix(in srgb, #7ED957 20%, var(--surface2)); border: 1px solid #7ED957; color: #7ED957; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .profile-name-btn { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14.5px; color: var(--text); }
      .profile-name-btn span:first-child { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .profile-edit-row { display: flex; align-items: center; gap: 8px; flex: 1; }
      .profile-input { flex: 1; background: var(--surface2); border: 1px solid var(--border); border-radius: 9px; padding: 8px 10px; font-size: 14px; outline: none; }
      .profile-ok { width: 32px; height: 32px; border-radius: 9px; background: color-mix(in srgb, #7ED957 20%, var(--surface2)); border: 1px solid #7ED957; color: #7ED957; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }

      .time-card { background: linear-gradient(155deg, rgba(126,217,87,0.14), var(--surface)); border: 1px solid rgba(126,217,87,0.4); border-radius: 18px; padding: 18px; margin-bottom: 16px; text-align: center; }
      .time-card-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 12px; }
      .time-breakdown { display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; }
      .time-chip { display: flex; flex-direction: column; align-items: center; min-width: 46px; }
      .time-chip-n { font-family: 'Bebas Neue'; font-size: 30px; color: #7ED957; line-height: 1; }
      .time-chip-u { font-size: 10.5px; color: var(--muted); margin-top: 2px; }
      .time-total { margin-top: 12px; font-size: 11.5px; color: var(--muted); font-family: 'JetBrains Mono'; }
      .backup-row { display: flex; gap: 10px; margin-top: 28px; }
      .account-title-row { display: flex; align-items: center; justify-content: space-between; }
      .settings-gear-btn { width: 36px; height: 36px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); display: flex; align-items: center; justify-content: center; }
      .settings-gear-btn:active { color: #7ED957; border-color: #7ED957; }
      .backup-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 12px; border-radius: 12px; background: var(--surface); border: 1px solid var(--border); color: var(--text); font-size: 12.5px; font-weight: 600; }
      .report-bug-link { display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: 14px; padding: 12px; border-radius: 12px; border: 1px dashed var(--border); color: var(--muted); font-size: 12.5px; font-weight: 600; text-decoration: none; }
      .report-bug-link:active { background: var(--surface); }
      .type-breakdown { display: flex; gap: 8px; margin-bottom: 24px; }
      .type-stat { flex: 1; background: var(--surface); border: 1px solid color-mix(in srgb, var(--c) 35%, var(--border)); border-radius: 14px; padding: 12px 6px; display: flex; flex-direction: column; align-items: center; gap: 4px; color: var(--c); }
      .type-stat-h { font-family: 'JetBrains Mono'; font-weight: 700; font-size: 15px; color: var(--text); }
      .type-stat-l { font-size: 10.5px; color: var(--muted); }

      /* ---------- Modal ---------- */
      .modal-backdrop { position: fixed; inset: 0; background: rgba(6,8,16,0.72); backdrop-filter: blur(3px); z-index: 50; display: flex; flex-direction: column; overflow-y: auto; -webkit-overflow-scrolling: touch; }
      .modal { width: 100%; max-width: 480px; margin: auto auto 0; flex-shrink: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 22px 22px 0 0; padding: 18px 18px 26px; }
      .modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
      .icon-x { width: 30px; height: 30px; border-radius: 8px; background: var(--surface2); display: flex; align-items: center; justify-content: center; }
      .modal-title-input { width: 100%; background: var(--surface2); border: 1px solid var(--border); border-radius: 12px; padding: 12px; font-size: 16px; font-weight: 600; outline: none; margin-bottom: 12px; }
      .modal-poster-preview { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
      .modal-poster-preview img { width: 52px; height: 70px; border-radius: 8px; object-fit: cover; border: 1px solid var(--border); }
      .poster-clear { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--muted); }
      .locked-title-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
      .locked-title-poster { width: 52px; height: 70px; border-radius: 8px; object-fit: cover; border: 1px solid var(--border); flex-shrink: 0; }
      .locked-title-text { font-size: 17px; font-weight: 700; margin-bottom: 4px; }
      .episodes-btn { display: flex; align-items: center; gap: 8px; width: 100%; padding: 12px; border-radius: 12px; background: var(--surface2); border: 1px solid color-mix(in srgb, var(--c) 40%, var(--border)); color: var(--c); font-weight: 600; font-size: 13.5px; margin-bottom: 6px; }
      .episodes-btn span:nth-of-type(1) { flex: 1; text-align: left; color: var(--text); }
      .episodes-btn-arrow { font-size: 18px; color: var(--muted); }
      .season-row { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px; }
      .season-row-text { flex: 1; min-width: 0; }
      .season-row-title { font-weight: 700; font-size: 14px; margin-bottom: 6px; }
      .season-bar { height: 5px; border-radius: 100px; background: var(--surface2); overflow: hidden; }
      .season-bar-fill { height: 100%; background: #7ED957; border-radius: 100px; }
      .season-count { font-family: 'JetBrains Mono'; font-size: 11.5px; color: var(--muted); flex-shrink: 0; }
      .ep-row { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; }
      .ep-row-text { flex: 1; min-width: 0; }
      .ep-row-title { font-size: 13.5px; font-weight: 600; }
      .ep-row-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
      .ep-check { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--muted); display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #0B0E1A; }
      .ep-check.checked { background: #7ED957; border-color: #7ED957; }
      .mark-all-btn { width: 34px; height: 34px; border-radius: 9px; background: var(--surface2); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; margin-left: 6px; }
      .confirm-overlay { position: fixed; inset: 0; background: rgba(6,8,16,0.6); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 24px; }
      .confirm-box { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 18px; max-width: 320px; box-shadow: 0 20px 50px -15px rgba(0,0,0,0.6); }
      .confirm-box p { font-size: 14px; line-height: 1.5; margin: 0 0 16px; }
      .confirm-actions { display: flex; gap: 10px; }
      .confirm-actions button { flex: 1; padding: 11px; border-radius: 10px; font-weight: 700; font-size: 13px; }
      .confirm-no { background: var(--surface2); border: 1px solid var(--border); color: var(--text); }
      .confirm-yes { background: #7ED957; border: 1px solid #7ED957; color: #0B0E1A; }
      .load-more-btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 12px; margin-top: 10px; border-radius: 12px; background: var(--surface2); border: 1px solid var(--border); font-size: 12.5px; font-weight: 600; color: var(--muted); }
      .emoji-row { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
      .emoji-btn { width: 38px; height: 38px; border-radius: 10px; background: var(--surface2); border: 1px solid var(--border); font-size: 17px; display: flex; align-items: center; justify-content: center; }
      .emoji-btn.active { border-color: var(--c); background: color-mix(in srgb, var(--c) 22%, var(--surface2)); }
      .field-label { font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin: 4px 2px 6px; }
      .segmented { display: flex; gap: 6px; margin-bottom: 14px; }
      .seg-btn { flex: 1; padding: 9px 4px; border-radius: 10px; background: var(--surface2); border: 1px solid var(--border); font-size: 12.5px; font-weight: 600; color: var(--muted); }
      .seg-btn.active { color: var(--c); border-color: var(--c); background: color-mix(in srgb, var(--c) 16%, var(--surface2)); }
      .seg-btn { display: flex; align-items: center; justify-content: center; gap: 5px; }
      .seg-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex-shrink: 0; }

      .item-modal-v2 { position: relative; overflow: hidden; }
      .im-glow { position: absolute; top: -100px; left: -70px; width: 280px; height: 280px; filter: blur(16px); pointer-events: none; z-index: 0; }
      .im-hero { display: flex; gap: 14px; margin-bottom: 18px; position: relative; z-index: 1; }
      .im-hero-poster { width: 84px; height: 124px; border-radius: 12px; overflow: hidden; flex-shrink: 0; box-shadow: 0 10px 26px rgba(0,0,0,0.5); background: linear-gradient(155deg, var(--surface2), var(--surface)); display: flex; align-items: center; justify-content: center; font-size: 28px; }
      .im-hero-poster img { width: 100%; height: 100%; object-fit: cover; }
      .im-hero-info { display: flex; flex-direction: column; justify-content: center; gap: 8px; min-width: 0; }
      .im-title { font-family: 'Fraunces', serif; font-style: italic; font-weight: 700; font-size: 23px; line-height: 1.15; }
      .im-title-input { font-family: 'Fraunces', serif; font-style: italic; font-weight: 700; font-size: 20px; background: var(--surface2); border: 1px solid var(--border); border-radius: 10px; padding: 9px 11px; outline: none; color: var(--text); width: 100%; }
      .im-card { position: relative; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 14px 14px 14px 16px; margin-bottom: 12px; z-index: 1; }
      .im-card-accent { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
      .im-card-label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 10px; }
      .im-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
      .im-rating-value { font-family: 'JetBrains Mono'; font-weight: 700; font-size: 17px; color: #F5A623; }
      .im-rating-value span { font-size: 11px; color: var(--muted); font-weight: 500; }
      .im-inline-row { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
      .im-inline-row.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; border-top: none; margin-top: 10px; padding-top: 0; }
      .im-inline-label { font-size: 11px; color: var(--muted); margin-bottom: 5px; }
      .im-runtime-input { display: flex; align-items: center; gap: 5px; background: var(--surface2); border: 1px solid var(--border); border-radius: 10px; padding: 7px 11px; }
      .im-runtime-input input { width: 40px; background: none; border: none; color: var(--text); font-family: 'JetBrains Mono'; font-size: 14px; font-weight: 700; text-align: right; outline: none; }
      .im-runtime-input span { color: var(--muted); font-size: 11.5px; }
      .im-description { font-size: 13.5px; line-height: 1.6; color: var(--muted); margin: 0; }
      .im-similar-section { margin-top: 18px; }
      .similar-scroll { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; -webkit-overflow-scrolling: touch; }
      .similar-card { flex-shrink: 0; width: 92px; position: relative; cursor: pointer; }
      .similar-poster { width: 92px; height: 130px; border-radius: 10px; overflow: hidden; background: var(--surface2); display: flex; align-items: center; justify-content: center; color: var(--muted); }
      .similar-poster img { width: 100%; height: 100%; object-fit: cover; }
      .similar-title { font-size: 11.5px; font-weight: 600; margin-top: 6px; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .similar-add { position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; border-radius: 50%; background: rgba(11,14,26,0.85); border: 1px solid var(--border); color: var(--text); display: flex; align-items: center; justify-content: center; }
      .similar-add:disabled { color: #7ED957; border-color: #7ED957; }
      .field-row { display: flex; gap: 10px; margin-bottom: 6px; }
      .field { flex: 1; }
      .field input, .modal input[type=number] { width: 100%; background: var(--surface2); border: 1px solid var(--border); border-radius: 10px; padding: 10px; font-size: 14px; outline: none; }
      .rating-row { display: flex; gap: 4px; margin-bottom: 14px; flex-wrap: wrap; }
      .rate-dot { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; }
      .modal textarea { width: 100%; background: var(--surface2); border: 1px solid var(--border); border-radius: 10px; padding: 10px; font-size: 13.5px; resize: none; outline: none; margin-bottom: 8px; }
      .modal-actions { display: flex; gap: 10px; margin-top: 14px; }
      .modal-actions.two-choice { margin-top: 6px; }
      .choice-row { display: flex; gap: 10px; margin-top: 10px; }
      .choice-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 12px; border-radius: 12px; background: color-mix(in srgb, var(--c) 16%, var(--surface2)); border: 1px solid var(--c); color: var(--c); font-weight: 700; font-size: 13px; }
      .choice-btn.watched { background: rgba(126,217,87,0.16); border-color: #7ED957; color: #7ED957; }
      .already-note { display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: 10px; padding: 12px; border-radius: 12px; background: rgba(126,217,87,0.12); color: #7ED957; font-weight: 700; font-size: 13px; }
      .danger-btn { display: flex; align-items: center; justify-content: center; width: 52px; flex-shrink: 0; border-radius: 14px; background: linear-gradient(155deg, rgba(255,107,107,0.22), rgba(255,107,107,0.08)); border: 1px solid rgba(255,107,107,0.5); color: #FF6B6B; font-weight: 600; font-size: 13px; }
      .danger-btn-wide { width: 100%; gap: 7px; padding: 13px; font-size: 14.5px; font-weight: 700; }
      .save-btn { flex: 1; padding: 12px; border-radius: 14px; background: linear-gradient(135deg, var(--c), color-mix(in srgb, var(--c) 60%, white)); color: #0B0E1A; font-weight: 800; font-size: 14.5px; box-shadow: 0 8px 20px -6px color-mix(in srgb, var(--c) 60%, transparent); }
      .save-btn:disabled { opacity: 0.5; }

      @media (max-width: 360px) {
        .time-chip-n { font-size: 25px; }
        .result-row-title { max-width: 150px; }
        .detail-poster { width: 84px; height: 116px; }
      }
    `}</style>
  );
}
