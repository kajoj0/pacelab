import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ComposedChart
} from 'recharts';
import {
  Activity, Upload, Settings as SettingsIcon, Target, Zap,
  Bike, Footprints, Waves, Calendar, Send, Trash2, AlertCircle,
  Loader2, LayoutDashboard, FileText, Sparkles, X, Check, Edit2,
  Download, ExternalLink, Dumbbell, Plus, BookOpen, Mic, MicOff, MessageSquare, LogOut
} from 'lucide-react';
import Papa from 'papaparse';
import { supabase, isSupabaseEnabled } from './supabaseClient.js';

// ============================================================
// Standalone setup — runs outside Claude.ai artifact sandbox
// ============================================================

// Cached current user (updated by auth state listener — set up in AppRoot)
let cachedAuthUser = null;
export function setCachedAuthUser(u) { cachedAuthUser = u; }
export function getCachedAuthUser() { return cachedAuthUser; }

// Storage shim — uses Supabase if user is logged in, otherwise localStorage
if (typeof window !== 'undefined' && !window.storage) {
  window.storage = {
    get: async (key) => {
      if (cachedAuthUser && supabase) {
        const { data, error } = await supabase
          .from('kv_store')
          .select('value')
          .eq('user_id', cachedAuthUser.id)
          .eq('key', key)
          .maybeSingle();
        if (error) console.warn('Supabase get error:', error.message);
        if (!data) return null;
        const v = typeof data.value === 'string' ? data.value : JSON.stringify(data.value);
        return { key, value: v, shared: false };
      }
      const v = localStorage.getItem(key);
      return v !== null ? { key, value: v, shared: false } : null;
    },
    set: async (key, value, shared = false) => {
      if (cachedAuthUser && supabase) {
        let storedValue;
        try { storedValue = JSON.parse(value); } catch { storedValue = value; }
        const { error } = await supabase
          .from('kv_store')
          .upsert(
            { user_id: cachedAuthUser.id, key, value: storedValue, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,key' }
          );
        if (error) console.warn('Supabase set error:', error.message);
        return { key, value, shared };
      }
      localStorage.setItem(key, value);
      return { key, value, shared };
    },
    delete: async (key) => {
      if (cachedAuthUser && supabase) {
        const { error } = await supabase
          .from('kv_store').delete()
          .eq('user_id', cachedAuthUser.id).eq('key', key);
        if (error) console.warn('Supabase delete error:', error.message);
        return { key, deleted: true };
      }
      localStorage.removeItem(key);
      return { key, deleted: true };
    },
    list: async (prefix) => {
      if (cachedAuthUser && supabase) {
        let q = supabase.from('kv_store').select('key').eq('user_id', cachedAuthUser.id);
        if (prefix) q = q.like('key', `${prefix}%`);
        const { data } = await q;
        return { keys: (data || []).map(r => r.key), prefix };
      }
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!prefix || (k && k.startsWith(prefix))) keys.push(k);
      }
      return { keys, prefix };
    },
  };
}

// Anthropic API helper with browser-direct access
const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

async function callClaude(body) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('Brak klucza API. Ustaw VITE_ANTHROPIC_API_KEY w zmiennych środowiskowych (Vercel: Settings → Environment Variables).');
  }
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`API ${r.status}: ${errText.slice(0, 200) || r.statusText}`);
  }
  return r.json();
}


// ============================================================
// Theme
// ============================================================
// Theme palettes — dark default (TrainX-inspired), light optional via toggle in Settings
const PALETTES = {
  dark: {
    bg: '#0a0d12',          // deep navy/charcoal
    surface: '#11161d',     // cards
    surfaceAlt: '#161c25',  // sections inside cards
    surfaceHi: '#1d2430',   // hovers
    border: '#1f2733',
    borderAlt: '#2d3845',
    text: '#e8edf3',
    textDim: '#a3afbe',
    muted: '#6b7886',
    // Vibrant accents on dark — full saturation
    lime: '#a3ff3a',
    cyan: '#33d9ff',
    amber: '#ffba2e',
    red: '#ff5547',
    pink: '#ff4d9a',
    purple: '#9d6bff',
  },
  light: {
    bg: '#fafbfc',
    surface: '#ffffff',
    surfaceAlt: '#f3f5f7',
    surfaceHi: '#eef1f4',
    border: '#e3e7eb',
    borderAlt: '#d2d8de',
    text: '#0f1419',
    textDim: '#3f4956',
    muted: '#6b7680',
    lime: '#5a8a00',
    cyan: '#0066b3',
    amber: '#a86700',
    red: '#c92a0c',
    pink: '#b8246d',
    purple: '#6d3eb8',
  },
};

// Default theme: dark. Read from localStorage if user changed.
function getInitialTheme() {
  if (typeof window === 'undefined') return 'dark';
  try { return localStorage.getItem('pacelab:theme') || 'dark'; } catch { return 'dark'; }
}

// C is a *live* binding — set by ThemeProvider at runtime. Initialized to dark for module-level access.
let C = PALETTES[getInitialTheme()];
function setTheme(name) {
  const next = PALETTES[name] ? name : 'dark';
  C = PALETTES[next];
  try { localStorage.setItem('pacelab:theme', next); } catch {}
  // Update body bg + meta theme-color
  if (typeof document !== 'undefined') {
    document.body.style.background = C.bg;
    document.body.style.color = C.text;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', C.bg);
  }
}
// Apply initial theme to DOM on module load
if (typeof document !== 'undefined') {
  setTimeout(() => setTheme(getInitialTheme()), 0);
}

// Theme subscription — components call useTheme() to re-render on toggle
const themeListeners = new Set();
function notifyThemeChange() { themeListeners.forEach(fn => fn()); }
function useTheme() {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force(x => x + 1);
    themeListeners.add(listener);
    return () => themeListeners.delete(listener);
  }, []);
  return {
    name: typeof localStorage !== 'undefined' ? (localStorage.getItem('pacelab:theme') || 'dark') : 'dark',
    toggle: () => {
      const cur = localStorage.getItem('pacelab:theme') || 'dark';
      setTheme(cur === 'dark' ? 'light' : 'dark');
      notifyThemeChange();
    },
    set: (name) => { setTheme(name); notifyThemeChange(); },
  };
}

const STORAGE_KEY = 'pacelab:v1';

const DEFAULT_SETTINGS = {
  ftp: 250,
  thresholdHR: 165,
  maxHR: 190,
  thresholdPace: 285, // sek/km (4:45/km) — bieg progowy
  swimCSS: 105,       // sek/100m (1:45) — Critical Swim Speed
  weight: 75,
  primarySport: 'cycling',
  goalType: '1/4 Triathlon Bydgoszcz',
  goalDate: '2026-07-12',
  goalNotes: '',
  rules: [
    'Sobota = trening zakładkowy (brick), nie ruszaj tego dnia',
    'Poniedziałek wolne — chyba że trzeba odrobić zaległość z wyjazdu',
    'Nie planuj 2 ciężkich dni z rzędu (TSS > 80) bez dnia regeneracyjnego między nimi',
    'Jeśli TSB < -25, zawsze sugeruj redukcję objętości najbliższych treningów',
    'Plan musi być elastyczny — sportowiec ma częste wyjazdy służbowe',
    'Bieg zawsze z kadencją min. 178 spm (ochrona prawego kolana i L4-L5)',
  ],
  homeEquipment: {
    bands: true,        // gumy oporowe — najtańszy uniwersalny zestaw
    loadedBackpack: true, // plecak z obciążeniem — darmowy, każdy ma
    dumbbells: false,
    kettlebell: false,
    pullupBar: false,
    matRoller: true,    // mata + roller — i tak potrzebne do dekompresji L4-L5
  },
  travelMode: false,
  profile: `Sportowiec amator, profil multisport/triathlon.

Dystans docelowy: 1/4 Triathlon (950m pływanie / 45km rower / 10.5km bieg).

OGRANICZENIA MEDYCZNE (krytyczne):
- Przeciążenia lędźwiowe L4-L5 — wymagana stała ochrona kręgosłupa, codzienna dekompresja osiowa
- Wrażliwe prawe kolano — bieg z wysoką kadencją (~178 spm), krótki krok (~0.93 m), lądowanie pod środkiem ciężkości
- Wszystkie zalecenia muszą uwzględniać te ograniczenia (np. bez nadmiernego ciężaru osiowego, bez wydłużania kroku biegowego, kontrola odchylenia pionowego ciała)

LOGISTYKA:
- Częste wyjazdy służbowe → plan musi być elastyczny
- Poniedziałek = dzień wolny/buforowy do odrabiania jednostek

PIERWSZY START (Żyrardów 1/8, 17.05.2026): ukończony 1:46:17.
- Pływanie 561m / 15:17 (2:44/100m, HR 117/127 max) — spokój w wodzie ok, niska pozycja bioder
- Rower 22.6km / 52:20 (25.9 km/h, HR 145/176 max) — maszynowe tempo, świadome dowiezienie staminy 72%
- Bieg 5.46km / 32:55 (6:01/km, HR 149/167 max, kadencja 178 spm, długość kroku 0.93m, odchylenie pionowe 7.8 cm)
- Brak bólów lędźwi/kolana po mecie ✓

MOCNE STRONY: dobra baza tlenowa, kontrola tempa na rowerze i biegu, świadomość biomechaniki, dyscyplina pacingu.
SŁABE STRONY: technika pływania (niska pozycja bioder, słabe czucie wody), potrzeba budowania objętości pływackiej.

MAKROCYKL (3 bloki, 8 tygodni):
1. Adaptacja i technika (tyg. 1-3): wprowadzenie siłowni, technika pływania izolowana (pullbuoy unosi biodra), krótkie odcinki z pełnym odpoczynkiem
2. Szczyt obciążeń (tyg. 4-6): rower weekend 1.5-2h, treningi zakładkowe (brick), pływanie open water w piance, nawigacja boi
3. Tapering (tyg. 7-8): redukcja objętości 30-40% dla dekompresji krążków, krótkie pobudzenia intensywnościowe

STRUKTURA TYGODNIA:
- Pon: WOLNE / rolowanie / dekompresja
- Wt: rower 60-75 min (interwały próg) + siłownia (dół + core antyrotacyjny)
- Śr: pływanie 45-60 min (technika)
- Czw: bieg 40-50 min (Z2, kadencja 178) + siłownia (góra + plecy)
- Pt: pływanie (basen lub open water)
- Sob: ZAKŁADKA — rower 75-105 min + bieg 15-20 min (kluczowa symulacja startowa)
- Ndz: długi bieg 60-75 min (baza tlenowa)

SIŁOWNIA: 3x10-12 powt., średni ciężar, pełna kontrola fazy ekscentrycznej. Wt: przysiady bułgarskie, RDL, spacer farmera. Czw: ściąganie wyciągu pionowego, narciarz, Pallof press.

PROTOKÓŁ DEKOMPRESJI L4-L5 (codziennie):
- Przed treningiem: bird-dog, mostki biodrowe z mini-band, mobilizacja bioder 90/90, kot-krowa
- Po treningu: rozciąganie zginaczy bioder w klęku, zwis na drążku, pozycja dziecka, rozciąganie m. gruszkowatego`,
};

const SPORT_META = {
  cycling:  { label: 'Kolarstwo', short: 'Bike', icon: Bike,        color: C.lime },
  running:  { label: 'Bieganie',  short: 'Run',  icon: Footprints,  color: C.cyan },
  swimming: { label: 'Pływanie',  short: 'Swim', icon: Waves,       color: C.pink },
  strength: { label: 'Siłownia',  short: 'Gym',  icon: Dumbbell,    color: '#b48aff' },
  other:    { label: 'Inne',      short: 'Other',icon: Activity,    color: C.amber },
};

// ============================================================
// Helpers
// ============================================================
const fmtDur = (s) => { if (!s) return '–'; const h=Math.floor(s/3600), m=Math.floor((s%3600)/60); return h>0?`${h}h ${String(m).padStart(2,'0')}m`:`${m}m`; };
const fmtDist = (m) => m ? (m/1000).toFixed(1)+' km' : '–';
const fmtDate = (iso) => new Date(iso).toLocaleDateString('pl-PL',{day:'2-digit',month:'short'});
const fmtDateFull = (iso) => new Date(iso).toLocaleDateString('pl-PL',{day:'2-digit',month:'short',year:'numeric'});
const isoDay = (d) => {
  // Use local date components — toISOString() converts to UTC and shifts by tz offset
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

async function loadState() {
  try { const r = await window.storage.get(STORAGE_KEY); if (r && r.value) return JSON.parse(r.value); } catch(e){}
  return null;
}
async function saveState(state) {
  try { await window.storage.set(STORAGE_KEY, JSON.stringify(state)); } catch(e){ console.error(e); }
}

// ============================================================
// Speech Recognition hook (Web Speech API)
// ============================================================
function useSpeechRecognition({ lang = 'pl-PL', onFinal } = {}) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState(null);
  const recognitionRef = useRef(null);
  const finalAccumRef = useRef('');

  const supported = typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const start = useCallback(() => {
    if (!supported) {
      setError('Twoja przeglądarka nie obsługuje rozpoznawania głosu. Użyj pola tekstowego poniżej.');
      return;
    }
    setError(null);
    finalAccumRef.current = '';
    setTranscript('');
    setInterimText('');

    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new Rec();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;

    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalAccumRef.current += e.results[i][0].transcript + ' ';
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      setTranscript(finalAccumRef.current);
      setInterimText(interim);
    };

    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'permission-denied') {
        setError('Brak dostępu do mikrofonu. Sprawdź ustawienia przeglądarki.');
      } else if (e.error === 'no-speech') {
        // common, ignore
      } else if (e.error === 'aborted') {
        // user-initiated, ignore
      } else {
        setError(`Błąd rozpoznawania: ${e.error}`);
      }
      setIsListening(false);
    };

    r.onend = () => {
      setIsListening(false);
      setInterimText('');
      const final = finalAccumRef.current.trim();
      if (onFinal && final) onFinal(final);
    };

    try {
      r.start();
      recognitionRef.current = r;
      setIsListening(true);
    } catch (e) {
      setError('Nie udało się uruchomić mikrofonu: ' + e.message);
    }
  }, [lang, onFinal, supported]);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch(e) {}
    }
  }, []);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch(e) {}
      }
    };
  }, []);

  return { isListening, transcript, interimText, error, supported, start, stop, setTranscript };
}

// ============================================================
// TSS / PMC
// ============================================================
function computeTSS(activity, settings) {
  // Manual TSS takes priority — user explicitly set it
  if (activity.manualTSS && activity.manualTSS > 0) return activity.manualTSS;
  // Then Garmin's own TSS (power-based)
  if (activity.garminTSS && activity.garminTSS > 0) return activity.garminTSS;
  const hours = activity.durationSec / 3600;
  if (hours <= 0) return 0;
  // Strength: heuristic ~70 TSS/h (lower than cardio threshold but still significant)
  if (activity.sport === 'strength') return Math.round(hours * 70);
  if (activity.normalizedPower && settings.ftp > 0) {
    const IF = activity.normalizedPower / settings.ftp;
    return Math.round(hours * activity.normalizedPower * IF / settings.ftp * 100);
  }
  if (activity.avgHR && settings.thresholdHR > 0) {
    const i = activity.avgHR / settings.thresholdHR;
    return Math.round(hours * i * i * 100);
  }
  return Math.round(hours * 50);
}

function computePMC(activities, daysBack = 90) {
  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(today); start.setDate(start.getDate() - daysBack);
  const warmStart = new Date(start); warmStart.setDate(warmStart.getDate() - 60);

  const dailyTSS = {};
  activities.forEach(a => {
    const k = a.date.slice(0,10);
    dailyTSS[k] = (dailyTSS[k] || 0) + (a.tss || 0);
  });

  const days = [];
  let ctl = 0, atl = 0;
  for (let d = new Date(warmStart); d <= today; d.setDate(d.getDate()+1)) {
    const k = isoDay(d);
    const tss = dailyTSS[k] || 0;
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;
    if (d >= start) {
      days.push({
        date: k,
        dateShort: fmtDate(k),
        tss,
        ctl: Math.round(ctl*10)/10,
        atl: Math.round(atl*10)/10,
        tsb: Math.round((ctl-atl)*10)/10,
      });
    }
  }
  return days;
}

// PMC per sport — same logic as computePMC but filtered to single sport.
// Returns { cycling: [...], running: [...], swimming: [...], strength: [...] }
function computePMCPerSport(activities, daysBack = 90) {
  const sports = ['cycling', 'running', 'swimming', 'strength'];
  const result = {};
  sports.forEach(s => {
    result[s] = computePMC(activities.filter(a => a.sport === s), daysBack);
  });
  return result;
}

// Time in Zone — compute seconds spent in each zone using HR samples.
// Returns { Z1: 240, Z2: 1200, Z3: 600, Z4: 360, Z5: 60 } in seconds.
// activity must have samples; sport determines zone model.
function computeTimeInZone(activity, settings) {
  if (!activity.samples || activity.samples.length < 2) return null;
  const zones = computeZones(settings);
  const sport = activity.sport;
  if (sport !== 'cycling' && sport !== 'running') return null;
  const z = sport === 'cycling' ? zones.cycling : zones.running;

  // For cycling, prefer power. For running, use HR.
  const usePower = sport === 'cycling' && activity.samples.some(s => s.p !== null && s.p > 0);

  const result = { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };
  if (sport === 'cycling') result.Z6 = 0;

  for (let i = 0; i < activity.samples.length - 1; i++) {
    const s = activity.samples[i];
    const next = activity.samples[i + 1];
    const dt = Math.max(0, (next.t - s.t)); // seconds
    if (dt <= 0) continue;

    let val;
    if (usePower) {
      val = s.p;
      if (val === null || val <= 0) continue;
    } else {
      val = s.h;
      if (val === null || val <= 0) continue;
    }

    let zoneKey = null;
    for (const zk of Object.keys(z)) {
      const zd = z[zk];
      if (usePower) {
        const lo = zd.pwrLo || 0;
        const hi = zd.pwrHi || Infinity;
        if (val >= lo && val <= hi) { zoneKey = zk; break; }
      } else {
        const lo = zd.hrLo || 0;
        const hi = zd.hrHi || Infinity;
        if (val >= lo && val <= hi) { zoneKey = zk; break; }
      }
    }
    if (zoneKey && result[zoneKey] !== undefined) {
      result[zoneKey] += dt;
    }
  }

  return { zones: result, basedOn: usePower ? 'power' : 'hr' };
}

// Power Duration Curve — for each duration (5s, 30s, 1min, 5min, 20min, 60min),
// find the best average power sustained for that period.
// Returns array of { duration: '5s', durationSec: 5, watts: 850 }
function computePowerDurationCurve(activity) {
  if (!activity.samples || activity.samples.length < 5) return null;
  const samples = activity.samples.filter(s => s.p !== null && s.p > 0);
  if (samples.length < 5) return null;

  // Approximate sample interval
  const intervals = [];
  for (let i = 1; i < Math.min(samples.length, 20); i++) {
    intervals.push(samples[i].t - samples[i - 1].t);
  }
  const sampleInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length || 5;

  const targets = [
    { label: '5s', sec: 5 },
    { label: '15s', sec: 15 },
    { label: '30s', sec: 30 },
    { label: '1min', sec: 60 },
    { label: '2min', sec: 120 },
    { label: '5min', sec: 300 },
    { label: '10min', sec: 600 },
    { label: '20min', sec: 1200 },
    { label: '60min', sec: 3600 },
  ];

  const total = (samples[samples.length - 1].t - samples[0].t);
  const result = [];

  for (const t of targets) {
    if (t.sec > total) continue;
    const window = Math.max(1, Math.round(t.sec / sampleInterval));
    if (window > samples.length) continue;

    let bestAvg = 0;
    // Rolling sum optimization
    let sum = 0;
    for (let i = 0; i < window; i++) sum += samples[i].p;
    bestAvg = sum / window;
    for (let i = window; i < samples.length; i++) {
      sum += samples[i].p - samples[i - window].p;
      const avg = sum / window;
      if (avg > bestAvg) bestAvg = avg;
    }

    result.push({
      duration: t.label,
      durationSec: t.sec,
      watts: Math.round(bestAvg),
    });
  }

  return result;
}

// Per-kilometer splits — pace, avg HR, avg cadence for each km.
// Uses cumulative distance + timestamps from samples.
function computeSplits(activity) {
  if (!activity.samples || activity.samples.length < 5) return null;
  if (activity.sport !== 'running' && activity.sport !== 'cycling') return null;

  // Samples need distance. TCX stores cumulative distance; if missing, derive from GPS.
  let samples = activity.samples;
  const haveDist = samples.some(s => s.d !== undefined && s.d !== null);

  // If no distance field, derive cumulative distance from GPS coords (haversine)
  let withDist = [];
  if (haveDist) {
    withDist = samples.map(s => ({ t: s.t, dist: s.d, h: s.h, c: s.c }));
  } else if (samples.some(s => s.la !== null && s.la !== undefined)) {
    let cum = 0, prevLa = null, prevLo = null;
    for (const s of samples) {
      if (s.la === null || s.la === undefined) continue;
      if (prevLa !== null) {
        const R = 6371000;
        const dLat = (s.la - prevLa) * Math.PI / 180;
        const dLon = (s.lo - prevLo) * Math.PI / 180;
        const a = Math.sin(dLat/2)**2 + Math.cos(prevLa*Math.PI/180)*Math.cos(s.la*Math.PI/180)*Math.sin(dLon/2)**2;
        cum += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      }
      prevLa = s.la; prevLo = s.lo;
      withDist.push({ t: s.t, dist: cum, h: s.h, c: s.c });
    }
  } else {
    return null; // no way to compute distance
  }

  if (withDist.length < 2) return null;
  const totalDist = withDist[withDist.length - 1].dist;
  if (!totalDist || totalDist < 500) return null; // too short for splits

  const splitMeters = 1000;
  const numSplits = Math.ceil(totalDist / splitMeters);
  const splits = [];

  for (let km = 0; km < numSplits; km++) {
    const startDist = km * splitMeters;
    const endDist = Math.min((km + 1) * splitMeters, totalDist);
    const inSplit = withDist.filter(s => s.dist >= startDist && s.dist < endDist);
    if (inSplit.length < 2) continue;

    const tStart = inSplit[0].t;
    const tEnd = inSplit[inSplit.length - 1].t;
    const distCovered = endDist - startDist;
    const timeSec = tEnd - tStart;
    if (timeSec <= 0) continue;

    // pace in sec per km (normalize to full km)
    const paceSecPerKm = (timeSec / distCovered) * 1000;

    const hrs = inSplit.filter(s => s.h !== null && s.h !== undefined).map(s => s.h);
    const cads = inSplit.filter(s => s.c !== null && s.c !== undefined && s.c > 0).map(s => s.c);

    splits.push({
      km: km + 1,
      partial: endDist - startDist < splitMeters,
      distanceM: Math.round(distCovered),
      paceSecPerKm: Math.round(paceSecPerKm),
      avgHR: hrs.length ? Math.round(hrs.reduce((a,b)=>a+b,0)/hrs.length) : null,
      avgCadence: cads.length ? Math.round(cads.reduce((a,b)=>a+b,0)/cads.length) : null,
    });
  }

  return splits.length > 0 ? splits : null;
}

// HR drift over time — returns downsampled series for charting {t (min), hr, pace}
function computeHRDriftSeries(activity) {
  if (!activity.samples || activity.samples.length < 5) return null;
  const samples = activity.samples.filter(s => s.h !== null && s.h !== undefined && s.h > 0);
  if (samples.length < 10) return null;

  // Downsample to ~80 points for a clean chart
  const target = 80;
  const stride = Math.max(1, Math.floor(samples.length / target));
  const series = [];
  for (let i = 0; i < samples.length; i += stride) {
    const s = samples[i];
    series.push({
      min: Math.round(s.t / 60 * 10) / 10,
      hr: s.h,
      cadence: (s.c !== null && s.c !== undefined && s.c > 0) ? s.c : null,
    });
  }
  return series;
}

// ============================================================
// Parsers
// ============================================================
function parseTCX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid TCX');
  const out = [];
  const acts = doc.getElementsByTagName('Activity');
  for (let i = 0; i < acts.length; i++) {
    const act = acts[i];
    const sportRaw = (act.getAttribute('Sport') || '').toLowerCase();
    const sport = sportRaw.includes('bik') ? 'cycling'
                : sportRaw.includes('run') ? 'running'
                : sportRaw.includes('swim') ? 'swimming' : 'other';
    const dateISO = act.getElementsByTagName('Id')[0]?.textContent || new Date().toISOString();

    let totalTime = 0, totalDist = 0;
    const laps = act.getElementsByTagName('Lap');
    for (let j = 0; j < laps.length; j++) {
      totalTime += parseFloat(laps[j].getElementsByTagName('TotalTimeSeconds')[0]?.textContent || 0);
      totalDist += parseFloat(laps[j].getElementsByTagName('DistanceMeters')[0]?.textContent || 0);
    }

    // Collect timestamped samples for decoupling analysis
    const samples = []; // { t: seconds from start, hr, power, distance }
    const tps = act.getElementsByTagName('Trackpoint');
    let startMs = null;

    for (let k = 0; k < tps.length; k++) {
      const timeStr = tps[k].getElementsByTagName('Time')[0]?.textContent;
      if (!timeStr) continue;
      const tMs = new Date(timeStr).getTime();
      if (isNaN(tMs)) continue;
      if (startMs === null) startMs = tMs;
      const elapsed = (tMs - startMs) / 1000;

      const hrEl = tps[k].getElementsByTagName('HeartRateBpm')[0];
      let hr = null;
      if (hrEl) {
        const v = parseFloat(hrEl.getElementsByTagName('Value')[0]?.textContent || 0);
        if (v > 0) hr = v;
      }

      const distEl = tps[k].getElementsByTagName('DistanceMeters')[0];
      const dist = distEl ? parseFloat(distEl.textContent) : null;

      const wattsEls = tps[k].getElementsByTagName('Watts');
      let power = null;
      for (let q = 0; q < wattsEls.length; q++) {
        const v = parseFloat(wattsEls[q].textContent);
        if (v >= 0) { power = v; break; }
      }

      // GPS coordinates (cycling/running outdoor)
      const posEl = tps[k].getElementsByTagName('Position')[0];
      let lat = null, lon = null;
      if (posEl) {
        const latEl = posEl.getElementsByTagName('LatitudeDegrees')[0];
        const lonEl = posEl.getElementsByTagName('LongitudeDegrees')[0];
        if (latEl) lat = parseFloat(latEl.textContent);
        if (lonEl) lon = parseFloat(lonEl.textContent);
        if (!isFinite(lat) || !isFinite(lon)) { lat = null; lon = null; }
      }

      // Cadence — Garmin stores RunCadence (per-leg spm, ×2 for full) in extensions,
      // or <Cadence> element (bike rpm). We capture both, doubling run cadence.
      let cadence = null;
      const cadEl = tps[k].getElementsByTagName('Cadence')[0];
      if (cadEl) {
        const v = parseFloat(cadEl.textContent);
        if (v >= 0) cadence = v;
      }
      // Look for RunCadence in any extension element (namespaced, so match by suffix)
      const extEl = tps[k].getElementsByTagName('Extensions')[0];
      if (extEl) {
        const all = extEl.getElementsByTagName('*');
        for (let q = 0; q < all.length; q++) {
          const tag = all[q].tagName.toLowerCase();
          if (tag.endsWith('runcadence')) {
            const v = parseFloat(all[q].textContent);
            if (v > 0) { cadence = v * 2; break; } // per-leg → full spm
          }
        }
      }

      samples.push({ t: elapsed, hr, power, distance: dist, lat, lon, cadence });
    }

    const hrV = samples.filter(s => s.hr !== null).map(s => s.hr);
    const pwV = samples.filter(s => s.power !== null).map(s => s.power);
    const cadV = samples.filter(s => s.cadence !== null && s.cadence > 0).map(s => s.cadence);
    const avgHR = hrV.length ? Math.round(hrV.reduce((a,b)=>a+b,0)/hrV.length) : null;
    const maxHR = hrV.length ? Math.max(...hrV) : null;
    const avgPower = pwV.length ? Math.round(pwV.reduce((a,b)=>a+b,0)/pwV.length) : null;
    const avgCadence = cadV.length ? Math.round(cadV.reduce((a,b)=>a+b,0)/cadV.length) : null;

    let np = null;
    if (pwV.length > 30) {
      const win = 30, rolling = [];
      for (let r = win-1; r < pwV.length; r++) {
        let s = 0; for (let q = r-win+1; q <= r; q++) s += pwV[q];
        rolling.push(s/win);
      }
      const fourth = rolling.reduce((s,v)=>s+Math.pow(v,4),0)/rolling.length;
      np = Math.round(Math.pow(fourth, 0.25));
    }

    // Decoupling — only for sustained efforts > 30 min with adequate HR data
    let decoupling = null;
    if (totalTime > 1800 && samples.length > 60 && hrV.length > 30) {
      const midTime = totalTime / 2;
      const firstHalf = samples.filter(s => s.t <= midTime);
      const secondHalf = samples.filter(s => s.t > midTime);

      const halfStats = (half) => {
        const hrs = half.filter(s => s.hr !== null).map(s => s.hr);
        if (hrs.length === 0) return null;
        const avgHr = hrs.reduce((a,b)=>a+b,0)/hrs.length;

        // Prefer power for cycling, fallback to speed/pace
        const pwrs = half.filter(s => s.power !== null && s.power > 30).map(s => s.power);
        if (pwrs.length > hrs.length * 0.5) {
          const avgPwr = pwrs.reduce((a,b)=>a+b,0)/pwrs.length;
          return { hr: avgHr, output: avgPwr };
        }

        // Use pace (speed) — first and last distance samples
        const distSamples = half.filter(s => s.distance !== null);
        if (distSamples.length >= 2) {
          const first = distSamples[0];
          const last = distSamples[distSamples.length - 1];
          const dist = last.distance - first.distance;
          const time = last.t - first.t;
          if (time > 60 && dist > 100) {
            return { hr: avgHr, output: dist / time };
          }
        }
        return null;
      };

      const a = halfStats(firstHalf);
      const b = halfStats(secondHalf);
      if (a && b && a.output > 0 && b.output > 0) {
        const ratio1 = a.hr / a.output;
        const ratio2 = b.hr / b.output;
        decoupling = Math.round((ratio2 - ratio1) / ratio1 * 1000) / 10;
      }
    }

    // Compress samples: keep every 5th data point + min/max preserved
    // Reduces 3600-point hour to ~720 points (~30KB JSON, manageable in localStorage)
    let compactSamples = null;
    if (samples.length > 0) {
      const stride = Math.max(1, Math.floor(samples.length / 720));
      compactSamples = [];
      for (let k = 0; k < samples.length; k += stride) {
        const s = samples[k];
        compactSamples.push({
          t: Math.round(s.t),
          h: s.hr !== null ? s.hr : null,
          p: s.power !== null ? s.power : null,
          c: s.cadence !== null ? Math.round(s.cadence) : null,
          d: s.distance !== null && s.distance !== undefined ? Math.round(s.distance) : null,
          // GPS — only if present, rounded to 6 decimals (~10cm precision is enough)
          la: s.lat !== null ? Math.round(s.lat * 1000000) / 1000000 : null,
          lo: s.lon !== null ? Math.round(s.lon * 1000000) / 1000000 : null,
        });
      }
    }

    out.push({
      id: `tcx_${dateISO}_${i}`,
      date: dateISO, sport,
      durationSec: Math.round(totalTime),
      distanceM: Math.round(totalDist),
      avgHR, maxHR, avgPower, normalizedPower: np, avgCadence,
      decoupling,
      samples: compactSamples,
      nutrition: [],
      source: 'tcx', name: '',
    });
  }
  return out;
}

function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid GPX');
  const out = [];
  const tracks = doc.getElementsByTagName('trk');
  for (let t = 0; t < tracks.length; t++) {
    const trk = tracks[t];
    const name = trk.getElementsByTagName('name')[0]?.textContent || '';
    const type = (trk.getElementsByTagName('type')[0]?.textContent || '').toLowerCase();
    const probe = (type + ' ' + name).toLowerCase();
    const sport = probe.includes('bik') || probe.includes('cycl') || probe.includes('rower') ? 'cycling'
                : probe.includes('run') || probe.includes('bieg') ? 'running'
                : probe.includes('swim') || probe.includes('pływ') ? 'swimming' : 'cycling';

    const pts = trk.getElementsByTagName('trkpt');
    if (pts.length === 0) continue;
    const firstTime = pts[0].getElementsByTagName('time')[0]?.textContent;
    const lastTime = pts[pts.length-1].getElementsByTagName('time')[0]?.textContent;
    let dur = 0;
    if (firstTime && lastTime) dur = (new Date(lastTime) - new Date(firstTime)) / 1000;

    let dist = 0, prevLat = null, prevLon = null;
    const hrV = [];
    const gpsPoints = []; // {t, la, lo, h}
    const startMs = firstTime ? new Date(firstTime).getTime() : null;
    for (let p = 0; p < pts.length; p++) {
      const lat = parseFloat(pts[p].getAttribute('lat'));
      const lon = parseFloat(pts[p].getAttribute('lon'));
      if (prevLat !== null) {
        const R = 6371000;
        const dLat = (lat-prevLat)*Math.PI/180;
        const dLon = (lon-prevLon)*Math.PI/180;
        const a = Math.sin(dLat/2)**2 + Math.cos(prevLat*Math.PI/180)*Math.cos(lat*Math.PI/180)*Math.sin(dLon/2)**2;
        dist += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      }
      prevLat = lat; prevLon = lon;
      let ptHr = null;
      const ext = pts[p].getElementsByTagName('extensions')[0];
      if (ext) {
        const all = ext.getElementsByTagName('*');
        for (let g = 0; g < all.length; g++) {
          if (all[g].tagName.toLowerCase().endsWith('hr')) {
            const v = parseFloat(all[g].textContent);
            if (v > 0) { hrV.push(v); ptHr = v; }
          }
        }
      }
      const tStr = pts[p].getElementsByTagName('time')[0]?.textContent;
      const tElapsed = (tStr && startMs !== null) ? (new Date(tStr).getTime() - startMs) / 1000 : p;
      gpsPoints.push({ t: Math.round(tElapsed), la: lat, lo: lon, h: ptHr, p: null });
    }
    // Compress samples — keep every Nth point, max ~720
    let compactSamples = null;
    if (gpsPoints.length > 0) {
      const stride = Math.max(1, Math.floor(gpsPoints.length / 720));
      compactSamples = [];
      for (let k = 0; k < gpsPoints.length; k += stride) {
        const g = gpsPoints[k];
        compactSamples.push({
          t: g.t,
          h: g.h,
          p: null,
          la: Math.round(g.la * 1000000) / 1000000,
          lo: Math.round(g.lo * 1000000) / 1000000,
        });
      }
    }

    out.push({
      id: `gpx_${firstTime}_${t}`,
      date: firstTime || new Date().toISOString(),
      sport,
      durationSec: Math.round(dur),
      distanceM: Math.round(dist),
      avgHR: hrV.length ? Math.round(hrV.reduce((a,b)=>a+b,0)/hrV.length) : null,
      maxHR: hrV.length ? Math.max(...hrV) : null,
      avgPower: null, normalizedPower: null,
      samples: compactSamples,
      source: 'gpx', name,
    });
  }
  return out;
}

function parseGarminCSV(text) {
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (parsed.errors && parsed.errors.length > 0 && !parsed.data.length) {
    throw new Error('Invalid CSV');
  }

  const col = (row, ...names) => {
    for (const n of names) {
      if (row[n] !== undefined && row[n] !== null && row[n] !== '' && row[n] !== '--') return row[n];
    }
    return null;
  };

  const num = (v) => {
    if (!v || v === '--') return null;
    const s = String(v).replace(/,/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };

  const timeToSec = (t) => {
    if (!t || t === '--' || t === '--:--:--') return 0;
    const parts = String(t).split(':').map(p => parseFloat(p));
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
    if (parts.length === 2) return parts[0]*60 + parts[1];
    return parts[0] || 0;
  };

  // Pace string "5:44" → seconds (per km for run, per 100m for swim). Keep raw too.
  const paceToSec = (t) => {
    if (!t || t === '--') return null;
    const parts = String(t).split(':').map(p => parseFloat(p));
    if (parts.some(isNaN)) return null;
    if (parts.length === 2) return parts[0]*60 + parts[1];
    if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
    return null;
  };

  const out = [];
  parsed.data.forEach((row, i) => {
    const typeRaw = String(col(row, 'Typ aktywności', 'Activity Type') || '').toLowerCase();
    let sport = 'other';
    if (typeRaw.includes('kolar') || typeRaw.includes('cycl') || typeRaw.includes('bik') || typeRaw.includes('rower')) sport = 'cycling';
    else if (typeRaw.includes('bieg') || typeRaw.includes('run')) sport = 'running';
    else if (typeRaw.includes('pływ') || typeRaw.includes('swim')) sport = 'swimming';
    else if (typeRaw.includes('sił') || typeRaw.includes('strength') || typeRaw.includes('siła')) sport = 'strength';

    const isOpenWater = typeRaw.includes('open') || typeRaw.includes('otwart');

    const dateRaw = col(row, 'Data', 'Date') || '';
    if (!dateRaw) return;
    const date = dateRaw.includes('T') ? dateRaw : dateRaw.replace(' ', 'T');

    const durationSec = Math.round(timeToSec(col(row, 'Czas', 'Time')));
    if (durationSec <= 0 && sport !== 'strength') return;

    // Distance: km for most sports, meters for swimming (Garmin quirk)
    let distanceM = 0;
    const dist = num(col(row, 'Dystans', 'Distance'));
    if (dist !== null) {
      if (sport === 'swimming' && dist > 20) {
        distanceM = Math.round(dist); // already meters
      } else {
        distanceM = Math.round(dist * 1000);
      }
    }

    const avgHRn = num(col(row, 'Średnie tętno', 'Avg HR'));
    const maxHRn = num(col(row, 'Maksymalne tętno', 'Max HR'));
    const avgPowerN = num(col(row, 'Średnia moc', 'Avg Power'));
    const npN = num(col(row, 'Normalized Power® (NP®)', 'Normalized Power', 'Normalized Power®'));
    const garminTSS = num(col(row, 'Training Stress Score® (TSS®)', 'TSS', 'Training Stress Score®'));

    // Running dynamics
    const avgRunCadence = num(col(row, 'Średnia kadencja biegu', 'Avg Run Cadence'));
    const maxRunCadence = num(col(row, 'Maksymalna kadencja biegu', 'Max Run Cadence'));
    const strideLength = num(col(row, 'Średnia długość kroku', 'Avg Stride Length'));
    const vertOscillation = num(col(row, 'Średnie odchylenie pionowe', 'Avg Vertical Oscillation'));
    const vertRatio = num(col(row, 'Średnie odchylenie do długości', 'Avg Vertical Ratio'));
    const groundContact = num(col(row, 'Średni czas kontaktu z podłożem', 'Avg Ground Contact Time'));

    // Pace metrics (store both raw display + seconds)
    const avgPaceRaw = col(row, 'Średnie tempo', 'Avg Pace');
    const bestPaceRaw = col(row, 'Najlepsze tempo', 'Best Pace');
    const gapRaw = col(row, 'Średni GAP', 'Avg GAP');

    // Elevation
    const totalAscent = num(col(row, 'Całkowity wznios', 'Total Ascent'));
    const totalDescent = num(col(row, 'Całkowity spadek', 'Total Descent'));
    const minElevation = num(col(row, 'Minimalna wysokość', 'Min Elevation'));
    const maxElevation = num(col(row, 'Maksymalna wysokość', 'Max Elevation'));

    // Power extras
    const maxPower = num(col(row, 'Maksymalna moc', 'Max Power'));

    // Swimming
    const totalStrokes = num(col(row, 'Łącznie ruchów', 'Total Strokes'));
    const avgSwolf = num(col(row, 'Średni Swolf', 'Avg Swolf'));
    const avgStrokeRate = col(row, 'Średnie tempo ruchów', 'Avg Stroke Rate');

    // Strength
    const totalReps = num(col(row, 'Razem powtórzeń', 'Total Reps'));
    const totalSets = num(col(row, 'Razem serii', 'Total Sets'));

    // General
    const calories = num(col(row, 'Suma kalorii', 'Calories'));
    const aerobicTE = num(col(row, 'Aerobowy TE', 'Aerobic TE', 'Training Effect'));
    const steps = num(col(row, 'Kroki', 'Steps'));
    const bodyBatteryDrain = num(col(row, 'Utrata Body Battery', 'Body Battery Drain'));
    const minTemp = num(col(row, 'Minimalna temperatura', 'Min Temp'));
    const maxTemp = num(col(row, 'Maksymalna temperatura', 'Max Temp'));
    const laps = num(col(row, 'Liczba okrążeń', 'Number of Laps', 'Laps'));
    const movingTime = timeToSec(col(row, 'Czas ruchu', 'Moving Time'));
    const elapsedTime = timeToSec(col(row, 'Upłynęło czasu', 'Elapsed Time'));

    const a = {
      id: `csv_${date}_${i}`,
      date,
      sport,
      isOpenWater: sport === 'swimming' ? isOpenWater : undefined,
      durationSec,
      distanceM,
      avgHR: avgHRn ? Math.round(avgHRn) : null,
      maxHR: maxHRn ? Math.round(maxHRn) : null,
      avgPower: avgPowerN ? Math.round(avgPowerN) : null,
      maxPower: maxPower ? Math.round(maxPower) : null,
      normalizedPower: npN ? Math.round(npN) : null,
      // Running dynamics
      avgCadence: avgRunCadence ? Math.round(avgRunCadence) : null,
      maxCadence: maxRunCadence ? Math.round(maxRunCadence) : null,
      strideLength: strideLength,
      vertOscillation: vertOscillation,
      vertRatio: vertRatio,
      groundContact: groundContact ? Math.round(groundContact) : null,
      // Pace
      avgPaceRaw: avgPaceRaw,
      avgPaceSec: paceToSec(avgPaceRaw),
      bestPaceRaw: bestPaceRaw,
      gapRaw: gapRaw,
      // Elevation
      totalAscent: totalAscent,
      totalDescent: totalDescent,
      minElevation: minElevation,
      maxElevation: maxElevation,
      // Swimming
      totalStrokes: totalStrokes,
      avgSwolf: avgSwolf,
      avgStrokeRate: avgStrokeRate,
      // Strength
      totalReps: totalReps,
      totalSets: totalSets,
      // General health
      calories: calories ? Math.round(calories) : null,
      aerobicTE: aerobicTE,
      steps: steps ? Math.round(steps) : null,
      bodyBatteryDrain: bodyBatteryDrain,
      minTemp: minTemp,
      maxTemp: maxTemp,
      laps: laps ? Math.round(laps) : null,
      movingTimeSec: movingTime > 0 ? Math.round(movingTime) : null,
      elapsedTimeSec: elapsedTime > 0 ? Math.round(elapsedTime) : null,
      nutrition: [],
      source: 'csv',
      name: col(row, 'Tytuł', 'Title') || '',
    };
    // Garmin's own TSS — use it if non-zero (it means power-based, already computed)
    if (garminTSS && garminTSS > 0) a.garminTSS = Math.round(garminTSS);
    out.push(a);
  });
  return out;
}

// ============================================================
// Reusable UI
// ============================================================
function Card({ children, style = {} }) {
  return <div style={{
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
    padding: 20, boxShadow: '0 1px 2px rgba(15, 20, 25, 0.04)', ...style
  }}>{children}</div>;
}

function Btn({ children, onClick, variant = 'ghost', icon: Icon, style = {}, disabled }) {
  const styles = {
    primary: { background: C.lime, color: '#ffffff', border: 'none' },
    ghost:   { background: 'transparent', color: C.text, border: `1px solid ${C.borderAlt}` },
    danger:  { background: 'transparent', color: C.red, border: `1px solid ${C.red}40` },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...styles[variant], padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
      cursor: disabled ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
      fontFamily: 'inherit', opacity: disabled ? 0.5 : 1, transition: 'all 0.15s', ...style
    }}>
      {Icon && <Icon size={14} />}
      {children}
    </button>
  );
}

function Input({ value, onChange, type = 'text', placeholder, suffix, style = {} }) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={type} value={value} onChange={onChange} placeholder={placeholder}
        style={{
          width: '100%', background: C.surfaceAlt, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: '10px 12px', paddingRight: suffix ? 48 : 12, color: C.text,
          fontSize: 14, fontFamily: 'inherit', outline: 'none', ...style
        }}
      />
      {suffix && <span className="mono" style={{
        position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
        color: C.muted, fontSize: 12,
      }}>{suffix}</span>}
    </div>
  );
}

function KPI({ label, value, unit, sub, color, accent }) {
  const c = color || C.text;
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
        <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</div>
        {accent && <div style={{ width: 8, height: 8, borderRadius: '50%', background: accent, boxShadow: `0 0 8px ${accent}80` }} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <div
          className="mono"
          style={{
            fontSize: 42, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1,
            background: accent ? `linear-gradient(180deg, ${c} 0%, ${accent} 100%)` : c,
            WebkitBackgroundClip: accent ? 'text' : undefined,
            WebkitTextFillColor: accent ? 'transparent' : undefined,
            backgroundClip: accent ? 'text' : undefined,
            color: accent ? 'transparent' : c,
          }}
        >{value}</div>
        {unit && <div className="mono" style={{ fontSize: 12, color: C.muted }}>{unit}</div>}
      </div>
      {sub && <div style={{ fontSize: 12, color: C.textDim, marginTop: 8 }}>{sub}</div>}
    </Card>
  );
}

// Ring chart KPI — circular progress with number inside (TrainX style)
function RingKPI({ label, value, unit, sub, max = 100, accent, size = 110, strokeWidth = 8 }) {
  const c = accent || C.lime;
  const numeric = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^\d.-]/g, '')) || 0;
  const pct = Math.max(0, Math.min(1, Math.abs(numeric) / max));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);

  return (
    <Card>
      <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={C.surfaceAlt} strokeWidth={strokeWidth} />
          <circle
            cx={size/2} cy={size/2} r={radius} fill="none"
            stroke={c} strokeWidth={strokeWidth} strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={offset}
            style={{ filter: `drop-shadow(0 0 6px ${c}80)`, transition: 'stroke-dashoffset 0.5s ease-out' }}
          />
        </svg>
        <div style={{ position: 'absolute', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="mono" style={{ fontSize: 24, fontWeight: 600, color: c, lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</div>
          {unit && <div className="mono" style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{unit}</div>}
        </div>
      </div>
      {sub && <div style={{ fontSize: 12, color: C.textDim, marginTop: 12, textAlign: 'center' }}>{sub}</div>}
    </Card>
  );
}

function LegendDot({ color, label }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.textDim }}>
    <span style={{ width: 10, height: 2, background: color, borderRadius: 1 }} /> {label}
  </span>;
}

// Standardized "small section header" used across cards for consistency
function SectionLabel({ children, color, accent }) {
  return (
    <div className="mono" style={{
      fontSize: 10,
      color: color || C.muted,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      fontWeight: 600,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    }}>
      {accent && <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent }} />}
      {children}
    </div>
  );
}

function Divider({ marginY = 16 }) {
  return <div style={{ height: 1, background: C.border, margin: `${marginY}px 0` }} />;
}

// ============================================================
// Import zone
// ============================================================
function ImportZone({ onImport, importStatus, compact }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => {
        e.preventDefault(); setDrag(false);
        onImport(Array.from(e.dataTransfer.files));
      }}
      style={{
        border: `1.5px dashed ${drag ? C.lime : C.borderAlt}`,
        background: drag ? C.lime + '08' : 'transparent',
        borderRadius: 10, padding: compact ? '20px 24px' : '40px 24px',
        textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s',
      }}
      onClick={() => ref.current?.click()}
    >
      <input
        ref={ref} type="file" multiple accept=".tcx,.gpx,.csv,application/xml,text/xml,text/csv"
        style={{ display: 'none' }}
        onChange={e => onImport(Array.from(e.target.files))}
      />
      <Upload size={compact ? 18 : 24} color={C.lime} style={{ margin: '0 auto 12px' }} />
      <div style={{ fontSize: compact ? 14 : 16, fontWeight: 500, marginBottom: 4 }}>
        Wrzuć pliki <span className="mono" style={{ color: C.lime }}>.csv</span>, <span className="mono" style={{ color: C.lime }}>.tcx</span> lub <span className="mono" style={{ color: C.lime }}>.gpx</span>
      </div>
      <div style={{ fontSize: 12, color: C.muted }}>
        <span className="mono" style={{ color: C.textDim }}>CSV</span>: Garmin Connect → Aktywności → ikona „⋯" → Eksportuj CSV (cała historia w jednym pliku)<br/>
        <span className="mono" style={{ color: C.textDim }}>TCX</span>: pojedyncza aktywność → ikona koła zębatego → Eksportuj jako TCX (dokładniejsze, z mocą/HR streamem)
      </div>
      {importStatus && (
        <div style={{
          marginTop: 16, padding: '8px 12px', borderRadius: 6, fontSize: 12,
          background: importStatus.type === 'success' ? C.lime + '15' : importStatus.type === 'loading' ? C.surfaceAlt : C.amber + '15',
          color: importStatus.type === 'success' ? C.lime : importStatus.type === 'loading' ? C.textDim : C.amber,
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}>
          {importStatus.type === 'loading' && <Loader2 size={12} className="animate-spin" />}
          {importStatus.type === 'success' && <Check size={12} />}
          {importStatus.msg}
        </div>
      )}
    </div>
  );
}

function EmptyState({ onImport, importStatus }) {
  return (
    <div style={{ maxWidth: 700, margin: '40px auto', textAlign: 'center' }}>
      <div style={{
        width: 56, height: 56, borderRadius: 14, background: C.lime + '15',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20
      }}>
        <Zap size={28} color={C.lime} strokeWidth={2} />
      </div>
      <h1 className="serif" style={{ fontSize: 36, fontWeight: 400, margin: 0, letterSpacing: '-0.02em' }}>
        Twoje treningi, Twoja forma.
      </h1>
      <p style={{ color: C.textDim, fontSize: 15, marginTop: 12, marginBottom: 32 }}>
        Wrzuć pliki z Garmin Connect — PaceLab policzy CTL, ATL, TSB i zbuduje plan razem z Tobą.
      </p>
      <Card style={{ padding: 0 }}>
        <ImportZone onImport={onImport} importStatus={importStatus} />
      </Card>
      <div style={{ marginTop: 24, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
        Tip: w Garmin Connect możesz też wybrać kilka aktywności na raz i zrobić eksport zbiorczy.<br/>
        Następnie ustaw FTP i progowe HR w <span style={{ color: C.lime }}>Ustawieniach</span> żeby TSS się dobrze liczył.
      </div>
    </div>
  );
}

// ============================================================
// Activity row
// ============================================================
function ActivityRow({ a, onDelete, onEdit, editable, analyzable, analysis, analyzing, onAnalyze, onClearAnalysis, settings, onUpdateRPE, onUpdateNutrition }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = SPORT_META[a.sport].icon;
  const color = SPORT_META[a.sport].color;
  const editCol = editable && onEdit ? ' 24px' : '';
  const hasDetails = true; // RPE picker always available; charts/map shown if data exists
  const expandCol = hasDetails ? ' 24px' : '';
  const gridCols = '32px 1fr 90px 70px 70px 70px 60px' + expandCol + (analyzable ? ' 24px' : '') + editCol + (editable ? ' 24px' : '');

  return (
    <div>
      <div className="hoverable" style={{
        display: 'grid',
        gridTemplateColumns: gridCols,
        gap: 12, alignItems: 'center', padding: '12px 8px', borderRadius: 8,
        transition: 'background 0.15s',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, background: color + '20',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={16} color={color} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {a.name || SPORT_META[a.sport].label}
            {a.source === 'manual' && <span className="mono" style={{ marginLeft: 8, fontSize: 9, padding: '1px 6px', background: C.borderAlt, color: C.muted, borderRadius: 99, letterSpacing: '0.1em' }}>MANUAL</span>}
            {a.rpe && <span className="mono" style={{ marginLeft: 8, fontSize: 9, padding: '1px 6px', background: C.lime + '20', color: C.lime, borderRadius: 99, letterSpacing: '0.05em', fontWeight: 600 }}>RPE {a.rpe}</span>}
            {a.nutrition && a.nutrition.length > 0 && <span className="mono" style={{ marginLeft: 6, fontSize: 9, padding: '1px 6px', background: C.amber + '20', color: C.amber, borderRadius: 99, fontWeight: 600 }}>⚡ {a.nutrition.length}</span>}
            {a.avgCadence && a.sport === 'running' && <span className="mono" style={{ marginLeft: 6, fontSize: 9, padding: '1px 6px', background: (a.avgCadence < 175 ? C.amber : C.cyan) + '20', color: a.avgCadence < 175 ? C.amber : C.cyan, borderRadius: 99, fontWeight: 600 }}>{a.avgCadence} spm</span>}
          </div>
          <div className="mono" style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            {fmtDateFull(a.date)}
          </div>
        </div>
        <div className="mono" style={{ fontSize: 12, color: C.textDim, textAlign: 'right' }}>{fmtDur(a.durationSec)}</div>
        <div className="mono" style={{ fontSize: 12, color: C.textDim, textAlign: 'right' }}>{fmtDist(a.distanceM)}</div>
        <div className="mono" style={{ fontSize: 12, color: a.avgHR ? C.textDim : C.muted, textAlign: 'right' }}>
          {a.avgHR ? `${a.avgHR} bpm` : '–'}
        </div>
        <div className="mono" style={{ fontSize: 12, color: a.normalizedPower ? C.textDim : C.muted, textAlign: 'right' }}>
          {a.normalizedPower ? `${a.normalizedPower} W` : '–'}
        </div>
        <div className="mono" style={{ fontSize: 13, color: C.lime, textAlign: 'right', fontWeight: 500 }}>{a.tss || 0}</div>
        {hasDetails && (
          <button
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'Zwiń analizę' : 'Rozwiń analizę'}
            style={{
              background: 'transparent', border: 'none',
              color: expanded ? C.lime : C.textDim,
              cursor: 'pointer', padding: 4, fontSize: 11, fontFamily: 'inherit',
              transition: 'transform 0.15s',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          >
            ▼
          </button>
        )}
        {analyzable && (
          <button
            onClick={() => onAnalyze(a)}
            disabled={analyzing}
            title={analysis ? 'Wygeneruj ponownie' : 'Analizuj'}
            style={{
              background: 'transparent', border: 'none',
              color: analysis ? C.lime : analyzing ? C.muted : C.textDim,
              cursor: analyzing ? 'wait' : 'pointer', padding: 4,
            }}
          >
            {analyzing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          </button>
        )}
        {editable && onEdit && (
          <button onClick={() => onEdit(a)} title="Edytuj" style={{
            background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 4,
          }}>
            <Edit2 size={13} />
          </button>
        )}
        {editable && (
          <button onClick={() => onDelete(a.id)} title="Usuń" style={{
            background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 4,
          }}>
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {analysis && (
        <div style={{
          margin: '4px 8px 12px 52px',
          padding: '10px 14px',
          background: C.lime + '08',
          border: `1px solid ${C.lime}30`,
          borderRadius: 8,
          fontSize: 13,
          color: C.text,
          lineHeight: 1.55,
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}>
          <Sparkles size={14} color={C.lime} style={{ marginTop: 3, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>{analysis}</div>
          {onClearAnalysis && (
            <button onClick={() => onClearAnalysis(a.id)} style={{
              background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 2,
            }}>
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {expanded && hasDetails && (
        <div style={{ margin: '4px 8px 16px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {onUpdateRPE && (
            <RPEPicker activity={a} onChange={(v) => onUpdateRPE(a.id, v)} />
          )}
          {onUpdateNutrition && (
            <NutritionLog activity={a} onChange={(list) => onUpdateNutrition(a.id, list)} />
          )}
          <AllMetrics activity={a} />
          <SplitsTable activity={a} />
          <HRDriftChart activity={a} />
          <MapView activity={a} />
          {a.sport === 'cycling' && a.samples?.some(s => s.p) && (
            <PowerDurationCurveChart activity={a} />
          )}
          <TimeInZoneChart activity={a} settings={settings} />
        </div>
      )}
    </div>
  );
}

function ActivityList({ activities, onDelete, onEdit, editable, analyzable, analyses, analyzingIds, onAnalyze, onClearAnalysis, settings, onUpdateRPE, onUpdateNutrition }) {
  if (activities.length === 0) {
    return <div style={{ color: C.muted, textAlign: 'center', padding: 32, fontSize: 13 }}>Brak aktywności</div>;
  }
  const editCol = editable && onEdit ? ' 24px' : '';
  const headerCols = '32px 1fr 90px 70px 70px 70px 60px' + (analyzable ? ' 24px' : '') + editCol + (editable ? ' 24px' : '');
  return (
    <div>
      <div className="mono" style={{
        display: 'grid',
        gridTemplateColumns: headerCols,
        gap: 12, padding: '8px', fontSize: 10, color: C.muted, letterSpacing: '0.1em',
        textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, marginBottom: 4,
      }}>
        <div></div>
        <div>Aktywność</div>
        <div style={{ textAlign: 'right' }}>Czas</div>
        <div style={{ textAlign: 'right' }}>Dystans</div>
        <div style={{ textAlign: 'right' }}>HR avg</div>
        <div style={{ textAlign: 'right' }}>NP</div>
        <div style={{ textAlign: 'right' }}>TSS</div>
        {analyzable && <div></div>}
        {editable && onEdit && <div></div>}
        {editable && <div></div>}
      </div>
      {activities.map(a => (
        <ActivityRow
          key={a.id}
          a={a}
          onDelete={onDelete}
          onEdit={onEdit}
          editable={editable}
          analyzable={analyzable}
          analysis={analyses?.[a.id]?.text || null}
          analyzing={analyzingIds?.has(a.id) || false}
          onAnalyze={onAnalyze}
          onClearAnalysis={onClearAnalysis}
          settings={settings}
          onUpdateRPE={onUpdateRPE}
          onUpdateNutrition={onUpdateNutrition}
        />
      ))}
    </div>
  );
}

// ============================================================
// Dashboard
// ============================================================
function TodayCard({ unit, today, daysToRace, onSkip, onUnskip, settings, onMarkStrength, onAddManual, onOpenVoice, matchedActivity }) {
  const [showProtocol, setShowProtocol] = useState(false);
  if (!unit) {
    return (
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Calendar size={20} color={C.muted} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Dziś poza planem</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Ustaw datę zawodów w Ustawieniach żeby zobaczyć dzisiejszy trening.</div>
          </div>
        </div>
      </Card>
    );
  }

  const isRest = unit.sport === 'rest';
  const isRace = unit.sport === 'race';
  const SportIcon = isRace ? Target : (SPORT_META[unit.sport]?.icon || Activity);
  const sportColor = isRace ? C.lime : (SPORT_META[unit.sport]?.color || C.text);
  const block = BLOCK_PATTERNS[unit.block];
  const structure = inferStructure(unit.workout, unit.durationMin, unit.sport);

  const dayName = new Date(unit.date).toLocaleDateString('pl-PL', { weekday: 'long' });

  const handleSkip = () => {
    const note = prompt('Powód pominięcia (opcjonalnie):', '');
    if (note === null) return;
    onSkip && onSkip(unit.date, note);
  };

  const canSkip = onSkip && !isRest && !isRace && unit.status !== 'done';
  const showActions = unit.status !== 'skipped' && unit.status !== 'rest';

  // Subtle accent stripe color based on status
  const accent = unit.status === 'done' ? C.lime
              : unit.status === 'skipped' ? C.muted
              : isRest ? C.borderAlt
              : C.cyan;

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {/* Accent stripe */}
      <div style={{ height: 3, background: accent + (unit.status === 'done' ? '' : '70') }} />

      <div style={{ padding: 22 }}>
        {/* Top row: meta + workout title + status */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <SectionLabel>Dziś · {dayName} · Tydz. {unit.week} · {block.short}</SectionLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: sportColor + '15',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <SportIcon size={20} color={sportColor} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 19, fontWeight: 500, lineHeight: 1.25 }}>{unit.workout}</div>
                {unit.durationMin > 0 && (
                  <div className="mono" style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                    {unit.durationMin} min · ~{unit.tssEstimate || 0} TSS
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <StatusBadge status={unit.status} />
            {daysToRace !== null && daysToRace > 0 && (
              <div className="mono" style={{ fontSize: 11, color: C.muted }}>
                <span style={{ color: C.lime, fontWeight: 600 }}>{daysToRace}</span> dni do startu
              </div>
            )}
          </div>
        </div>

        {/* Structure bar (if applicable) */}
        {structure.length > 0 && unit.status !== 'skipped' && (
          <div style={{ marginTop: 18 }}>
            <WorkoutStructure structure={structure} height={14} />
          </div>
        )}

        {/* Expandable workout protocol */}
        {unit.status !== 'skipped' && unit.status !== 'rest' && (
          <div style={{ marginTop: 14 }}>
            <button
              onClick={() => setShowProtocol(!showProtocol)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                color: C.lime, fontSize: 12, fontWeight: 500,
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0,
              }}
            >
              <BookOpen size={12} />
              {showProtocol ? 'Schowaj szczegóły wykonania' : 'Jak to wykonać krok po kroku →'}
            </button>
            {showProtocol && (
              <div style={{ marginTop: 12 }}>
                <WorkoutProtocol unit={unit} settings={settings} />
              </div>
            )}
          </div>
        )}

        {/* Cardio match (if Garmin synced) */}
        {unit.matchedActivity && (
          <div style={{ marginTop: 18 }}>
            <SectionLabel accent={C.lime}>Zrobione · {unit.matchedActivity.name}</SectionLabel>
            <div className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8, fontSize: 12, color: C.textDim }}>
              <span>{fmtDur(unit.matchedActivity.durationSec)}</span>
              <span>{fmtDist(unit.matchedActivity.distanceM)}</span>
              {unit.matchedActivity.avgHR && <span>HR ⌀ {unit.matchedActivity.avgHR}</span>}
              <span style={{ color: C.lime }}>TSS {unit.matchedActivity.tss}</span>
            </div>
          </div>
        )}

        {/* Strength status (combo day) */}
        {unit.strength && unit.status !== 'skipped' && unit.status !== 'rest' && (
          <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Dumbbell size={16} color={unit.strengthMatch ? C.lime : C.muted} />
              <div>
                <SectionLabel accent={unit.strengthMatch ? C.lime : null}>Siłownia uzupełniająca</SectionLabel>
                {unit.strengthMatch ? (
                  <div style={{ fontSize: 13, color: C.lime, marginTop: 4 }}>✓ {fmtDur(unit.strengthMatch.durationSec)} · TSS {unit.strengthMatch.tss}</div>
                ) : (
                  <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>{unit.strength}</div>
                )}
              </div>
            </div>
            {!unit.strengthMatch && onMarkStrength && (
              <Btn onClick={() => onMarkStrength(unit)} variant="primary" icon={Check}>Siłka zrobiona</Btn>
            )}
          </div>
        )}

        {/* Skipped state */}
        {unit.status === 'skipped' && (
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, color: C.textDim }}>
              <span style={{ color: C.muted, marginRight: 6 }}>⊘</span>
              {unit.overrideNote ? `Pominięty: „${unit.overrideNote}"` : 'Pominięty intencjonalnie'}
            </div>
            {onUnskip && <Btn onClick={() => onUnskip(unit.date)} variant="ghost">Cofnij</Btn>}
          </div>
        )}

        {/* Unified action bar */}
        {/* Voice journal CTA — appears after the workout is done OR always for self-reflection */}
        {onOpenVoice && unit.status !== 'rest' && (
          <>
            <Divider />
            <button
              onClick={() => onOpenVoice({ unit, activity: matchedActivity || unit.matchedActivity })}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 10,
                background: `linear-gradient(135deg, ${C.lime}15, ${C.cyan}10)`,
                border: `1px solid ${C.lime}40`,
                color: C.text, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                transition: 'all 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, textAlign: 'left' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: C.lime, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Mic size={18} color="#ffffff" />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>
                    {matchedActivity ? 'Jak Ci poszło?' : 'Dziennik treningu'}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                    Powiedz lub wpisz — AI wyciągnie wnioski i zaproponuje zmiany
                  </div>
                </div>
              </div>
              <span style={{ color: C.lime, fontSize: 13, flexShrink: 0 }}>→</span>
            </button>
          </>
        )}

        {showActions && canSkip && (
          <>
            <Divider />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {onAddManual && (
                  <Btn onClick={() => onAddManual(unit.date)} variant="ghost" icon={Plus}>Dodaj trening</Btn>
                )}
                <a
                  href={googleCalendarLink(unit, settings || {})}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                    background: 'transparent', color: C.text, border: `1px solid ${C.borderAlt}`,
                    textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8,
                    fontFamily: 'inherit',
                  }}
                >
                  <ExternalLink size={13} /> Google Calendar
                </a>
              </div>
              <Btn onClick={handleSkip} variant="ghost">Pomiń dzisiaj</Btn>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function CTLPerSportCard({ activities }) {
  const data = useMemo(() => computePMCPerSport(activities, 90), [activities]);
  const sports = ['cycling', 'running', 'swimming', 'strength'];

  const summaries = sports.map(s => {
    const days = data[s];
    if (!days || days.length === 0) return null;
    const t = days[days.length - 1];
    const count = activities.filter(a => a.sport === s).length;
    return {
      sport: s,
      ctl: Math.round(t.ctl),
      atl: Math.round(t.atl),
      tsb: Math.round(t.tsb),
      count,
      meta: SPORT_META[s],
    };
  }).filter(Boolean);

  // Combined chart data — overlay CTL of each sport
  const chartData = useMemo(() => {
    if (!data.cycling || data.cycling.length === 0) return [];
    return data.cycling.map((d, i) => ({
      date: d.date,
      dateShort: d.dateShort,
      cycling: data.cycling[i]?.ctl || 0,
      running: data.running[i]?.ctl || 0,
      swimming: data.swimming[i]?.ctl || 0,
      strength: data.strength[i]?.ctl || 0,
    }));
  }, [data]);

  const totalCount = summaries.reduce((s, x) => s + x.count, 0);
  if (totalCount === 0) return null;

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>CTL per sport</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Osobna kondycja dla każdego sportu</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
        {summaries.map(s => {
          const Icon = s.meta.icon;
          const tsbColor = s.tsb > 5 ? C.lime : s.tsb < -10 ? C.red : C.amber;
          return (
            <div key={s.sport} style={{
              padding: 12, background: C.surfaceAlt, borderRadius: 8,
              border: `1px solid ${C.border}`, borderLeft: `3px solid ${s.meta.color}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Icon size={14} color={s.meta.color} />
                <div style={{ fontSize: 12, fontWeight: 500 }}>{s.meta.label}</div>
              </div>
              <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: C.muted }}>CTL</span>
                <span style={{ color: s.meta.color, fontWeight: 600 }}>{s.ctl}</span>
              </div>
              <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 4 }}>
                <span style={{ color: C.muted }}>ATL</span>
                <span style={{ color: C.textDim }}>{s.atl}</span>
              </div>
              <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 4 }}>
                <span style={{ color: C.muted }}>TSB</span>
                <span style={{ color: tsbColor, fontWeight: 600 }}>{s.tsb > 0 ? `+${s.tsb}` : s.tsb}</span>
              </div>
              <div className="mono" style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>
                {s.count} aktywności
              </div>
            </div>
          );
        })}
      </div>

      {/* Overlay CTL chart */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 14, fontSize: 11, marginBottom: 8 }} className="mono">
        {summaries.map(s => (
          <LegendDot key={s.sport} color={s.meta.color} label={s.meta.label} />
        ))}
      </div>
      <div style={{ height: 180 }}>
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="dateShort" tick={{ fill: C.muted, fontSize: 10 }} stroke={C.border} interval={Math.max(1, Math.floor(chartData.length / 8))} />
            <YAxis tick={{ fill: C.muted, fontSize: 10 }} stroke={C.border} />
            <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.borderAlt}`, borderRadius: 8, fontSize: 12 }} labelStyle={{ color: C.textDim }} itemStyle={{ color: C.text }} />
            {summaries.map(s => (
              <Line key={s.sport} type="monotone" dataKey={s.sport} stroke={s.meta.color} strokeWidth={2} dot={false} name={s.meta.label} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function Dashboard({ activities, pmcData, today, settings, onImport, importStatus, todayPlanUnit, onSkip, onUnskip, onMarkStrength, onAddManual, onOpenVoice }) {
  const last7 = useMemo(() => {
    const c = Date.now() - 7*24*3600*1000;
    return activities.filter(a => new Date(a.date).getTime() >= c);
  }, [activities]);
  const last7TSS = last7.reduce((s,a) => s + (a.tss||0), 0);
  const last7H = last7.reduce((s,a) => s + a.durationSec, 0) / 3600;

  const daysToRace = settings.goalDate
    ? Math.ceil((new Date(settings.goalDate) - new Date(isoDay(new Date()))) / (1000 * 60 * 60 * 24))
    : null;

  const formLabel = today.tsb > 5 ? 'Świeży'
                  : today.tsb > -10 ? 'Optymalny'
                  : today.tsb > -30 ? 'Zmęczony' : 'Przeciążony';
  const formColor = today.tsb > 5 ? C.cyan
                  : today.tsb > -10 ? C.lime
                  : today.tsb > -30 ? C.amber : C.red;

  const weeklyData = useMemo(() => {
    const w = {};
    activities.forEach(a => {
      const d = new Date(a.date);
      const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1); d.setHours(0,0,0,0);
      const k = isoDay(d);
      if (!w[k]) w[k] = { week: k, tss: 0, label: `${d.getDate()}/${d.getMonth()+1}` };
      w[k].tss += a.tss || 0;
    });
    return Object.values(w).sort((a,b) => new Date(a.week)-new Date(b.week)).slice(-12);
  }, [activities]);

  const sportSplit = useMemo(() => {
    const c = Date.now() - 28*24*3600*1000;
    const recent = activities.filter(a => new Date(a.date).getTime() >= c);
    const by = {};
    recent.forEach(a => { by[a.sport] = (by[a.sport]||0) + a.durationSec/3600; });
    return Object.entries(by).map(([k,v]) => ({
      name: SPORT_META[k].label,
      value: Math.round(v*10)/10,
      color: SPORT_META[k].color,
    })).filter(x => x.value > 0);
  }, [activities]);

  if (activities.length === 0) return <EmptyState onImport={onImport} importStatus={importStatus} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <TodayCard unit={todayPlanUnit} today={today} daysToRace={daysToRace} onSkip={onSkip} onUnskip={onUnskip} settings={settings} onMarkStrength={onMarkStrength} onAddManual={onAddManual} onOpenVoice={onOpenVoice} matchedActivity={todayPlanUnit?.matchedActivity} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
        <RingKPI label="CTL · Fitness" value={Math.round(today.ctl)} unit="TSS/d" sub="42-dniowa średnia" accent={C.lime} max={120} />
        <RingKPI label="ATL · Zmęczenie" value={Math.round(today.atl)} unit="TSS/d" sub="7-dniowa średnia" accent={C.red} max={120} />
        <RingKPI label="TSB · Forma" value={today.tsb > 0 ? `+${Math.round(today.tsb)}` : Math.round(today.tsb)} sub={formLabel} accent={formColor} max={40} />
        <RingKPI label="7-dni TSS" value={last7TSS} sub={`${last7H.toFixed(1)} h · ${last7.length} sesji`} accent={C.cyan} max={700} />
      </div>

      <CTLPerSportCard activities={activities} />

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Performance Management Chart</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Ostatnie 90 dni</div>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 11 }} className="mono">
            <LegendDot color={C.lime} label="CTL" />
            <LegendDot color={C.red} label="ATL" />
            <LegendDot color={C.cyan} label="TSB" />
          </div>
        </div>
        <div style={{ height: 280 }}>
          <ResponsiveContainer>
            <ComposedChart data={pmcData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="dateShort" tick={{ fill: C.muted, fontSize: 10 }} stroke={C.border} interval={Math.max(1, Math.floor(pmcData.length/8))} />
              <YAxis yAxisId="load" tick={{ fill: C.muted, fontSize: 10 }} stroke={C.border} />
              <YAxis yAxisId="tsb" orientation="right" tick={{ fill: C.muted, fontSize: 10 }} stroke={C.border} />
              <Tooltip contentStyle={{ background: C.surfaceAlt, border: `1px solid ${C.borderAlt}`, borderRadius: 8, fontSize: 12 }} labelStyle={{ color: C.textDim }} itemStyle={{ color: C.text }} />
              <ReferenceLine yAxisId="tsb" y={0} stroke={C.borderAlt} strokeDasharray="3 3" />
              <Line yAxisId="load" type="monotone" dataKey="ctl" stroke={C.lime} strokeWidth={2.5} dot={false} name="CTL" />
              <Line yAxisId="load" type="monotone" dataKey="atl" stroke={C.red} strokeWidth={1.5} dot={false} name="ATL" />
              <Line yAxisId="tsb" type="monotone" dataKey="tsb" stroke={C.cyan} strokeWidth={1.5} dot={false} name="TSB" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <Card>
          <div style={{ fontSize: 15, fontWeight: 500 }}>Tygodniowy TSS</div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>Ostatnie 12 tygodni</div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={weeklyData}>
                <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} stroke={C.border} />
                <YAxis tick={{ fill: C.muted, fontSize: 10 }} stroke={C.border} />
                <Tooltip contentStyle={{ background: C.surfaceAlt, border: `1px solid ${C.borderAlt}`, borderRadius: 8, fontSize: 12 }} labelStyle={{ color: C.textDim }} />
                <Bar dataKey="tss" fill={C.lime} radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <div style={{ fontSize: 15, fontWeight: 500 }}>Podział sportów</div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>Ostatnie 28 dni</div>
          <div style={{ height: 180 }}>
            {sportSplit.length > 0 ? (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={sportSplit} dataKey="value" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {sportSplit.map((s,i) => <Cell key={i} fill={s.color} stroke="none" />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: C.surfaceAlt, border: `1px solid ${C.borderAlt}`, borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : <div style={{ color: C.muted, textAlign: 'center', padding: 40, fontSize: 13 }}>Brak danych</div>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
            {sportSplit.map((s,i) => (
              <div key={i} className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                <span style={{ color: C.textDim }}>{s.name}</span>
                <span>{s.value}h</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <ImportZone onImport={onImport} importStatus={importStatus} compact />
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 500 }}>Ostatnie aktywności</div>
          <div className="mono" style={{ fontSize: 11, color: C.muted }}>{activities.length} ŁĄCZNIE</div>
        </div>
        <ActivityList activities={activities.slice(0, 8)} />
      </Card>
    </div>
  );
}

// ============================================================
// Activities tab
// ============================================================
function makeManualActivity({ date, sport, durationMin, distanceKm, avgHR, tss, name }) {
  const time = sport === 'swimming' ? '06:30' : sport === 'strength' ? '18:00' : '17:30';
  return {
    id: `manual_${date}_${sport}_${Date.now()}`,
    date: `${date}T${time}:00`,
    sport,
    durationSec: Math.round((parseFloat(durationMin) || 0) * 60),
    distanceM: Math.round((parseFloat(distanceKm) || 0) * 1000),
    avgHR: avgHR ? parseInt(avgHR) : null,
    maxHR: null,
    avgPower: null,
    normalizedPower: null,
    decoupling: null,
    source: 'manual',
    name: name || `${SPORT_META[sport].label} (manualne)`,
    manualTSS: tss ? parseInt(tss) : null,
  };
}

function VoiceJournalModal({ onClose, onSave, activity, unit, settings, activities, pmcData, planOverrides, setPlanOverrides, recovery }) {
  const [text, setText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [acceptedSuggestions, setAcceptedSuggestions] = useState(new Set());

  const speech = useSpeechRecognition({
    lang: 'pl-PL',
    onFinal: (final) => setText(prev => prev ? `${prev} ${final}`.trim() : final),
  });

  const displayText = speech.isListening
    ? (speech.transcript + speech.interimText)
    : text;

  const handleAnalyze = async () => {
    const content = (speech.isListening ? speech.transcript + speech.interimText : text).trim();
    if (!content) {
      setError('Najpierw nagraj lub wpisz tekst.');
      return;
    }
    if (speech.isListening) speech.stop();
    setIsProcessing(true);
    setError(null);

    const context = buildContext(activities, pmcData, settings, recovery);
    const activityInfo = activity ? `
DZISIEJSZY TRENING (zrobiony):
- Sport: ${SPORT_META[activity.sport].label}
- Czas: ${fmtDur(activity.durationSec)}
- Dystans: ${fmtDist(activity.distanceM)}
- HR średnie: ${activity.avgHR || '–'}
- TSS: ${activity.tss}
` : '';

    const planInfo = unit ? `\nPLANOWANY TRENING NA DZIŚ:\n${unit.workout}\n` : '';

    const system = `Jesteś coachem analizującym dziennik sportowca po treningu. Sportowiec opowiedział ustnie jak się czuje i jak poszło.

TWOJE ZADANIE:
1. Wyciągnij 2-4 KONKRETNE obserwacje z tego co powiedział (krótkie, faktyczne)
2. Oceń ogólne samopoczucie: "great" / "good" / "meh" / "bad"
3. Zaproponuj 0-3 KONKRETNE SUGESTIE ZMIAN. Każda sugestia musi mieć typ:
   - "rule" — dodanie reguły do coachingu (zwięzła, max 100 znaków, np. "Bieg z rana tylko gdy > 10°C")
   - "skip" — propozycja pominięcia konkretnego dnia (z datą YYYY-MM-DD i krótkim powodem)
   - "note" — uwaga bez automatycznej akcji (np. "Rozważ konsultację z fizjoterapeutą")

NIE wymyślaj sugestii na siłę. Lepiej zwrócić pustą listę niż słabe sugestie.
Sugestii typu "skip" używaj TYLKO gdy sportowiec wyraźnie sygnalizuje zmęczenie/ból.
Sugestii typu "rule" używaj gdy obserwujesz powtarzający się wzorzec.

KONTEKST SPORTOWCA:
${context}

${planInfo}${activityInfo}

ZWRÓĆ WYŁĄCZNIE JSON (bez \`\`\`json):
{
  "summary": "jedno-dwa zdania podsumowania po polsku",
  "feeling": "great|good|meh|bad",
  "observations": ["obserwacja 1", "obserwacja 2"],
  "suggestions": [
    {"id": "s1", "type": "rule", "text": "treść reguły", "rationale": "dlaczego (1 zdanie)"},
    {"id": "s2", "type": "skip", "date": "YYYY-MM-DD", "note": "powód"},
    {"id": "s3", "type": "note", "text": "uwaga"}
  ]
}`;

    try {
      const data = await callClaude({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system,
        messages: [{ role: 'user', content: `Mój wpis głosowy:\n\n${content}` }],
      });
      const raw = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      setAnalysis(parsed);
    } catch (e) {
      setError(`Nie udało się przeanalizować: ${e.message}`);
    }
    setIsProcessing(false);
  };

  const acceptSuggestion = (sug) => {
    if (acceptedSuggestions.has(sug.id)) return;
    if (sug.type === 'rule') {
      // Settings update handled outside via callback in onSave entry
    } else if (sug.type === 'skip' && sug.date) {
      setPlanOverrides({
        ...(planOverrides || {}),
        [sug.date]: { action: 'skip', note: sug.note || 'AI: ' + (sug.note || ''), ts: new Date().toISOString() },
      });
    }
    setAcceptedSuggestions(prev => new Set(prev).add(sug.id));
  };

  const handleSaveAndClose = () => {
    const content = (speech.isListening ? speech.transcript + speech.interimText : text).trim();
    if (!content) { onClose(); return; }
    if (speech.isListening) speech.stop();

    const entry = {
      id: `j_${Date.now()}`,
      timestamp: new Date().toISOString(),
      date: isoDay(new Date()),
      transcript: content,
      analysis: analysis || null,
      activityId: activity?.id || null,
      acceptedSuggestionIds: Array.from(acceptedSuggestions),
    };

    // Collect rule suggestions to be added to settings.rules
    const newRules = analysis?.suggestions
      ?.filter(s => s.type === 'rule' && acceptedSuggestions.has(s.id))
      .map(s => s.text) || [];

    onSave(entry, newRules);
    onClose();
  };

  const feelingColor = analysis?.feeling === 'great' ? C.lime
                     : analysis?.feeling === 'good' ? C.lime
                     : analysis?.feeling === 'meh' ? C.amber
                     : analysis?.feeling === 'bad' ? C.red : C.muted;

  const feelingLabel = {
    great: 'Świetnie',
    good: 'Dobrze',
    meh: 'Średnio',
    bad: 'Słabo',
  }[analysis?.feeling] || '';

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        background: C.surface, border: `1px solid ${C.borderAlt}`,
        borderRadius: 12, padding: 24, width: '100%', maxWidth: 560,
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <SectionLabel>Dziennik treningu</SectionLabel>
            <div className="serif" style={{ fontSize: 24, fontStyle: 'italic', marginTop: 6 }}>Jak Ci poszło?</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
              Powiedz lub wpisz jak się czujesz. AI wyciągnie konkretne wnioski i zaproponuje zmiany.
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Mic / record button — only when supported AND no permission error */}
        {speech.supported && !speech.error && (
          <>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
              <button
                onClick={speech.isListening ? speech.stop : speech.start}
                style={{
                  width: 80, height: 80, borderRadius: '50%',
                  background: speech.isListening ? C.red : C.lime,
                  color: '#ffffff',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'inherit',
                  animation: speech.isListening ? 'pulse 1.4s ease-in-out infinite' : 'none',
                  transition: 'all 0.2s',
                  boxShadow: speech.isListening ? `0 0 0 8px ${C.red}25` : 'none',
                }}
                title={speech.isListening ? 'Stop' : 'Nagrywaj'}
              >
                {speech.isListening ? <MicOff size={32} /> : <Mic size={32} />}
              </button>
            </div>
            <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 12, color: C.muted }}>
              {speech.isListening ? '🔴 Mów teraz... kliknij żeby zakończyć' : 'Kliknij mikrofon · albo wpisz poniżej'}
            </div>
          </>
        )}

        {/* Fallback explanation when mic is blocked or unavailable */}
        {(!speech.supported || speech.error) && (
          <div style={{ marginBottom: 16, padding: '12px 14px', background: C.surfaceAlt, borderRadius: 8, border: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <MicOff size={16} color={C.muted} style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1, fontSize: 12, color: C.textDim, lineHeight: 1.55 }}>
                {!speech.supported
                  ? 'Twoja przeglądarka nie obsługuje rozpoznawania głosu.'
                  : 'Mikrofon zablokowany lub niedostępny w tym środowisku.'}
                {' '}
                <strong style={{ color: C.text }}>Wpisz poniżej</strong> — AI da identyczną analizę i sugestie.
              </div>
            </div>
            {speech.error && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: 11, color: C.muted, cursor: 'pointer' }}>Jak odblokować mikrofon</summary>
                <div style={{ fontSize: 11, color: C.textDim, marginTop: 8, lineHeight: 1.7, paddingLeft: 4 }}>
                  1. Kliknij ikonkę 🔒 lub ⓘ w pasku adresu<br/>
                  2. Znajdź <span className="mono">Mikrofon</span> → <span className="mono">Dozwolony</span><br/>
                  3. Odśwież stronę i spróbuj ponownie<br/>
                  <br/>
                  Jeśli nadal nie działa — to ograniczenie iframe Claude.ai. Pełen głos wymaga uruchomienia jako standalone (Vite/Node).
                </div>
              </details>
            )}
          </div>
        )}

        {/* Transcript / text field */}
        <SectionLabel>{speech.supported && !speech.error ? 'Zapis' : 'Twój wpis'}</SectionLabel>
        <textarea
          value={displayText}
          onChange={(e) => { setText(e.target.value); speech.setTranscript(e.target.value); }}
          placeholder="Np. „Rower poszedł świetnie, dotrzymałem tempa. Plecy lekko drgnęły po godzinie. Spałem słabo wczoraj, czuję się trochę zmęczony."
          rows={(!speech.supported || speech.error) ? 7 : 5}
          autoFocus={!speech.supported || !!speech.error}
          style={{
            width: '100%', background: C.surfaceAlt, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14,
            fontFamily: 'inherit', outline: 'none', resize: 'vertical',
            marginTop: 8, lineHeight: 1.5,
          }}
        />

        {error && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: C.red + '15', color: C.red, borderRadius: 6, fontSize: 12 }}>
            {error}
          </div>
        )}

        {/* Analysis result */}
        {analysis && (
          <div style={{ marginTop: 20 }}>
            <Divider />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <SectionLabel accent={feelingColor}>Analiza</SectionLabel>
              {analysis.feeling && (
                <span className="mono" style={{
                  padding: '4px 10px', borderRadius: 99,
                  background: feelingColor + '15', color: feelingColor,
                  fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
                }}>
                  {feelingLabel}
                </span>
              )}
            </div>

            <div className="serif" style={{ fontSize: 16, fontStyle: 'italic', color: C.textDim, lineHeight: 1.5, marginBottom: 16, paddingLeft: 14, borderLeft: `2px solid ${C.lime}` }}>
              {analysis.summary}
            </div>

            {analysis.observations?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <SectionLabel>Obserwacje</SectionLabel>
                <ul style={{ margin: '8px 0 0', padding: '0 0 0 20px', fontSize: 13, color: C.textDim, lineHeight: 1.7 }}>
                  {analysis.observations.map((o, i) => <li key={i}>{o}</li>)}
                </ul>
              </div>
            )}

            {analysis.suggestions?.length > 0 && (
              <div>
                <SectionLabel accent={C.lime}>Sugestie zmian</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                  {analysis.suggestions.map(sug => {
                    const accepted = acceptedSuggestions.has(sug.id);
                    const typeLabel = sug.type === 'rule' ? 'Reguła'
                                    : sug.type === 'skip' ? 'Pominięcie dnia'
                                    : 'Uwaga';
                    return (
                      <div key={sug.id} style={{
                        padding: 12, background: C.surfaceAlt,
                        border: `1px solid ${accepted ? C.lime + '50' : C.border}`,
                        borderRadius: 8,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
                          <span className="mono" style={{
                            fontSize: 9, padding: '2px 8px', borderRadius: 99,
                            background: C.borderAlt, color: C.muted,
                            letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600,
                          }}>{typeLabel}</span>
                          {sug.type !== 'note' && (
                            <button
                              onClick={() => acceptSuggestion(sug)}
                              disabled={accepted}
                              style={{
                                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontFamily: 'inherit',
                                background: accepted ? C.lime + '20' : 'transparent',
                                color: accepted ? C.lime : C.text,
                                border: `1px solid ${accepted ? C.lime : C.borderAlt}`,
                                cursor: accepted ? 'default' : 'pointer',
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                              }}
                            >
                              {accepted ? <><Check size={11} /> Zaakceptowane</> : 'Akceptuj'}
                            </button>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: C.text }}>
                          {sug.text || (sug.type === 'skip' ? `Pomiń ${sug.date}: ${sug.note}` : '')}
                        </div>
                        {sug.rationale && (
                          <div style={{ fontSize: 11, color: C.muted, marginTop: 6, fontStyle: 'italic' }}>
                            {sug.rationale}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24, flexWrap: 'wrap' }}>
          <Btn onClick={onClose} variant="ghost">Anuluj</Btn>
          {!analysis ? (
            <Btn onClick={handleAnalyze} variant="primary" icon={isProcessing ? Loader2 : Sparkles} disabled={isProcessing || !displayText.trim()}>
              {isProcessing ? 'Analizuję...' : 'Analizuj'}
            </Btn>
          ) : (
            <Btn onClick={handleSaveAndClose} variant="primary" icon={Check}>Zapisz w dzienniku</Btn>
          )}
        </div>

        <style>{`
          @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
          }
        `}</style>
      </div>
    </div>
  );
}

function WorkoutFormModal({ onClose, onSave, settings, editing, defaultDate }) {
  const isEdit = !!editing;
  const [sport, setSport] = useState(editing?.sport || 'strength');
  const [date, setDate] = useState(
    editing ? editing.date.slice(0, 10) : (defaultDate || isoDay(new Date()))
  );
  const [durationMin, setDurationMin] = useState(
    editing ? Math.round(editing.durationSec / 60) : (sport === 'strength' ? 25 : 60)
  );
  const [distanceKm, setDistanceKm] = useState(
    editing && editing.distanceM ? (editing.distanceM / 1000).toFixed(1) : ''
  );
  const [avgHR, setAvgHR] = useState(editing?.avgHR || '');
  const [tss, setTss] = useState(editing?.manualTSS || editing?.tss || '');
  const [name, setName] = useState(editing?.name || '');

  // Auto-set sensible defaults when sport changes (only when creating, not editing)
  useEffect(() => {
    if (isEdit) return;
    if (sport === 'strength') {
      setDurationMin(25);
      setDistanceKm('');
    }
    if (sport === 'swimming') setDurationMin(45);
    if (sport === 'running')  setDurationMin(45);
    if (sport === 'cycling')  setDurationMin(60);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport]);

  const handleSave = () => {
    if (!durationMin || +durationMin <= 0) {
      alert('Podaj czas treningu.');
      return;
    }
    if (isEdit) {
      onSave({
        ...editing,
        sport,
        name: name || editing.name,
        durationSec: Math.round((+durationMin) * 60),
        distanceM: distanceKm ? Math.round(+distanceKm * 1000) : (editing.distanceM || 0),
        avgHR: avgHR ? parseInt(avgHR) : editing.avgHR,
        manualTSS: tss ? parseInt(tss) : editing.manualTSS || null,
      });
    } else {
      onSave(makeManualActivity({ date, sport, durationMin, distanceKm, avgHR, tss, name }));
    }
    onClose();
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.7)', zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={{
        background: C.surface, border: `1px solid ${C.borderAlt}`,
        borderRadius: 12, padding: 24, width: '100%', maxWidth: 480,
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 500 }}>{isEdit ? 'Edytuj aktywność' : 'Dodaj trening ręcznie'}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
              {isEdit ? 'Zmień sport, nazwę, czas lub HR' : 'Siłownia, basen bez zegarka, sesje uzupełniające'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Sport</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {['strength', 'cycling', 'running', 'swimming'].map(s => {
              const m = SPORT_META[s];
              const Icon = m.icon;
              const active = sport === s;
              return (
                <button
                  key={s}
                  onClick={() => setSport(s)}
                  style={{
                    padding: '10px 8px', borderRadius: 8, fontFamily: 'inherit',
                    background: active ? m.color + '15' : C.surfaceAlt,
                    border: `1px solid ${active ? m.color : C.border}`,
                    color: active ? m.color : C.textDim,
                    cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  }}
                >
                  <Icon size={16} />
                  <span style={{ fontSize: 11 }}>{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Data</div>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Czas</div>
            <Input type="number" value={durationMin} onChange={e => setDurationMin(e.target.value)} suffix="min" />
          </div>
          {sport !== 'strength' && (
            <div>
              <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Dystans</div>
              <Input type="number" value={distanceKm} onChange={e => setDistanceKm(e.target.value)} suffix="km" placeholder="opcjonalne" />
            </div>
          )}
          <div>
            <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Średnie HR</div>
            <Input type="number" value={avgHR} onChange={e => setAvgHR(e.target.value)} suffix="bpm" placeholder="opcjonalne" />
          </div>
          <div>
            <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>TSS</div>
            <Input type="number" value={tss} onChange={e => setTss(e.target.value)} placeholder="auto jeśli puste" />
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Nazwa</div>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder={`${SPORT_META[sport].label}${sport === 'strength' ? ' Dół+Core' : ''}`} />
        </div>

        {sport === 'strength' && !tss && (
          <div style={{ padding: '8px 12px', background: C.surfaceAlt, borderRadius: 6, fontSize: 11, color: C.muted, marginBottom: 16 }}>
            Dla siłowni TSS zostanie oszacowany ~30 (sesja 25 min). Dla cięższych sesji podaj wyższy.
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Btn onClick={onClose} variant="ghost">Anuluj</Btn>
          <Btn onClick={handleSave} variant="primary" icon={Check}>{isEdit ? 'Zapisz zmiany' : 'Dodaj trening'}</Btn>
        </div>
      </div>
    </div>
  );
}

function Activities({ activities, setActivities, pmcData, settings, recovery }) {
  const [filter, setFilter] = useState('all');
  const [analyses, setAnalyses] = useState({});
  const [analyzingIds, setAnalyzingIds] = useState(new Set());
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const filtered = filter === 'all' ? activities : activities.filter(a => a.sport === filter);

  // Load cached analyses
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get('pacelab:analyses');
        if (r && r.value) setAnalyses(JSON.parse(r.value));
      } catch (e) {}
    })();
  }, []);

  const persistAnalyses = async (next) => {
    try { await window.storage.set('pacelab:analyses', JSON.stringify(next)); } catch (e) {}
  };

  const onDelete = (id) => {
    if (!confirm('Usunąć aktywność?')) return;
    setActivities(prev => prev.filter(a => a.id !== id));
    // also drop any cached analysis
    if (analyses[id]) {
      const next = { ...analyses };
      delete next[id];
      setAnalyses(next);
      persistAnalyses(next);
    }
  };

  const onClearAnalysis = (id) => {
    const next = { ...analyses };
    delete next[id];
    setAnalyses(next);
    persistAnalyses(next);
  };

  const onUpdateRPE = (id, rpe) => {
    setActivities(prev => prev.map(a => a.id === id ? { ...a, rpe } : a));
  };

  const onUpdateNutrition = (id, nutrition) => {
    setActivities(prev => prev.map(a => a.id === id ? { ...a, nutrition } : a));
  };

  const onAnalyze = async (activity) => {
    setError(null);
    setAnalyzingIds(prev => new Set(prev).add(activity.id));

    const context = buildContext(activities, pmcData, settings, recovery);
    const sportLabel = SPORT_META[activity.sport].label;

    // Splits per km
    const splits = computeSplits(activity);
    let splitsBlock = '';
    if (splits && splits.length > 0) {
      const fmtP = (sec) => `${Math.floor(sec/60)}:${String(Math.round(sec%60)).padStart(2,'0')}`;
      splitsBlock = '\n\nSPLITY PER KILOMETR:\n' + splits.map(s => {
        const paceStr = activity.sport === 'running'
          ? `${fmtP(s.paceSecPerKm)}/km`
          : `${(3600/s.paceSecPerKm).toFixed(1)} km/h`;
        return `KM ${s.km}${s.partial ? ' (część)' : ''}: ${paceStr}` +
          `${s.avgHR ? `, HR ${s.avgHR} bpm` : ''}` +
          `${s.avgCadence ? `, kadencja ${s.avgCadence} spm` : ''}`;
      }).join('\n');
    }

    // HR drift summary
    const driftSeries = computeHRDriftSeries(activity);
    let driftBlock = '';
    if (driftSeries && driftSeries.length > 4) {
      const firstQ = driftSeries.slice(0, Math.floor(driftSeries.length / 4));
      const lastQ = driftSeries.slice(-Math.floor(driftSeries.length / 4));
      const avgFirst = Math.round(firstQ.reduce((a,b)=>a+b.hr,0) / firstQ.length);
      const avgLast = Math.round(lastQ.reduce((a,b)=>a+b.hr,0) / lastQ.length);
      driftBlock = `\n\nDRYF TĘTNA: pierwsza ćwiartka treningu śr. HR ${avgFirst} bpm → ostatnia ćwiartka śr. HR ${avgLast} bpm (różnica ${avgLast - avgFirst > 0 ? '+' : ''}${avgLast - avgFirst} bpm).`;
    }

    // Nutrition
    let nutritionBlock = '';
    if (activity.nutrition && activity.nutrition.length > 0) {
      nutritionBlock = '\n\nŻYWIENIE PODCZAS TRENINGU:\n' + activity.nutrition.map(n =>
        `${n.timeMin !== null ? `${n.timeMin} min` : 'przed startem'}: ${n.product}`
      ).join('\n');
    }

    // Extra metrics block — running dynamics, elevation, swim, strength, environment
    let extraBlock = '';
    const ex = [];
    if (activity.aerobicTE) ex.push(`Aerobic TE: ${activity.aerobicTE}/5`);
    if (activity.calories) ex.push(`Kalorie: ${activity.calories} kcal`);
    if (activity.sport === 'running') {
      if (activity.strideLength) ex.push(`Długość kroku: ${activity.strideLength} m`);
      if (activity.vertOscillation) ex.push(`Oscylacja pionowa: ${activity.vertOscillation} cm`);
      if (activity.groundContact) ex.push(`Czas kontaktu z podłożem: ${activity.groundContact} ms`);
      if (activity.gapRaw) ex.push(`GAP (tempo skorygowane o przewyższenia): ${activity.gapRaw}/km`);
    }
    if (activity.sport === 'swimming') {
      if (activity.avgSwolf) ex.push(`SWOLF: ${activity.avgSwolf}`);
      if (activity.totalStrokes) ex.push(`Ruchy łącznie: ${activity.totalStrokes}`);
    }
    if (activity.sport === 'strength') {
      if (activity.totalReps) ex.push(`Powtórzenia: ${activity.totalReps}, serie: ${activity.totalSets || '–'}`);
    }
    if (activity.totalAscent) ex.push(`Wznios: ${activity.totalAscent} m`);
    if (activity.maxTemp) ex.push(`Temperatura: ${activity.minTemp ?? '?'}–${activity.maxTemp}°C`);
    if (activity.bodyBatteryDrain) ex.push(`Utrata Body Battery: ${activity.bodyBatteryDrain}`);
    if (ex.length > 0) extraBlock = '\n' + ex.join('\n');

    const actLine = `Data: ${fmtDateFull(activity.date)}
Sport: ${sportLabel}
Czas: ${fmtDur(activity.durationSec)}
Dystans: ${fmtDist(activity.distanceM)}
HR średnie: ${activity.avgHR || '–'} bpm
HR max: ${activity.maxHR || '–'} bpm
Kadencja średnia: ${activity.avgCadence ? activity.avgCadence + ' spm' : '–'}
Moc średnia: ${activity.avgPower ? activity.avgPower + ' W' : '–'}
Normalized Power: ${activity.normalizedPower ? activity.normalizedPower + ' W' : '–'}
TSS: ${activity.tss}${activity.rpe ? `\nRPE (odczucie): ${activity.rpe}/10` : ''}${activity.decoupling !== null && activity.decoupling !== undefined ? `
Decoupling (aerobic drift): ${activity.decoupling > 0 ? '+' : ''}${activity.decoupling.toFixed(1)}% (>10% = drift, <5% = świetnie)` : ''}${extraBlock}${splitsBlock}${driftBlock}${nutritionBlock}`;

    const system = `Jesteś ekspertem od treningu wytrzymałościowego analizującym JEDEN trening triathlonisty-amatora.

Przeanalizuj trening WIELOWYMIAROWO (3-5 zdań, po polsku, bez markdown):
1. TEMPO/SPLITY: czy tempo było równe? Pozytywny/negatywny split? Gdzie zwolnił/przyspieszył?
2. TĘTNO: jak się zmieniało? Dryf HR przy stałym tempie = zmęczenie/odwodnienie/ciepło. Skok HR po żelu z kofeiną to normalne (kofeina podnosi HR o 3-8 bpm) i NIE oznacza gorszego treningu jeśli tempo się trzymało.
3. KADENCJA (bieg): cel zawodnika to min. 178 spm dla ochrony L4-L5 i prawego kolana. Jeśli niżej — zaznacz to.
4. ŻYWIENIE: jeśli podano żele/kofeinę/izotonik — skomentuj timing i wpływ. Powiąż przyjęcie z reakcją tętna jeśli widać zależność czasową.
5. WERDYKT: czy trening spełnił cel? Odnieś się do fazy makrocyklu i reguł.

Bądź konkretny, używaj liczb. Bez wstępów typu "Świetny trening!". Jeśli widzisz coś niepokojącego (przeciążenie, kadencja za niska, niezgodność z regułami, niepokojące tętno) — powiedz wprost.

KONTEKST ZAWODNIKA:
${context}

ANALIZOWANY TRENING:
${actLine}`;

    try {
      const data = await callClaude({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system,
        messages: [{ role: 'user', content: 'Przeanalizuj ten trening wielowymiarowo: tempo, tętno, kadencja, żywienie, werdykt.' }],
      });
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      const next = { ...analyses, [activity.id]: { text, generatedAt: new Date().toISOString() } };
      setAnalyses(next);
      persistAnalyses(next);
    } catch (e) {
      setError(`Nie udało się przeanalizować: ${e.message}`);
    }
    setAnalyzingIds(prev => {
      const n = new Set(prev);
      n.delete(activity.id);
      return n;
    });
  };

  const handleSaveManual = (activityOrEdited) => {
    if (editing) {
      // editing existing
      setActivities(prev => prev.map(a => a.id === activityOrEdited.id ? { ...a, ...activityOrEdited } : a));
    } else {
      setActivities(prev => [...prev, activityOrEdited].sort((a, b) => new Date(b.date) - new Date(a.date)));
    }
    setEditing(null);
  };

  const openEdit = (activity) => {
    setEditing(activity);
    setModalOpen(true);
  };

  return (
    <Card>
      {modalOpen && (
        <WorkoutFormModal
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSave={handleSaveManual}
          settings={settings}
          editing={editing}
        />
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 500 }}>Wszystkie aktywności</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
            {filtered.length} z {activities.length} · klik <Sparkles size={11} style={{ display: 'inline', verticalAlign: 'middle', color: C.lime }} /> obok wiersza = analiza AI · klik <Edit2 size={11} style={{ display: 'inline', verticalAlign: 'middle', color: C.textDim }} /> = edycja
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['all', 'cycling', 'running', 'swimming', 'strength', 'other'].map(s => (
              <button key={s} onClick={() => setFilter(s)} style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 12, border: 'none',
                background: filter === s ? C.surfaceAlt : 'transparent',
                color: filter === s ? C.lime : C.textDim, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                {s === 'all' ? 'Wszystkie' : SPORT_META[s].label}
              </button>
            ))}
          </div>
          <Btn onClick={() => setModalOpen(true)} variant="primary" icon={Plus}>Dodaj ręcznie</Btn>
        </div>
      </div>
      {error && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: C.red + '15', color: C.red, borderRadius: 6, fontSize: 12 }}>
          {error}
        </div>
      )}
      <ActivityList
        activities={filtered}
        onDelete={onDelete}
        onEdit={openEdit}
        editable
        analyzable
        analyses={analyses}
        analyzingIds={analyzingIds}
        onAnalyze={onAnalyze}
        onClearAnalysis={onClearAnalysis}
        settings={settings}
        onUpdateRPE={onUpdateRPE}
        onUpdateNutrition={onUpdateNutrition}
      />
    </Card>
  );
}

// ============================================================
// AI Coach
// ============================================================
function buildContext(activities, pmcData, settings, recovery = []) {
  const today = pmcData[pmcData.length-1] || { ctl: 0, atl: 0, tsb: 0 };
  const last14 = activities.filter(a => new Date(a.date).getTime() > Date.now() - 14*24*3600*1000)
    .sort((a,b) => new Date(b.date) - new Date(a.date));

  const weekTSS = {};
  activities.filter(a => new Date(a.date).getTime() > Date.now() - 8*7*24*3600*1000).forEach(a => {
    const d = new Date(a.date);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1); d.setHours(0,0,0,0);
    const k = isoDay(d);
    weekTSS[k] = (weekTSS[k] || 0) + (a.tss || 0);
  });
  const weekly = Object.entries(weekTSS).sort((a,b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}: ${v} TSS`).join('\n');

  const acts = last14.slice(0, 14).map(a =>
    `${a.date.slice(0,10)} · ${SPORT_META[a.sport].short} · ${fmtDur(a.durationSec)} · ${fmtDist(a.distanceM)} · HR ${a.avgHR || '–'} · NP ${a.normalizedPower || '–'}W · TSS ${a.tss}`
  ).join('\n');

  // Recovery — last 30 days of physio/rolling/etc
  const recentRecovery = (recovery || [])
    .filter(r => new Date(r.date).getTime() > Date.now() - 30*24*3600*1000)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const recoveryBlock = recentRecovery.length > 0
    ? recentRecovery.map(r => {
        const label = (RECOVERY_TYPES[r.type] || {}).label || r.type;
        return `${r.date.slice(0,10)} · ${label}${r.areas ? ` · ${r.areas}` : ''}${r.notes ? ` — ${r.notes}` : ''}`;
      }).join('\n')
    : 'brak wpisów';

  return `${settings.rules && settings.rules.length > 0 ? `TWARDE REGUŁY (zawsze przestrzegaj — to są nadrzędne ograniczenia coachingu):\n${settings.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n` : ''}${settings.profile ? `PROFIL SPORTOWCA (bardzo ważny kontekst — zawsze uwzględniaj):\n${settings.profile}\n\n` : ''}DANE LICZBOWE:
- Główny sport: ${SPORT_META[settings.primarySport].label}
- FTP: ${settings.ftp} W
- Próg HR: ${settings.thresholdHR} bpm
- Max HR: ${settings.maxHR} bpm
- Waga: ${settings.weight} kg
- Cel: ${settings.goalType || 'nie ustawiony'}${settings.goalDate ? ` (${settings.goalDate})` : ''}
${settings.goalNotes ? `- Notatki do celu: ${settings.goalNotes}` : ''}

Aktualne metryki (dziś):
- CTL (fitness): ${Math.round(today.ctl)} TSS/d
- ATL (zmęczenie): ${Math.round(today.atl)} TSS/d
- TSB (forma): ${Math.round(today.tsb)}

TSS tygodniowy (ostatnie 8 tygodni):
${weekly || 'brak danych'}

Ostatnie 14 dni aktywności:
${acts || 'brak'}

REGENERACJA / FIZJOTERAPIA (ostatnie 30 dni — KRYTYCZNE dla planowania, uwzględnij zalecenia fizjo):
${recoveryBlock}`;
}

function Coach({ activities, pmcData, settings, history, setHistory, recovery }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [history, loading]);

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    const newHistory = [...history, { role: 'user', content: msg }];
    setHistory(newHistory);
    setInput('');
    setLoading(true);

    const context = buildContext(activities, pmcData, settings, recovery);
    const system = `Jesteś ekspertem od treningu wytrzymałościowego (kolarstwo, bieganie, triathlon).
Analizujesz dane sportowca i odpowiadasz konkretnie po polsku.
Używaj liczb (TSS, CTL, ATL, TSB, godziny, watty, tempo). Bądź zwięzły ale merytoryczny.
Jeśli sportowiec prosi o plan — daj plan tygodniowy w formie listy dni z konkretnymi treningami (rodzaj, czas, intensywność/strefa).
Jeśli analizujesz — wskaż konkretne wzorce w danych i wnioski.
Nie udzielaj porad medycznych. Jeśli widzisz oznaki przeciążenia (TSB < -30), zasugeruj odpoczynek.

${context}`;

    try {
      const data = await callClaude({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system,
        messages: newHistory.map(m => ({ role: m.role, content: m.content })),
      });
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      setHistory([...newHistory, { role: 'assistant', content: text || '(pusta odpowiedź)' }]);
    } catch (e) {
      setHistory([...newHistory, { role: 'assistant', content: `Błąd: ${e.message}` }]);
    }
    setLoading(false);
  };

  const suggestions = [
    'Jak wyglądała moja forma w ostatnim miesiącu?',
    'Zaproponuj plan na następny tydzień',
    'Czy jestem przetrenowany?',
    'Na czym powinienem się skupić, żeby zwiększyć CTL?',
  ];

  return (
    <Card style={{ padding: 0, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', minHeight: 500 }}>
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: C.lime + '20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Sparkles size={14} color={C.lime} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>Coach AI</div>
          <div style={{ fontSize: 11, color: C.muted }}>Widzi Twoje dane · Claude Sonnet</div>
        </div>
        {history.length > 0 && (
          <button onClick={() => setHistory([])} style={{
            background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 12,
            fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <Trash2 size={12} /> Wyczyść
          </button>
        )}
      </div>

      <div className="scroll" style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {history.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div className="serif" style={{ fontSize: 28, fontStyle: 'italic', color: C.textDim, textAlign: 'center', maxWidth: 400 }}>
              Zapytaj o swój trening
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 32, width: '100%', maxWidth: 480 }}>
              {suggestions.map((s,i) => (
                <button key={i} onClick={() => send(s)} className="hoverable" style={{
                  background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 8,
                  padding: '10px 14px', textAlign: 'left', color: C.textDim, fontSize: 13,
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {history.map((m, i) => <Bubble key={i} message={m} />)}
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13 }}>
                <Loader2 size={14} className="animate-spin" /> Coach analizuje...
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div style={{ padding: 16, borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }}}
          placeholder="Zadaj pytanie..."
          style={{
            flex: 1, background: C.surfaceAlt, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 14, outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        <Btn onClick={() => send()} variant="primary" icon={Send} disabled={!input.trim() || loading}>
          Wyślij
        </Btn>
      </div>
    </Card>
  );
}

function Bubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '78%',
        background: isUser ? C.lime : C.surfaceAlt,
        color: isUser ? C.bg : C.text,
        padding: '10px 14px', borderRadius: 12,
        fontSize: 14, lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
      }}>
        {message.content}
      </div>
    </div>
  );
}

// ============================================================
// Plan tab — macrocycle visualization
// ============================================================

// ============================================================
// Strength exercise database — variants by location/equipment
// ============================================================
// Each strength workout has the SAME muscle group goals across variants.
// Order: cardio first (Z2 doesn't interfere), then strength within 30 min if possible.
// Each variant: ~25-30 min, 3×10-12 reps, slow eccentric.

const STRENGTH_SESSIONS = {
  'Siłownia: Dół + Core': {
    label: 'Dół ciała + Core (antyrotacja)',
    purpose: 'Wzmocnienie pośladków/dwugłowych (odciąża L4-L5 w aero) + asymetryczny core',
    durationMin: 25,
    exercises: [
      {
        name: 'Przysiady bułgarskie',
        purpose: 'Eliminacja dysproporcji nóg, stabilizacja prawego kolana',
        gym: '3×10/nogę z hantlami 12-16 kg',
        home: '3×10/nogę z plecakiem 10-15 kg (książki + woda)',
        bands: '3×10/nogę z gumą oporową (stojąc na gumie)',
        bodyweight: '3×12/nogę bez obciążenia, 3 sek faza ekscentryczna',
      },
      {
        name: 'Rumuński martwy ciąg (RDL)',
        purpose: 'Pośladki + dwugłowe. Bracing brzucha odciąża lędźwie w pozycji aero',
        gym: '3×10 ze sztangą 40-60 kg lub hantlami',
        home: '3×10 z plecakiem trzymanym przed udami',
        bands: '3×12 z gumą pod stopami, chwyt na końcach',
        bodyweight: '3×12/nogę single-leg RDL bez obciążenia',
      },
      {
        name: 'Spacer farmera jednorącz',
        purpose: 'Mięsień poprzeczny brzucha (gorset) — antyrotacja',
        gym: '3×40s/stronę z kettlebell 16-24 kg',
        home: '3×40s/stronę z plecakiem w jednej ręce',
        bands: 'Pomiń — zastąp planką boczną 3×30s/stronę',
        bodyweight: 'Planka boczna 3×30s/stronę',
      },
    ],
  },
  'Siłownia: Góra + Plecy': {
    label: 'Góra ciała + Plecy (pływanie)',
    purpose: 'Siła pociągnięcia wody (najszerszy grzbietu) + stabilizacja antyrotacyjna',
    durationMin: 25,
    exercises: [
      {
        name: 'Przyciąganie drążka wyciągu pionowego',
        purpose: 'Najszerszy grzbietu — bezpośrednia siła chwytu wody w kraulu',
        gym: '3×10 na wyciągu pionowym, 30-50 kg',
        home: 'Podciąganie 3×max (jeśli drążek) lub odwrócone wiosłowanie pod stołem',
        bands: '3×12 z gumą zaczepioną wysoko (drzwi, klamka)',
        bodyweight: 'Odwrócone wiosłowanie pod stabilnym stołem, 3×10-12',
      },
      {
        name: 'Narciarz (ściąganie wyciągu)',
        purpose: 'Końcowa faza odepchnięcia w kraulu (proste ręce do bioder)',
        gym: '3×12 na wyciągu, oburącz, ruch do bioder',
        home: '3×12 z gumą zaczepioną wysoko, oburącz',
        bands: '3×12 z gumą zaczepioną wysoko, oburącz',
        bodyweight: 'Pompki na pięściach 3×10 (alternatywa zaangażowania klatki)',
      },
      {
        name: 'Pallof Press',
        purpose: 'Antyrotacja core — zapobiega ucieczce bioder w wodzie',
        gym: '3×12/stronę z wyciągiem bocznym',
        home: '3×12/stronę z gumą zaczepioną na bok',
        bands: '3×12/stronę z gumą zaczepioną w klamce na boku',
        bodyweight: 'Plank z dotykiem barku 3×10/stronę',
      },
    ],
  },
};

function getExerciseVariant(exercise, location, equipment) {
  // location: 'gym' | 'home' | 'travel'
  if (location === 'gym') return { instruction: exercise.gym, variant: 'gym' };
  if (location === 'travel') return { instruction: exercise.bodyweight, variant: 'bodyweight' };
  // home — pick best available based on equipment
  if (equipment?.dumbbells && exercise.home) return { instruction: exercise.home, variant: 'home' };
  if (equipment?.kettlebell && exercise.home) return { instruction: exercise.home, variant: 'home' };
  if (equipment?.loadedBackpack && exercise.home) return { instruction: exercise.home, variant: 'home' };
  if (equipment?.bands && exercise.bands) return { instruction: exercise.bands, variant: 'bands' };
  return { instruction: exercise.bodyweight, variant: 'bodyweight' };
}

// ============================================================
// Training zones — computed from user's threshold values
// ============================================================
// ============================================================
// Cycling zones based on FTP (Coggan model) — adds km/h speed estimates
// Running zones based on LTHR (Friel model) — adds min/km pace from threshold pace
// Swimming uses Critical Swim Speed (CSS) for pace per 100m
// ============================================================
function computeZones(settings) {
  const ftp = settings.ftp || 250;
  const lthr = settings.thresholdHR || 165;
  const max = settings.maxHR || 190;
  const tPace = settings.thresholdPace || 285; // sek/km — bieg progowy
  const css = settings.swimCSS || 105;          // sek/100m — Critical Swim Speed

  // Cycling speed estimation: simplified — typical flat-road for amateur:
  // ~30 W per km/h above maintenance. So speed (km/h) ≈ 10 + (power - 50) / 10
  // This is a rough estimate; real speed depends on wind, gradient, weight, drag.
  const pwrToSpeed = (pwr) => Math.round(10 + Math.max(0, pwr - 50) / 10);

  // Pace conversion: from seconds-per-km to "MM:SS/km" string
  const secToPace = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // Running pace ranges — slower than threshold = higher seconds value
  // Z1: 130-140% of threshold pace, Z2: 115-125%, Z3: 105-110%, Z4: 95-100%, Z5: 90-95%
  const paceFromPct = (pct) => Math.round(tPace * pct);

  // Swimming pace ranges based on CSS
  // Z1 (warmup): CSS+15s, Z2 (endurance): CSS+5-10s, Z3 (tempo): CSS, Z4 (threshold): CSS-5s
  const swimPace = (offset) => css + offset;

  return {
    cycling: {
      Z1: { name: 'Active Recovery', pwrLo: 0,                pwrHi: Math.round(ftp * 0.55), hrLo: Math.round(lthr * 0.68), hrHi: Math.round(lthr * 0.81), speedLo: pwrToSpeed(0),  speedHi: pwrToSpeed(Math.round(ftp * 0.55)), rpe: '1-2/10', feel: 'bardzo lekko, możesz śpiewać' },
      Z2: { name: 'Endurance',       pwrLo: Math.round(ftp * 0.56), pwrHi: Math.round(ftp * 0.75), hrLo: Math.round(lthr * 0.82), hrHi: Math.round(lthr * 0.88), speedLo: pwrToSpeed(Math.round(ftp * 0.56)), speedHi: pwrToSpeed(Math.round(ftp * 0.75)), rpe: '3-4/10', feel: 'rozmawiasz pełnymi zdaniami' },
      Z3: { name: 'Tempo',           pwrLo: Math.round(ftp * 0.76), pwrHi: Math.round(ftp * 0.90), hrLo: Math.round(lthr * 0.89), hrHi: Math.round(lthr * 0.93), speedLo: pwrToSpeed(Math.round(ftp * 0.76)), speedHi: pwrToSpeed(Math.round(ftp * 0.90)), rpe: '5-6/10', feel: 'rozmawiasz krótkimi zdaniami' },
      Z4: { name: 'Threshold',       pwrLo: Math.round(ftp * 0.91), pwrHi: Math.round(ftp * 1.05), hrLo: Math.round(lthr * 0.94), hrHi: Math.round(lthr * 1.00), speedLo: pwrToSpeed(Math.round(ftp * 0.91)), speedHi: pwrToSpeed(Math.round(ftp * 1.05)), rpe: '7-8/10', feel: 'pojedyncze słowa, oddech ciężki' },
      Z5: { name: 'VO2max',          pwrLo: Math.round(ftp * 1.06), pwrHi: Math.round(ftp * 1.20), hrLo: Math.round(lthr * 1.01), hrHi: max,                     speedLo: pwrToSpeed(Math.round(ftp * 1.06)), speedHi: pwrToSpeed(Math.round(ftp * 1.20)), rpe: '9/10',   feel: 'tylko sapanie' },
      Z6: { name: 'Anaerobic',       pwrLo: Math.round(ftp * 1.21), pwrHi: null,                   hrLo: null,                    hrHi: null,                    speedLo: pwrToSpeed(Math.round(ftp * 1.21)), speedHi: null, rpe: '10/10',  feel: 'sprint, nie do utrzymania' },
    },
    running: {
      Z1: { name: 'Recovery',        hrLo: Math.round(lthr * 0.75), hrHi: Math.round(lthr * 0.84), paceLo: secToPace(paceFromPct(1.40)), paceHi: secToPace(paceFromPct(1.30)), rpe: '2-3/10', feel: 'mega luźno, „truchcik"' },
      Z2: { name: 'Endurance',       hrLo: Math.round(lthr * 0.85), hrHi: Math.round(lthr * 0.89), paceLo: secToPace(paceFromPct(1.25)), paceHi: secToPace(paceFromPct(1.15)), rpe: '4/10',   feel: 'rozmowa swobodna, nos+usta' },
      Z3: { name: 'Tempo',           hrLo: Math.round(lthr * 0.90), hrHi: Math.round(lthr * 0.94), paceLo: secToPace(paceFromPct(1.10)), paceHi: secToPace(paceFromPct(1.05)), rpe: '5-6/10', feel: 'krótkie zdania, oddech głębszy' },
      Z4: { name: 'Threshold',       hrLo: Math.round(lthr * 0.95), hrHi: Math.round(lthr * 1.00), paceLo: secToPace(paceFromPct(1.00)), paceHi: secToPace(paceFromPct(0.95)), rpe: '7-8/10', feel: 'pojedyncze słowa' },
      Z5: { name: 'VO2max',          hrLo: Math.round(lthr * 1.01), hrHi: max,                     paceLo: secToPace(paceFromPct(0.95)), paceHi: secToPace(paceFromPct(0.90)), rpe: '9/10',   feel: 'tylko sapanie, nie utrzymasz > 5 min' },
    },
    swimming: {
      Z1: { name: 'Easy',     paceLo: secToPace(swimPace(20)), paceHi: secToPace(swimPace(15)), rpe: '2-3/10', feel: 'bardzo lekko, technika' },
      Z2: { name: 'Aerobic',  paceLo: secToPace(swimPace(12)), paceHi: secToPace(swimPace(7)),  rpe: '4-5/10', feel: 'rozmowne, kontrolowane' },
      Z3: { name: 'Tempo',    paceLo: secToPace(swimPace(5)),  paceHi: secToPace(swimPace(0)),  rpe: '6-7/10', feel: 'tempo startowe' },
      Z4: { name: 'Threshold',paceLo: secToPace(swimPace(0)),  paceHi: secToPace(swimPace(-5)), rpe: '8/10',   feel: 'mocno, intervały' },
      Z5: { name: 'VO2max',   paceLo: secToPace(swimPace(-5)), paceHi: secToPace(swimPace(-10)),rpe: '9/10',   feel: 'sprint kontrolowany' },
    },
  };
}

function zoneRangeStr(zone, sport) {
  if (sport === 'cycling') {
    const pwr = zone.pwrHi ? `${zone.pwrLo}–${zone.pwrHi} W` : `${zone.pwrLo}+ W`;
    return zone.hrLo ? `${zone.hrLo}–${zone.hrHi} bpm · ${pwr}` : pwr;
  }
  if (sport === 'swimming') {
    return zone.paceLo && zone.paceHi ? `${zone.paceLo}–${zone.paceHi}/100m` : '';
  }
  // running
  return `${zone.hrLo}–${zone.hrHi} bpm`;
}

// ============================================================
// Workout protocols — detailed how-to for each plan entry
// ============================================================
// Each protocol has: goal, zone label(s) used, sections (warmup/main/cooldown), tips, common mistakes
// Workouts not in this map fall back to a generic description.
function buildWorkoutProtocols(zones) {
  const Z = zones.cycling;
  const Zr = zones.running;

  // Helper: extracts HR/power range from zone code like "Z2", "Z1→Z2", "Z3 (steady)"
  // For mixed/transition zones, returns the dominant final zone's range
  const hr = (code, sport = 'running') => {
    const z = sport === 'cycling' ? Z : Zr;
    // Find last Z<n> reference in the code
    const matches = String(code).match(/Z(\d)/g);
    if (!matches || matches.length === 0) return null;
    const lastZone = matches[matches.length - 1]; // e.g. 'Z2'
    const zoneData = z[lastZone];
    if (!zoneData) return null;
    // For ranges spanning multiple zones (e.g. "Z1→Z2"), show transition
    if (matches.length > 1) {
      const firstZone = matches[0];
      const firstData = z[firstZone];
      if (firstData && firstData.hrLo) {
        return `${firstData.hrLo}→${zoneData.hrHi} bpm`;
      }
    }
    return zoneData.hrLo && zoneData.hrHi ? `${zoneData.hrLo}–${zoneData.hrHi} bpm` : null;
  };

  // Helper: pace per km (running) or per 100m (swimming)
  const pace = (code, sport = 'running') => {
    const z = sport === 'swimming' ? zones.swimming : Zr;
    const matches = String(code).match(/Z(\d)/g);
    if (!matches || matches.length === 0) return null;
    const lastZone = matches[matches.length - 1];
    const zoneData = z[lastZone];
    if (!zoneData || !zoneData.paceLo || !zoneData.paceHi) return null;
    const unit = sport === 'swimming' ? '/100m' : '/km';
    if (matches.length > 1) {
      const firstData = z[matches[0]];
      if (firstData?.paceLo) {
        return `${firstData.paceLo}→${zoneData.paceHi}${unit}`;
      }
    }
    return `${zoneData.paceLo}–${zoneData.paceHi}${unit}`;
  };

  // Helper: speed in km/h (cycling)
  const speed = (code) => {
    const matches = String(code).match(/Z(\d)/g);
    if (!matches || matches.length === 0) return null;
    const lastZone = matches[matches.length - 1];
    const zoneData = Z[lastZone];
    if (!zoneData || !zoneData.speedLo) return null;
    if (matches.length > 1) {
      const firstData = Z[matches[0]];
      if (firstData?.speedLo) {
        return `~${firstData.speedLo}→${zoneData.speedHi} km/h`;
      }
    }
    return zoneData.speedHi ? `~${zoneData.speedLo}–${zoneData.speedHi} km/h` : `~${zoneData.speedLo}+ km/h`;
  };

  return {
    // BLOCK 1 — ADAPTATION
    'Rower 60 min (Z2/Z3)': {
      goal: 'Budowa bazy tlenowej i ekonomii energetycznej. Aerobic capacity = fundament wszystkiego co dalej.',
      summary: 'Spokojny, długi trening na tętnie i mocy w strefie Z2 z opcjonalnymi odcinkami Z3.',
      zones: [{ label: 'Z2 Endurance', range: zoneRangeStr(Z.Z2, 'cycling'), rpe: Z.Z2.rpe, feel: Z.Z2.feel }, { label: 'Z3 Tempo', range: zoneRangeStr(Z.Z3, 'cycling'), rpe: Z.Z3.rpe, feel: Z.Z3.feel }],
      sections: [
        { time: '0–10 min',  zone: 'Z1→Z2', hr: hr('Z1→Z2', 'cycling'), speed: speed('Z1→Z2'), desc: 'Rozgrzewka. Zaczynasz lekko, podkręcasz tempo stopniowo. Tętno musi rosnąć powoli — bez nagłego skoku do Z3.' },
        { time: '10–50 min', zone: 'Z2 (steady)', hr: hr('Z2', 'cycling'), speed: speed('Z2'), desc: `Stałe tempo Z2. Kadencja 85-95 rpm. Możesz rozmawiać pełnymi zdaniami. Jeśli przez chwilę wpadasz w Z3 to OK, ale 70-80% czasu w Z2.` },
        { time: '50–60 min', zone: 'Z1', hr: hr('Z1', 'cycling'), speed: speed('Z1'), desc: 'Cooldown. Spuszczasz tempo, lekka noga, oddech wraca do normy.' },
      ],
      tips: [
        'Jedz/pij regularnie — 1 łyk wody co 10 min, batonik/żel co 30 min jeśli ponad 60 min',
        'Nie próbuj „dorównać" do kogoś szybszego — to TWÓJ trening Z2',
        'Jeśli HR sam dryfuje w górę bez wzrostu mocy = odwodnienie albo zmęczenie',
      ],
      mistakes: [
        'Za szybko (klasyczny błąd amatora) — Z2 ma być NUDNE',
        'Pomijanie rozgrzewki — od razu wbijasz w docelowe tempo, robisz sobie krzywdę',
      ],
    },

    // BLOCK 2 — PEAK
    'Rower 75 min (3×10 min Z4)': {
      goal: 'Podniesienie progu mleczanowego (FTP). To „chleb i masło" treningu kolarskiego.',
      summary: 'Klasyczny trening progowy: 3 interwały po 10 min w Z4 z 5 min odpoczynku Z1 między nimi.',
      zones: [{ label: 'Z4 Threshold', range: zoneRangeStr(Z.Z4, 'cycling'), rpe: Z.Z4.rpe, feel: Z.Z4.feel }],
      sections: [
        { time: '0–15 min',   zone: 'Z1→Z3', hr: hr('Z1→Z3', 'cycling'), speed: speed('Z1→Z3'), desc: 'Rozgrzewka progresywna. Z1 (5 min) → Z2 (5 min) → Z3 (3 min) → 2× 30 sek otwarć Z4/Z5 dla pobudzenia układu nerwowego.' },
        { time: '15–25 min',  zone: 'Z4 INTERWAŁ 1', hr: hr('Z4', 'cycling'), speed: speed('Z4'), desc: `Kadencja 85-90 rpm. Ma być CIĘŻKO. Pojedyncze słowa, nie zdania. Tętno wzrasta z opóźnieniem 30-60s.` },
        { time: '25–30 min',  zone: 'Z1 (recovery)', hr: hr('Z1', 'cycling'), speed: speed('Z1'), desc: 'Lekka noga. HR ma wrócić poniżej Z2 zanim zaczniesz kolejny interwał.' },
        { time: '30–40 min',  zone: 'Z4 INTERWAŁ 2', hr: hr('Z4', 'cycling'), speed: speed('Z4'), desc: 'Powtórka. Postaraj się utrzymać tę samą moc co w pierwszym. Jeśli drugi jest istotnie słabszy = pierwszy był za mocny.' },
        { time: '40–45 min',  zone: 'Z1 (recovery)', hr: hr('Z1', 'cycling'), speed: speed('Z1'), desc: 'Recovery 2.' },
        { time: '45–55 min',  zone: 'Z4 INTERWAŁ 3', hr: hr('Z4', 'cycling'), speed: speed('Z4'), desc: 'Ostatni. Tu często „pęka" — trzymaj się mocy, nie pozwól na spadek o więcej niż 5%.' },
        { time: '55–75 min',  zone: 'Z1→Z2', hr: hr('Z1→Z2', 'cycling'), speed: speed('Z1→Z2'), desc: 'Długi cooldown. Ważny dla regeneracji — HR ma stopniowo wrócić poniżej 120 bpm.' },
      ],
      tips: [
        'Mierz mocą, nie tylko HR — HR jest powolne, moc daje realtime feedback',
        'Wszystkie 3 interwały powinny mieć podobną moc (±5%). Spadek > 10% = pierwszy był za mocny',
        'Jedz ŻEL przed ostatnim interwałem albo zmieszczesz się w glikogen',
      ],
      mistakes: [
        'Zbyt mocny pierwszy interwał („mam siły!") — kończysz trzeci na resztkach',
        'Pominięcie cooldownu — utrudnia regenerację, podnosi ATL niepotrzebnie',
        'Robienie tego treningu w TSB < −20 = strata czasu, jakość spadnie',
      ],
    },

    // BLOCK 3 — TAPER
    'Rower 45 min (2×5 tempo startowe)': {
      goal: 'Utrzymanie ostrości startowej w tygodniu redukcji objętości. KRÓTKI ale jakościowy bodziec.',
      summary: 'Tapering — krótkie pobudzenia w tempie startowym żeby układ nerwowy nie „spał".',
      zones: [{ label: 'Z3/Z4 tempo startowe', range: `${Z.Z3.pwrLo}–${Z.Z4.pwrHi} W`, rpe: '6-7/10', feel: 'tempo które wytrzymasz na zawodach' }],
      sections: [
        { time: '0–15 min',  zone: 'Z1→Z2', hr: hr('Z1→Z2', 'cycling'), speed: speed('Z1→Z2'), desc: 'Bardzo spokojna rozgrzewka. W taperingu organizm jest świeży, ale rozgrzewasz się dłużej niż zwykle żeby nie sztywno wejść.' },
        { time: '15–20 min', zone: 'Z3+ tempo', hr: hr('Z3', 'cycling'), speed: speed('Z3'), desc: 'Pierwszy 5-min blok w tempie startowym. Mocno, ale nie aż Z4. Po skończeniu odpoczynek 3 min Z1.' },
        { time: '23–28 min', zone: 'Z3+ tempo', hr: hr('Z3', 'cycling'), speed: speed('Z3'), desc: 'Drugi blok. Tak samo. Po skończeniu długi cooldown.' },
        { time: '28–45 min', zone: 'Z1', hr: hr('Z1', 'cycling'), speed: speed('Z1'), desc: 'Cooldown bardzo spokojny.' },
      ],
      tips: [
        'W taperingu MNIEJ = WIĘCEJ. Nie kombinuj „zrobię więcej żeby się przygotować"',
        'Cel: czujesz że jesteś świeży i szybki, nie zmęczony',
      ],
      mistakes: [
        'Robienie tego jak Z4 — to NIE jest trening progowy, to pobudzenie',
        'Wydłużanie samodzielnie do 60 min „bo i tak jestem świeży"',
      ],
    },

    // RUNNING
    'Bieg 40 min (rozbieganie Z2)': {
      goal: 'Budowa pojemności tlenowej + utrwalanie ekonomicznej techniki biegu.',
      summary: 'Spokojne, długie rozbieganie w Z2. Kluczowa kadencja 178+ spm dla ochrony L4-L5 i prawego kolana.',
      zones: [{ label: 'Z2 Endurance', range: zoneRangeStr(Zr.Z2, 'running'), rpe: Zr.Z2.rpe, feel: Zr.Z2.feel }],
      sections: [
        { time: '0–5 min',   zone: 'Z1 marsz/trucht', hr: hr('Z1'), pace: pace('Z1'), desc: 'Marsz energiczny + 5 ćwiczeń mobilności (krążenia bioder, wymachy nóg, skipy A z miejsca).' },
        { time: '5–10 min',  zone: 'Z1→Z2', hr: hr('Z1→Z2'), pace: pace('Z1→Z2'), desc: 'Bardzo lekki trucht, stopniowe podkręcanie tempa. Skup się na kadencji — od początku trzymaj 178+ spm.' },
        { time: '10–35 min', zone: 'Z2', hr: hr('Z2'), pace: pace('Z2'), desc: `Tempo „rozmowne" — możesz wypowiedzieć pełne zdanie bez zadyszki. Kadencja 178+. Krok krótki, lądowanie pod miednicą.` },
        { time: '35–40 min', zone: 'Z1', hr: hr('Z1'), pace: pace('Z1'), desc: 'Cooldown — stopniowe schłodzenie do truchtu, potem marsz.' },
      ],
      tips: [
        'KADENCJA 178+ to OBOWIĄZEK — chroni L4-L5 i kolano. Sprawdź na zegarku co 5 min',
        'Krok krótki, częsty, lądowanie pod miednicą (nie z wyciągniętą nogą do przodu)',
        'Jeśli HR przekracza Zr.Z2 a tempo jest niskie = za szybko (paradoks), zwolnij',
      ],
      mistakes: [
        'Wydłużanie kroku „bo czuję się dobrze" — kolano zapłaci za to za 6 tygodni',
        'Bieganie po nawierzchni z dziurami — wybierz asfalt/równy chodnik dla kontroli',
      ],
    },

    'Bieg 50 min (baza + 4×100m)': {
      goal: 'Baza Z2 + małe pobudzenia neuromięśniowe (strides) dla ekonomii i szybkości.',
      summary: 'Spokojne 40 min Z2, potem 4 krótkie przyspieszenia 100m (~20 sek) z pełnym odpoczynkiem.',
      zones: [{ label: 'Z2', range: zoneRangeStr(Zr.Z2, 'running'), rpe: Zr.Z2.rpe, feel: Zr.Z2.feel }],
      sections: [
        { time: '0–5 min',   zone: 'marsz + mobility', hr: hr('Z1'), pace: pace('Z1'), desc: 'Marsz, mobility (jak w rozbieganiu Z2).' },
        { time: '5–45 min',  zone: 'Z2', hr: hr('Z2'), pace: pace('Z2'), desc: `Spokojny trucht Z2. Kadencja 178+. Pełna kontrola techniki — to baza.` },
        { time: '45–50 min', zone: 'STRIDES + cooldown', hr: 'tętno wzrasta, ale nie patrz na nie', desc: '4 × 100 m strides: każdy ~20 sek przyspieszenia do 80-85% maks tempa, NIE sprint, świadoma technika (wysoki bieg, duża kadencja). Między każdym ~60 sek marsz/trucht. Po wszystkich 2 min cooldown spacer.' },
      ],
      tips: [
        'Strides NIE są sprintami — to elegancki, szybki bieg z perfekcyjną techniką',
        'Jeśli czujesz że tracisz formę w stride → przerwij, kolejny dłuższy odpoczynek',
        'Ostatnie 50m strida powinno być najszybsze, nie pierwsze',
      ],
      mistakes: [
        'Robienie stridów jako pełnych sprintów → kontuzja dwugłowa',
        'Zaniedbanie odpoczynku między stridami — układ neuromięśniowy potrzebuje 60s',
      ],
    },

    'Bieg 60 min (długie)': {
      goal: 'Wytrzymałość ogólna + tolerancja długiego wysiłku. Niedzielne „długie" to klasyka.',
      summary: 'Stałe tempo Z2 przez większość treningu. Pozwala organizmowi przestawić się na spalanie tłuszczu.',
      zones: [{ label: 'Z2', range: zoneRangeStr(Zr.Z2, 'running'), rpe: Zr.Z2.rpe, feel: Zr.Z2.feel }],
      sections: [
        { time: '0–7 min',   zone: 'marsz + mobility + trucht', hr: hr('Z1→Z2'), pace: pace('Z1→Z2'), desc: 'Dłuższa rozgrzewka niż w środku tygodnia.' },
        { time: '7–53 min',  zone: 'Z2', hr: hr('Z2'), pace: pace('Z2'), desc: `Stałe Z2. Kadencja 178+. Możesz pozwolić sobie na lekki drift HR w końcówce (5-8 bpm po 50 min to norma) — to nie problem.` },
        { time: '53–60 min', zone: 'Z1', hr: hr('Z1'), pace: pace('Z1'), desc: 'Cooldown — bieg przechodzi w marsz.' },
      ],
      tips: [
        'Zjedz lekko 1-2h przed (kanapka, banan + masło orzechowe)',
        'Po 45 min weź żel/banana jeśli planujesz długie',
        'Po treningu w ciągu 30 min: białko + węglowodany (2:1 ratio)',
      ],
      mistakes: [
        'Bieganie głodno > 60 min → strata mięśni',
        'Próba „dokończenia" w Z3 jeśli się dobrze czujesz → niszczysz cel treningu',
      ],
    },

    'Bieg 75 min (wytrzymałość)': {
      goal: 'Większa pojemność tlenowa, adaptacja długodystansowa. Most do biegu na zawodach (10.5 km).',
      summary: 'Długi bieg Z2 z możliwością wpasowania mini-progresji w ostatnich 15 min.',
      zones: [{ label: 'Z2', range: zoneRangeStr(Zr.Z2, 'running'), rpe: Zr.Z2.rpe, feel: Zr.Z2.feel }, { label: 'Z3', range: zoneRangeStr(Zr.Z3, 'running'), rpe: Zr.Z3.rpe, feel: Zr.Z3.feel }],
      sections: [
        { time: '0–10 min',  zone: 'marsz + mobility + trucht', hr: hr('Z1→Z2'), pace: pace('Z1→Z2'), desc: 'Pełna rozgrzewka. Dla długich biegów RAZEM 10 min.' },
        { time: '10–60 min', zone: 'Z2', hr: hr('Z2'), pace: pace('Z2'), desc: `Stałe Z2. Kadencja 178+. 50 min ciągłego biegu = solidna baza.` },
        { time: '60–70 min', zone: 'opcjonalnie Z3', hr: hr('Z3'), pace: pace('Z3'), desc: `Jeśli czujesz się świeżo: ostatnie 10 min przejdź na Z3. NIE jeśli już zmęczony.` },
        { time: '70–75 min', zone: 'Z1', hr: hr('Z1'), pace: pace('Z1'), desc: 'Cooldown.' },
      ],
      tips: [
        'Hydratacja kluczowa — butelka 500ml na całość, łyk co 15 min',
        'Po treningu zrolować łydki, dwugłowe, pasmo IT band — profilaktyka kolana',
      ],
      mistakes: [
        'Robienie tego treningu w TSB < -25 → nic nie wyciągniesz, tylko zmęczenie',
        'Płaska trasa cały czas → wprowadź małe podbiegi, urozmaicenie',
      ],
    },

    'Bieg 30 min (3×500 m tempo)': {
      goal: 'Tapering — ostrość prędkościowa bez zbierania zmęczenia. Krótkie, dynamiczne.',
      summary: 'Tapering speed: 3×500m w tempie szybszym niż startowe, z pełnym odpoczynkiem.',
      zones: [{ label: 'Z3/Z4 tempo', range: `${Zr.Z3.hrLo}–${Zr.Z4.hrLo} bpm`, rpe: '7/10', feel: 'mocno ale kontrolowanie' }],
      sections: [
        { time: '0–10 min', zone: 'rozgrzewka', hr: hr('Z1→Z2'), pace: pace('Z1→Z2'), desc: 'Marsz + mobility + trucht Z2 7 min + 2× 30s otwarcia.' },
        { time: '10–15 min', zone: 'INTERWAŁ 1', hr: `${Zr.Z3.hrLo}–${Zr.Z4.hrLo} bpm`, desc: '500m tempo. Bieg „odważny" — szybciej niż na zawodach, ale nie sprint. Odpoczynek 2-3 min marsz/trucht do pełnego HR recovery.' },
        { time: '17–22 min', zone: 'INTERWAŁ 2', hr: `${Zr.Z3.hrLo}–${Zr.Z4.hrLo} bpm`, desc: 'Powtórka. Trzymaj tempo z pierwszego.' },
        { time: '24–29 min', zone: 'INTERWAŁ 3', hr: `${Zr.Z3.hrLo}–${Zr.Z4.hrLo} bpm`, desc: 'Ostatni. Najszybszy z trzech, jeśli możesz.' },
        { time: '29–30 min', zone: 'cooldown', hr: hr('Z1'), pace: pace('Z1'), desc: 'Krótki trucht + spacer.' },
      ],
      tips: [
        'Tapering = nie zmęczyć się. Skróć jeśli czujesz się ciężko',
        'Wykonanie raz w tygodniu w 7 dni przed startem',
      ],
      mistakes: [
        'Robienie 4-5 interwałów „bo dobrze idzie" — zmęczysz się na zawody',
        'Pełny sprint — to ma być tempo, nie max',
      ],
    },

    // BRICK (zakładki)
    'ZAKŁADKA: Rower 75 + Bieg 15': {
      goal: 'Adaptacja układu nerwowego do przejścia rower→bieg. KLUCZOWY trening triathlonisty.',
      summary: 'Spokojny rower Z2, błyskawiczna tranzycja, krótki bieg z forsowną kadencją. „Ciężkie nogi" po rowerze to esencja.',
      zones: [{ label: 'Rower Z2', range: zoneRangeStr(Z.Z2, 'cycling'), rpe: Z.Z2.rpe, feel: Z.Z2.feel }, { label: 'Bieg Z2', range: zoneRangeStr(Zr.Z2, 'running'), rpe: Zr.Z2.rpe, feel: Zr.Z2.feel }],
      sections: [
        { time: '0–10 min ROWER',  zone: 'Z1→Z2', hr: hr('Z1→Z2', 'cycling'), speed: speed('Z1→Z2'), desc: 'Rozgrzewka na rowerze. Stopniowo do Z2.' },
        { time: '10–70 min ROWER', zone: 'Z2 (stałe)', hr: hr('Z2', 'cycling'), speed: speed('Z2'), desc: `Stałe Z2. Kadencja 85-95 rpm. To symulacja zawodów — utrzymanie tempa, oszczędzanie nóg.` },
        { time: '70–75 min ROWER', zone: 'Z1 (przygotowanie do T2)', hr: hr('Z1', 'cycling'), speed: speed('Z1'), desc: 'Spuść tempo, ostatnie 5 min lekka noga, hydratacja, mentalnie przygotuj się do biegu.' },
        { time: 'TRANZYCJA (≤2 min)', zone: '—', hr: 'HR spada, nie panikuj', desc: 'Zostaw rower, przebij się szybko: czapka/okulary, zmień buty na biegowe. Trening tranzycji to też trening.' },
        { time: '75–90 min BIEG',   zone: 'Z2', hr: hr('Z2'), pace: pace('Z2'), desc: `Bieg Z2. Nogi BĘDĄ ciężkie — to normalne, mózg uczy się to znosić. Kadencja 178+ KRYTYCZNA — to chroni kolano gdy mięśnie są wstępnie zmęczone.` },
      ],
      tips: [
        'NIE wbij się od razu w tempo docelowe biegu — pierwsze 500m zawsze ciężkie',
        'Ćwicz tranzycję w realnych warunkach — strój, buty, butelka, czapka jak na zawodach',
        'To jest TEN trening który robi różnicę 12.07 w Bydgoszczy',
      ],
      mistakes: [
        'Za szybki rower → bieg będzie dramatem, nie nauka',
        'Pominięcie kadencji w biegu „bo zmęczony" → kontuzja',
        'Robienie po ciężkim tygodniu (TSB < -25) → brak korzyści adaptacyjnych',
      ],
    },

    'ZAKŁADKA: Rower 105 + Bieg 20': {
      goal: 'Pełna symulacja drugiej połowy zawodów. Najdłuższy brick w planie.',
      summary: 'Rower 105 min mieszanką Z2/Z3, tranzycja, bieg 20 min Z2 z mini-progresją w końcówce.',
      zones: [{ label: 'Rower Z2/Z3', range: `${Z.Z2.pwrLo}–${Z.Z3.pwrHi} W`, rpe: '4-6/10', feel: 'Z2 z opcjonalnymi przebłyskami Z3' }, { label: 'Bieg Z2/Z3', range: `${Zr.Z2.hrLo}–${Zr.Z3.hrLo} bpm`, rpe: '4-6/10', feel: 'progresywny' }],
      sections: [
        { time: '0–15 min ROWER',   zone: 'Z1→Z2', hr: hr('Z1→Z2', 'cycling'), speed: speed('Z1→Z2'), desc: 'Rozgrzewka.' },
        { time: '15–90 min ROWER',  zone: 'Z2 z 2× 10 min Z3', hr: hr('Z2→Z3', 'cycling'), speed: speed('Z2→Z3'), desc: `Z2 jako baza. W minutach 30-40 i 65-75 — wepchnij Z3. To symuluje sytuacje gdy musisz przyspieszyć (podjazd, atak).` },
        { time: '90–105 min ROWER', zone: 'Z1→Z2', hr: hr('Z1', 'cycling'), speed: speed('Z1'), desc: 'Spuść do Z1 ostatnie 10 min, ostatnie 5 min bardzo lekko, przygotuj się do tranzycji.' },
        { time: 'TRANZYCJA',        zone: '—', hr: 'HR spada', desc: '2 min max. Wykonaj jak na zawodach.' },
        { time: '105–120 min BIEG', zone: 'Z2', hr: hr('Z2→Z3'), pace: pace('Z2→Z3'), desc: `Z2 jako baza. Kadencja 178+. Po 15 min — jeśli czujesz się ok — przejdź w Z3 na 5 min.` },
        { time: '120–125 min BIEG', zone: 'cooldown', hr: hr('Z1'), pace: pace('Z1'), desc: 'Trucht + marsz.' },
      ],
      tips: [
        'Ten trening = 80% wysiłku zawodów. Jeśli to przeżyjesz to przeżyjesz Bydgoszcz',
        'Odżywianie: 1 żel co 30 min na rowerze, woda non-stop',
        'Po treningu PRIORYTET: dekompresja L4-L5, mata + zwis 60 sek + pozycja dziecka',
      ],
      mistakes: [
        'Pominięcie Z3 odcinków → nie zasymulujesz realnych sytuacji',
        'Niedostateczne tankowanie → „bonk" w 90 min, koniec treningu',
      ],
    },

    // SWIMMING — RPE based (most amateurs don't have accurate pool HR)
    'Pływanie Basen 45 min': {
      goal: 'Czas spędzony w wodzie + technika. Faza adaptacji, niskiej intensywności.',
      summary: 'Technika izolowana z pull-buoy, krótkie odcinki z pełnym odpoczynkiem.',
      zones: [{ label: 'Z1/Z2 — łatwe tempo', range: `${zones.swimming.Z1.paceLo}–${zones.swimming.Z2.paceHi}/100m`, rpe: '3-5/10', feel: 'oddychasz co 3 ruchy bez zadyszki' }],
      sections: [
        { time: '0–10 min', zone: 'rozgrzewka', pace: pace('Z1', 'swimming'), desc: '4× 50m: kraul → grzbiet → kraul z pull-buoy → kraul. Po każdym 30 sek odpoczynku.' },
        { time: '10–40 min', zone: 'technika', pace: pace('Z2', 'swimming'), desc: '6× 100m kraul z pull-buoy (unosi biodra, odciąża L4-L5). Skupiasz się na: wysokim łokciu pod wodą, długim wyciągnięciu ramienia. 30-45 sek odpoczynku między.' },
        { time: '40–45 min', zone: 'cooldown', pace: pace('Z1', 'swimming'), desc: '4× 25m: grzbiet/żabka, bardzo wolno.' },
      ],
      tips: [
        'Pull-buoy unosi biodra — uczy poprawnej, wysokiej pozycji ciała',
        'Wysoki łokieć = klucz do efektywnego chwytu wody',
        'NIE pływaj na zmęczenie — to trening techniki, jakość > ilość',
      ],
      mistakes: [
        'Pływanie bez pull-buoy z niską pozycją bioder utrwala błąd',
        'Skupienie na czasie zamiast technice — w tym etapie zbędne',
      ],
    },

    'Pływanie Basen 60 min': {
      goal: 'Pojemność tlenowa pływacka + szlifowanie techniki.',
      summary: 'Dłuższy trening, więcej odcinków, większa kontrola tempa.',
      zones: [{ label: 'Z2/Z3 — umiarkowane', range: `${zones.swimming.Z2.paceLo}–${zones.swimming.Z3.paceHi}/100m`, rpe: '4-6/10', feel: 'oddychasz co 3, czasem co 5 ruchów' }],
      sections: [
        { time: '0–10 min', zone: 'rozgrzewka', pace: pace('Z1', 'swimming'), desc: '300m: 100m kraul → 100m pull → 100m kraul. Spokojnie.' },
        { time: '10–20 min', zone: 'technika', pace: pace('Z2', 'swimming'), desc: '4× 100m drill (rotacja, oddychanie obustronne, wysoki łokieć). 30 sek pauzy.' },
        { time: '20–50 min', zone: 'main set', pace: pace('Z3', 'swimming'), desc: '6× 200m kraul. Tempo umiarkowane. 45 sek odpoczynku. Pierwsze i ostatnie z pull-buoy.' },
        { time: '50–60 min', zone: 'cooldown', pace: pace('Z1', 'swimming'), desc: '200m luźno, mieszanymi stylami.' },
      ],
      tips: [
        'Co kilka odcinków sprawdź czas — uczysz się pacingu',
        'Oddychanie obustronne (co 3 ruchy) wymusza symetrię',
      ],
      mistakes: [
        'Tylko jeden bok do oddychania → asymetria, bóle szyi',
      ],
    },

    'Pływanie Open Water 40 min': {
      goal: 'Adaptacja do otwartej wody: nawigacja, falowanie, pływanie w piance.',
      summary: 'Pierwszy kontakt z piankiem i jeziorem. Nauka nawigacji bez ścian basenowych.',
      zones: [{ label: 'Z2 — umiarkowane', range: `${zones.swimming.Z2.paceLo}–${zones.swimming.Z2.paceHi}/100m`, rpe: '4-6/10', feel: 'tempo rozmowne' }],
      sections: [
        { time: '0–5 min', zone: 'adaptacja', pace: pace('Z1', 'swimming'), desc: 'Wchodzisz do wody, pianka, pierwszy kontakt. Pływanie przy brzegu, sprawdzasz że oddychasz spokojnie.' },
        { time: '5–35 min', zone: 'main', pace: pace('Z2', 'swimming'), desc: 'Pływanie wzdłuż brzegu lub między boyami. Co 6-8 ruchów PODNIEŚ głowę („sighting") na 2 sekundy żeby zobaczyć kierunek. Krótkie spojrzenie nie hamuje rytmu.' },
        { time: '35–40 min', zone: 'cooldown', pace: pace('Z1', 'swimming'), desc: 'Spokojne pływanie do brzegu, rozluźnienie.' },
      ],
      tips: [
        'Pianka unosi biodra automatycznie — wykorzystaj to, nie kopiesz mocno nogami',
        'Sighting: 1 oddech NORMALNIE → następny WYŻEJ z spojrzeniem → kolejne normalnie',
        'Jeśli falowanie → oddychaj zawsze w tę stronę od fali',
      ],
      mistakes: [
        'Panika w pierwszych minutach — wolniej, świadomy oddech, kontroluj',
        'Sighting co 2 ruchy → tracisz pozycję ciała, męczysz szyję',
      ],
    },

    'Pływanie Basen 30 min luźno': {
      goal: 'Tapering — utrzymanie czucia wody bez zbierania zmęczenia.',
      summary: 'Krótka, lekka sesja techniczna.',
      zones: [{ label: 'Z1 — bardzo lekko', range: `${zones.swimming.Z1.paceLo}–${zones.swimming.Z1.paceHi}/100m`, rpe: '3/10', feel: 'rozmowne, regeneracyjne' }],
      sections: [
        { time: '0–5 min', zone: 'rozgrzewka', pace: pace('Z1', 'swimming'), desc: '200m mieszanymi stylami, bardzo wolno.' },
        { time: '5–25 min', zone: 'technika', pace: pace('Z1', 'swimming'), desc: '4× 100m kraul z pull-buoy, fokus na technikę. Dużo odpoczynku (45-60 sek).' },
        { time: '25–30 min', zone: 'cooldown', pace: pace('Z1', 'swimming'), desc: 'Pływanie luźno na grzbiecie.' },
      ],
      tips: [
        'Tapering pływania = czucie wody, NIE objętość',
        'Wyjdź z basenu z poczuciem że mogłbyś więcej — to dobrze',
      ],
      mistakes: [
        'Robienie tego jak normalnego treningu → zmęczenie',
      ],
    },

    'Pływanie Open Water 20 min': {
      goal: 'Ostatni kontakt z otwartą wodą przed zawodami — psychika, sprzęt, sighting.',
      summary: 'Sprawdzenie strategii startowej. Krótko, intensywnie technicznie.',
      zones: [{ label: 'Z3 — tempo startowe', range: `${zones.swimming.Z3.paceLo}–${zones.swimming.Z3.paceHi}/100m`, rpe: '6-7/10', feel: 'kontrolowane race pace' }],
      sections: [
        { time: '0–5 min', zone: 'adaptacja', pace: pace('Z1', 'swimming'), desc: 'Wejście, sprawdzenie pianki, gogli. 100m luźno.' },
        { time: '5–18 min', zone: 'main', pace: pace('Z3', 'swimming'), desc: '2× 5-min „race pace" — tempo które planujesz na zawodach. Z sightingiem co 6-8 ruchów. 2 min lekko między.' },
        { time: '18–20 min', zone: 'cooldown', pace: pace('Z1', 'swimming'), desc: 'Spokojnie do brzegu.' },
      ],
      tips: [
        'TEST sprzętu: gogle szczelnie? Pianka nie ciśnie szyi? Itd.',
        'Mentalna wizualizacja startu — gdzie się ustawiasz, jak zaczynasz',
      ],
      mistakes: [
        'Eksperymentowanie ze sprzętem 7 dni przed startem — używaj tylko sprawdzonego',
      ],
    },

    'ZAKŁADKA: Rower 50 + Bieg 10': {
      goal: 'Tapering brick — krótka symulacja zawodów z tempem startowym.',
      summary: 'Lekka zakładka. Element świeżości, ostrości startowej.',
      zones: [{ label: 'Z2 + Z3', range: `Z2 do Z3`, rpe: '4-6/10', feel: 'tempo startowe' }],
      sections: [
        { time: '0–10 min ROWER',  zone: 'Z1→Z2', hr: hr('Z1→Z2', 'cycling'), speed: speed('Z1→Z2'), desc: 'Rozgrzewka.' },
        { time: '10–45 min ROWER', zone: 'Z2 z 2× 5 min Z3 startowe', hr: hr('Z2→Z3', 'cycling'), speed: speed('Z2→Z3'), desc: 'Większość Z2, w minutach 20-25 i 35-40 — Z3 tempo startowe.' },
        { time: '45–50 min ROWER', zone: 'Z1', hr: hr('Z1', 'cycling'), speed: speed('Z1'), desc: 'Cooldown przed T2.' },
        { time: 'TRANZYCJA', zone: '—', hr: 'HR spada', desc: 'Pełna symulacja jak na zawodach.' },
        { time: '50–60 min BIEG', zone: 'Z2 z 2 min Z3', hr: hr('Z2→Z3'), pace: pace('Z2→Z3'), desc: 'Pierwsze 7 min Z2, potem 2 min Z3 (race pace), ostatnia 1 min cooldown trucht.' },
      ],
      tips: [
        'To OSTATNI brick przed Bydgoszczem — wykonaj jak finałową próbę',
        'Test ubioru i nawodnienia jak na zawodach',
      ],
      mistakes: [
        'Wydłużenie samodzielnie — w taperingu to błąd',
      ],
    },

    'Bieg 40 min luźno': {
      goal: 'Bieg regeneracyjny w taperingu. Utrzymanie czucia bez zmęczenia.',
      summary: 'Trucht Z1/Z2, bardzo lekko, krótko.',
      zones: [{ label: 'Z1/Z2', range: zoneRangeStr(Zr.Z1, 'running'), rpe: '3/10', feel: 'lekko, „truchcik"' }],
      sections: [
        { time: '0–5 min', zone: 'marsz + mobility', hr: hr('Z1'), pace: pace('Z1'), desc: 'Rozgrzewka.' },
        { time: '5–35 min', zone: 'Z1/Z2', hr: `${Zr.Z1.hrLo}–${Zr.Z2.hrHi} bpm`, desc: 'Trucht bardzo lekko. Kadencja 178+. Czujesz że mógłbyś znacznie więcej — i dobrze.' },
        { time: '35–40 min', zone: 'cooldown', hr: hr('Z1'), pace: pace('Z1'), desc: 'Stopniowy spacer.' },
      ],
      tips: [
        'NIE robić więcej. To NIE jest trening, to ruch dla układu krążenia',
      ],
      mistakes: [
        'Sprawdzanie tempa „czy szybciej" → łamiesz cel taperingu',
      ],
    },

    // RACE DAY
    'START: TRIATHLON 1/4': {
      goal: 'Ukończyć z czasem osobistym, bez bólu lędźwiowego, bez kontuzji.',
      summary: '1/4 triathlon: 950m pływania + 45 km rowerem + 10.5 km biegiem. Strategia: nie pęknij na pływaniu, kontrolowane tempo na rowerze, biegnij z głową.',
      zones: [{ label: 'Strategiczne tempo', range: 'patrz sekcje', rpe: 'progresywne', feel: 'patrz sekcje' }],
      sections: [
        { time: 'Pływanie ~20 min', zone: 'RPE 6/10', desc: '950m kraulem. NIE startuj sprintem — pierwsze 100m kontroluj, znajdź swoje miejsce w pelotonie. Sighting co 6-8 ruchów. Cel: wyjść z wody świeżym.' },
        { time: 'T1 ~3 min', zone: '—', desc: 'Zdejmujesz pianke, kask, buty kolarskie. Spokojnie ale energicznie. Numer zapięty wcześniej na koszulce kolarskiej.' },
        { time: 'Rower ~1h30', zone: 'Z2/Z3 sweet spot', desc: `45 km. Tempo Z2 z możliwymi „kopnięciami" Z3 na podjazdach. Pierwsze 15 min świadomie LŻEJ żeby HR się ustabilizowało. Nawadnianie i 2 żele.` },
        { time: 'T2 ~2 min', zone: '—', desc: 'Zmiana butów (KLUCZOWE: wcześniej przygotowane, sznurówki elastyczne). Pij łyk wody, zacznij na 5 sek wolniej niż chcesz.' },
        { time: 'Bieg ~55 min', zone: 'Z2/Z3', desc: `10.5 km. Pierwsze 2 km wolniej niż chcesz (mózg krzyczy „szybciej" ale nogi są zmęczone z roweru). Kadencja 178+ OBOWIĄZKOWA. Tempo stałe, ewentualnie progresywne w końcówce.` },
      ],
      tips: [
        'NIE rób nic nowego w dniu startu — sprzęt, ubranie, jedzenie testowane wcześniej',
        'Pobudka 2.5h przed startem, śniadanie 2h przed (sprawdzone, lekkostrawne)',
        '15 min przed startem WC, 5 min lekkie pobudzenie, mentalna gotowość',
        'JEDEN cel: kadencja 178+ i kontrolowane tempo. Reszta przyjdzie sama',
      ],
      mistakes: [
        'Start „all in" — zniszczysz się w pierwszych 5 minutach',
        'Próba ścigania kogoś szybszego na rowerze — to TWÓJ trening',
        'Wydłużanie kroku w biegu jak się zmęczysz → kontuzja, nie tempo',
      ],
    },

    'WOLNE — regeneracja': {
      goal: 'Regeneracja. To NIE jest „dzień stracony", to dzień gdy adaptacja się DZIEJE.',
      summary: 'Dzień bez treningu cardio. Lekka mobilność + protokół dekompresji L4-L5.',
      zones: [{ label: 'Regeneracja', range: '—', rpe: '0-2/10', feel: 'odpoczywasz' }],
      sections: [
        { time: 'Rano', zone: 'mobility', desc: '10 min: krążenia bioder, kot-krowa, bird-dog (3×10/stronę), mostki biodrowe (3×12), mobilizacja bioder 90/90 (2×10/stronę).' },
        { time: 'Wieczorem', zone: 'dekompresja L4-L5', desc: '15 min: rozciąganie zginaczy bioder w klęku 3× 45 sek/stronę, zwis na drążku 3× 25 sek, pozycja dziecka 1-2 min, rozciąganie gruszkowatego 3× 45 sek/stronę. KAŻDEGO PONIEDZIAŁKU.' },
      ],
      tips: [
        'Sen min. 7h tej nocy — najważniejsze hormony regeneracyjne',
        'Białko: 1.6-2g/kg masy ciała w ciągu dnia',
        'Lekki spacer 20-30 min OK, nawet pożądany',
      ],
      mistakes: [
        '„Tylko 30 min biegu" → nie, to jest WOLNE',
        'Olanie protokołu dekompresji → po tygodniu plecy zapłacą',
      ],
    },

    'WOLNE / ROZRUCH przedstartowy': {
      goal: 'Sprawdzenie sprzętu, rozruch, mentalne przygotowanie.',
      summary: 'Sobota przed niedzielnym startem. Sprawdzenie sprzętu, krótki rozruch.',
      zones: [{ label: 'Rozruch', range: '—', rpe: '2/10', feel: 'sprawdzające' }],
      sections: [
        { time: 'Rano', zone: 'sprzęt', desc: 'Sprawdź rower (ciśnienie, hamulce, łańcuch). Pakuj T1/T2 (ubrania, żele, żeli, czapka, okulary). Sznurówki elastyczne na buty biegowe.' },
        { time: 'Po południu', zone: 'rozruch', desc: 'OPCJONALNIE: 20 min rower bardzo lekko + 5 min trucht. NIE jest obowiązkowe, jeśli czujesz że potrzebujesz to OK.' },
        { time: 'Wieczorem', zone: 'mentalne', desc: 'Sprawdź pogodę, godzinę startu. Wizualizacja: jak wchodzisz do wody, jak siadasz na rower, jak ruszasz w bieg. Sen min. 8h.' },
      ],
      tips: [
        'Kolacja: węglowodany + małe białko, sprawdzona kuchnia, niezbyt późno',
        'Przygotuj wszystko na rano: zegarek, ubrania, plecak, butelka, plan startu',
      ],
      mistakes: [
        'Test nowego sprzętu — NIE TERAZ',
        'Późna kolacja, alkohol, nowe potrawy',
      ],
    },
  };
}

// Generic protocol for any workout not in the map (fallback)
function buildGenericProtocol(workout, durationMin, sport, zones) {
  const Z = zones.cycling;
  const Zr = zones.running;
  const isCycling = sport === 'cycling';
  const isRunning = sport === 'running';
  if (!isCycling && !isRunning) return null;

  return {
    goal: `Realizacja zaplanowanej jednostki: ${workout}.`,
    summary: 'Brak szczegółowego protokołu — kieruj się ogólnymi zasadami strefowymi.',
    zones: isCycling
      ? [{ label: 'Z2 Endurance', range: zoneRangeStr(Z.Z2, 'cycling'), rpe: Z.Z2.rpe, feel: Z.Z2.feel }]
      : [{ label: 'Z2 Endurance', range: zoneRangeStr(Zr.Z2, 'running'), rpe: Zr.Z2.rpe, feel: Zr.Z2.feel }],
    sections: [
      { time: `0–${Math.max(5, Math.floor(durationMin * 0.15))} min`, zone: 'rozgrzewka', desc: 'Stopniowe podkręcanie tempa od Z1 do docelowej strefy.' },
      { time: `${Math.max(5, Math.floor(durationMin * 0.15))}–${durationMin - 5} min`, zone: 'main', desc: 'Część główna w docelowej strefie wg opisu treningu.' },
      { time: `${durationMin - 5}–${durationMin} min`, zone: 'cooldown', desc: 'Schłodzenie, powrót do Z1.' },
    ],
    tips: isRunning ? ['Kadencja 178+ spm (ochrona L4-L5 i kolana)'] : [],
    mistakes: [],
  };
}


const BLOCK_PATTERNS = {
  1: {
    name: "Blok 1: Adaptacja i Technika",
    short: "Adaptacja",
    weeks: [1, 2, 3],
    color: '#5ab5ff',
    goal: "Budowanie bezpiecznej bazy siłowej, wysoka kadencja biegowa, technika pływania.",
    days: [
      { day: 'Pon', sport: 'rest',     workout: 'WOLNE — regeneracja',           strength: null,                  durationMin: 0,  tssEstimate: 0  },
      { day: 'Wt',  sport: 'cycling',  workout: 'Rower 60 min (Z2/Z3)',          strength: 'Siłownia: Dół + Core',durationMin: 60, tssEstimate: 60 },
      { day: 'Śr',  sport: 'swimming', workout: 'Pływanie Basen 45 min',         strength: null,                  durationMin: 45, tssEstimate: 22 },
      { day: 'Czw', sport: 'running',  workout: 'Bieg 40 min (rozbieganie Z2)',  strength: 'Siłownia: Góra + Plecy', durationMin: 40, tssEstimate: 37 },
      { day: 'Pt',  sport: 'swimming', workout: 'Pływanie Basen 45 min',         strength: null,                  durationMin: 45, tssEstimate: 22 },
      { day: 'Sob', sport: 'cycling',  workout: 'ZAKŁADKA: Rower 75 + Bieg 15',  strength: null,                  durationMin: 90, tssEstimate: 90, isBrick: true },
      { day: 'Ndz', sport: 'running',  workout: 'Bieg 60 min (długie)',          strength: null,                  durationMin: 60, tssEstimate: 55 },
    ]
  },
  2: {
    name: "Blok 2: Szczyt i Wytrzymałość",
    short: "Szczyt",
    weeks: [4, 5, 6],
    color: '#ffb83a',
    goal: "Maksymalna objętość kolarska, treningi zakładkowe, pływanie Open Water.",
    days: [
      { day: 'Pon', sport: 'rest',     workout: 'WOLNE — regeneracja',                strength: null,                durationMin: 0,   tssEstimate: 0   },
      { day: 'Wt',  sport: 'cycling',  workout: 'Rower 75 min (3×10 min Z4)',         strength: 'Siłownia: Dół + Core', durationMin: 75,  tssEstimate: 100 },
      { day: 'Śr',  sport: 'swimming', workout: 'Pływanie Basen 60 min',              strength: null,                durationMin: 60,  tssEstimate: 32  },
      { day: 'Czw', sport: 'running',  workout: 'Bieg 50 min (baza + 4×100m)',        strength: 'Siłownia: Góra + Plecy', durationMin: 50,  tssEstimate: 55  },
      { day: 'Pt',  sport: 'swimming', workout: 'Pływanie Open Water 40 min',         strength: null,                durationMin: 40,  tssEstimate: 35  },
      { day: 'Sob', sport: 'cycling',  workout: 'ZAKŁADKA: Rower 105 + Bieg 20',      strength: null,                durationMin: 125, tssEstimate: 130, isBrick: true },
      { day: 'Ndz', sport: 'running',  workout: 'Bieg 75 min (wytrzymałość)',         strength: null,                durationMin: 75,  tssEstimate: 75  },
    ]
  },
  3: {
    name: "Blok 3: Tapering i Świeżość",
    short: "Tapering",
    weeks: [7, 8],
    color: '#c6ff3a',
    goal: "Redukcja objętości 30–40%, utrzymanie intensywności startowej, dekompresja.",
    days: [
      { day: 'Pon', sport: 'rest',     workout: 'WOLNE — regeneracja',              strength: null,                  durationMin: 0,  tssEstimate: 0  },
      { day: 'Wt',  sport: 'cycling',  workout: 'Rower 45 min (2×5 tempo startowe)',strength: 'Siłownia: Dół + Core',durationMin: 45, tssEstimate: 50 },
      { day: 'Śr',  sport: 'swimming', workout: 'Pływanie Basen 30 min luźno',      strength: null,                  durationMin: 30, tssEstimate: 15 },
      { day: 'Czw', sport: 'running',  workout: 'Bieg 30 min (3×500 m tempo)',      strength: 'Siłownia: Góra + Plecy', durationMin: 30, tssEstimate: 40 },
      { day: 'Pt',  sport: 'swimming', workout: 'Pływanie Open Water 20 min',       strength: null,                  durationMin: 20, tssEstimate: 18 },
      { day: 'Sob', sport: 'cycling',  workout: 'ZAKŁADKA: Rower 50 + Bieg 10',     strength: null,                  durationMin: 60, tssEstimate: 60, isBrick: true },
      { day: 'Ndz', sport: 'running',  workout: 'Bieg 40 min luźno',                strength: null,                  durationMin: 40, tssEstimate: 35 },
    ],
    raceWeekOverride: {
      5: { day: 'Sob', sport: 'rest', workout: 'WOLNE / ROZRUCH przedstartowy', strength: null, durationMin: 0,   tssEstimate: 0   },
      6: { day: 'Ndz', sport: 'race', workout: 'START: TRIATHLON 1/4',          strength: null, durationMin: 180, tssEstimate: 180 },
    }
  }
};

function inferStructure(workout, durationMin, sport) {
  if (!workout || durationMin === 0 || sport === 'rest') return [];

  const wo = workout.toLowerCase();

  // Race day — full triathlon
  if (sport === 'race') {
    return [
      { d: 25,  i: 3, label: 'Pływanie' },
      { d: 5,   i: 2, label: 'T1' },
      { d: 90,  i: 3, label: 'Rower' },
      { d: 5,   i: 2, label: 'T2' },
      { d: 60,  i: 3, label: 'Bieg' },
    ];
  }

  // Brick (zakładka) — cycling + run, split visually
  const brickMatch = wo.match(/rower\s+(\d+)\s*\+\s*bieg\s+(\d+)/);
  if (brickMatch) {
    const bikeMin = parseInt(brickMatch[1]);
    const runMin = parseInt(brickMatch[2]);
    const wu = Math.min(8, Math.floor(bikeMin * 0.1));
    return [
      { d: wu,             i: 2, label: 'WU' },
      { d: bikeMin - wu,   i: 3, label: 'Rower Z2' },
      { d: runMin,         i: 3, label: 'Bieg' },
    ];
  }

  // Intervals N×M (e.g., 3×10 min Z4)
  const intMatch = wo.match(/(\d+)\s*[×x]\s*(\d+)\s*min/);
  if (intMatch) {
    const reps = parseInt(intMatch[1]);
    const repDur = parseInt(intMatch[2]);
    const recDur = Math.max(3, Math.min(5, Math.floor(repDur / 2)));
    const intensity = wo.includes('z4') || wo.includes('próg') || wo.includes('threshold') ? 4
                    : wo.includes('z5') || wo.includes('vo2') ? 5 : 4;
    const totalInt = reps * repDur + (reps - 1) * recDur;
    const wu = Math.max(8, Math.floor((durationMin - totalInt) * 0.55));
    const cd = Math.max(5, durationMin - totalInt - wu);

    const segs = [{ d: wu, i: 2, label: 'WU' }];
    for (let r = 0; r < reps; r++) {
      segs.push({ d: repDur, i: intensity, label: `${repDur}'` });
      if (r < reps - 1) segs.push({ d: recDur, i: 2, label: 'rec' });
    }
    segs.push({ d: cd, i: 2, label: 'CD' });
    return segs;
  }

  // Tempo reps (e.g., 2×5 min tempo)
  const tempoMatch = wo.match(/(\d+)\s*[×x]\s*(\d+)/);
  if (tempoMatch && (wo.includes('tempo') || wo.includes('przebieżki'))) {
    const reps = parseInt(tempoMatch[1]);
    const repDur = Math.max(1, parseInt(tempoMatch[2]) > 50 ? 1 : parseInt(tempoMatch[2])); // 100m strides ~30s
    const recDur = 2;
    const totalInt = reps * repDur + (reps - 1) * recDur;
    const wu = Math.max(8, Math.floor((durationMin - totalInt) * 0.55));
    const cd = Math.max(5, durationMin - totalInt - wu);
    const intensity = wo.includes('start') ? 4 : 4;

    const segs = [{ d: wu, i: 2, label: 'WU' }];
    for (let r = 0; r < reps; r++) {
      segs.push({ d: repDur, i: intensity });
      if (r < reps - 1) segs.push({ d: recDur, i: 2 });
    }
    segs.push({ d: cd, i: 2, label: 'CD' });
    return segs;
  }

  // Long, easy, technique — flat single block
  const isVeryEasy = wo.includes('luźno') || wo.includes('regenerac') || wo.includes('technik') || wo.includes('rozruch');
  const isLong = wo.includes('długie') || wo.includes('wytrzymałoś');
  const intensity = isVeryEasy ? 2 : 3;

  const wuCd = Math.max(4, Math.min(10, Math.floor(durationMin * 0.12)));
  const mainDur = Math.max(1, durationMin - wuCd * 2);

  return [
    { d: wuCd,    i: 2, label: 'WU' },
    { d: mainDur, i: intensity, label: isLong ? 'Long' : isVeryEasy ? 'Easy' : 'Steady' },
    { d: wuCd,    i: 2, label: 'CD' },
  ];
}

function WorkoutStructure({ structure, height = 18, showLabels = false }) {
  if (!structure || structure.length === 0) return null;
  const totalDur = structure.reduce((s, seg) => s + seg.d, 0);
  if (totalDur === 0) return null;

  const intensityColor = {
    1: C.muted + '50',
    2: C.cyan + 'b0',
    3: C.lime,
    4: C.amber,
    5: C.red,
  };

  return (
    <div>
      <div style={{
        display: 'flex',
        gap: 1,
        height,
        width: '100%',
        borderRadius: 3,
        overflow: 'hidden',
        background: C.surfaceAlt,
      }}>
        {structure.map((seg, i) => (
          <div
            key={i}
            style={{
              flex: seg.d,
              background: intensityColor[seg.i] || C.muted,
              minWidth: 2,
            }}
            title={`${seg.label ? seg.label + ' · ' : ''}${seg.d} min`}
          />
        ))}
      </div>
      {showLabels && (
        <div className="mono" style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 10, color: C.muted, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, background: intensityColor[2], borderRadius: 1 }} /> Easy / Z2
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, background: intensityColor[3], borderRadius: 1 }} /> Steady / Z3
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, background: intensityColor[4], borderRadius: 1 }} /> Hard / Z4
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, background: intensityColor[5], borderRadius: 1 }} /> VO2 / Z5
          </span>
        </div>
      )}
    </div>
  );
}

function buildPlanUnits(raceDate) {
  if (!raceDate) return [];
  const race = new Date(raceDate);
  if (isNaN(race.getTime())) return [];
  const planStart = new Date(race);
  planStart.setDate(planStart.getDate() - 55);
  planStart.setHours(0, 0, 0, 0);

  const units = [];
  for (let week = 1; week <= 8; week++) {
    const block = week <= 3 ? 1 : week <= 6 ? 2 : 3;
    const pattern = BLOCK_PATTERNS[block].days;
    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const date = new Date(planStart);
      date.setDate(date.getDate() + (week - 1) * 7 + dayIdx);
      let unit;
      if (week === 8 && BLOCK_PATTERNS[3].raceWeekOverride[dayIdx]) {
        unit = BLOCK_PATTERNS[3].raceWeekOverride[dayIdx];
      } else {
        unit = pattern[dayIdx];
      }
      units.push({ date: isoDay(date), week, block, dayIdx, ...unit });
    }
  }
  return units;
}

function matchPlanToActivities(units, activities, todayISO, overrides = {}) {
  return units.map(unit => {
    const override = overrides[unit.date];
    const dayActivities = activities.filter(a => a.date.slice(0, 10) === unit.date);
    const strengthMatch = dayActivities.find(a => a.sport === 'strength');
    const hasStrengthRequired = !!unit.strength;

    // Skip override
    if (override && override.action === 'skip') {
      return {
        ...unit,
        status: 'skipped',
        matchedActivity: dayActivities.find(a => a.sport !== 'strength') || dayActivities[0] || null,
        strengthMatch: strengthMatch || null,
        overrideNote: override.note || '',
      };
    }

    if (unit.sport === 'rest') return { ...unit, status: 'rest', matchedActivity: null, strengthMatch: null };
    if (unit.sport === 'race') {
      const match = dayActivities.find(a => a.sport !== 'strength');
      return {
        ...unit,
        status: match ? 'done' : (unit.date < todayISO ? 'missed' : unit.date === todayISO ? 'today' : 'future'),
        matchedActivity: match || null,
        strengthMatch: null,
      };
    }

    const cardioMatch = dayActivities.find(a => a.sport === unit.sport);
    const otherMatch = dayActivities.find(a => a.sport !== 'strength' && a.sport !== unit.sport);

    // Combo day logic: both required → both must be done for 'done'
    if (hasStrengthRequired) {
      if (cardioMatch && strengthMatch) return { ...unit, status: 'done', matchedActivity: cardioMatch, strengthMatch };
      if (cardioMatch) return { ...unit, status: 'partial', matchedActivity: cardioMatch, strengthMatch: null, partialReason: 'cardio-only' };
      if (strengthMatch) return { ...unit, status: 'partial', matchedActivity: null, strengthMatch, partialReason: 'strength-only' };
      if (otherMatch) return { ...unit, status: 'partial', matchedActivity: otherMatch, strengthMatch: null, partialReason: 'wrong-cardio' };
    } else {
      if (cardioMatch) return { ...unit, status: 'done', matchedActivity: cardioMatch, strengthMatch: strengthMatch || null };
      if (otherMatch) return { ...unit, status: 'partial', matchedActivity: otherMatch, strengthMatch: strengthMatch || null, partialReason: 'wrong-cardio' };
    }

    if (unit.date < todayISO) return { ...unit, status: 'missed', matchedActivity: null, strengthMatch: null };
    if (unit.date === todayISO) return { ...unit, status: 'today', matchedActivity: null, strengthMatch: null };
    return { ...unit, status: 'future', matchedActivity: null, strengthMatch: null };
  });
}

const STATUS_META = {
  done:    { label: 'Wykonane',    color: '#c6ff3a', mark: '✓' },
  partial: { label: 'Częściowo',   color: '#ffb83a', mark: '~' },
  today:   { label: 'Dziś',        color: '#5ab5ff', mark: '●' },
  missed:  { label: 'Opuszczone',  color: '#ff6a4a', mark: '✗' },
  future:  { label: 'Zaplanowane', color: '#9aa4ae', mark: '○' },
  rest:    { label: 'Wolne',       color: '#6b7680', mark: '—' },
  skipped: { label: 'Pominięte',   color: '#9aa4ae', mark: '⊘' },
};

// ============================================================
// Calendar integration
// ============================================================
function defaultWorkoutTime(sport, dayIdx) {
  // dayIdx: 0=Mon ... 6=Sun
  if (sport === 'swimming') return '06:30'; // morning swims
  if (sport === 'race')     return '08:00';
  if (dayIdx === 5)         return '09:00'; // Sat brick — weekend morning
  if (dayIdx === 6)         return '09:00'; // Sun long run — weekend morning
  return '17:30'; // weekday afternoons
}

function buildEventTitle(unit) {
  if (unit.sport === 'race')  return `🏁 ${unit.workout}`;
  if (unit.sport === 'rest')  return `💤 Dzień wolny`;
  const sportEmoji = { cycling: '🚴', running: '🏃', swimming: '🏊' }[unit.sport] || '🏋️';
  return `${sportEmoji} ${unit.workout}`;
}

function buildEventDescription(unit, settings) {
  const block = BLOCK_PATTERNS[unit.block];
  const lines = [];
  lines.push(`Tydzień ${unit.week} · ${block?.name || 'Plan'}`);
  lines.push('');
  lines.push(`Sport: ${SPORT_META[unit.sport]?.label || unit.sport}`);
  lines.push(`Czas: ${unit.durationMin} min`);
  if (unit.tssEstimate) lines.push(`Szacowany TSS: ${unit.tssEstimate}`);
  if (unit.strength)    lines.push(`\nUzupełniająco: ${unit.strength}`);

  const structure = inferStructure(unit.workout, unit.durationMin, unit.sport);
  if (structure.length > 0) {
    const intensityLabel = { 1: 'Łatwo', 2: 'Z2 Easy', 3: 'Z3 Steady', 4: 'Z4 Hard', 5: 'Z5 VO2' };
    lines.push('\nStruktura:');
    structure.forEach(seg => {
      const lab = seg.label ? `${seg.label} ` : '';
      lines.push(`  ${lab}${seg.d} min · ${intensityLabel[seg.i]}`);
    });
  }

  if (unit.sport === 'running') {
    lines.push('\n⚠ Kadencja min. 178 spm (ochrona kolana i L4-L5)');
  }

  if (settings?.goalType) {
    lines.push(`\nCel: ${settings.goalType}${settings.goalDate ? ' · ' + settings.goalDate : ''}`);
  }
  lines.push('\n— wygenerowano przez PaceLab');
  return lines.join('\n');
}

function pad(n) { return String(n).padStart(2, '0'); }

function localToICSDateTime(dateStr, timeStr) {
  // Returns YYYYMMDDTHHMMSS (floating local time, no Z)
  const [hh, mm] = timeStr.split(':').map(Number);
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(hh)}${pad(mm)}00`;
}

function addMinutesToICSDate(icsDt, mins) {
  // icsDt: YYYYMMDDTHHMMSS
  const y = parseInt(icsDt.slice(0, 4));
  const mo = parseInt(icsDt.slice(4, 6)) - 1;
  const d = parseInt(icsDt.slice(6, 8));
  const h = parseInt(icsDt.slice(9, 11));
  const mi = parseInt(icsDt.slice(11, 13));
  const dt = new Date(y, mo, d, h, mi);
  dt.setMinutes(dt.getMinutes() + mins);
  return `${dt.getFullYear()}${pad(dt.getMonth()+1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
}

function escapeICS(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function unitToICSEvent(unit, settings) {
  // Skip rest days — no value in calendar clutter
  if (unit.sport === 'rest') return null;

  const time = defaultWorkoutTime(unit.sport, unit.dayIdx);
  const dtStart = localToICSDateTime(unit.date, time);
  const duration = Math.max(unit.durationMin || 30, 30);
  const dtEnd = addMinutesToICSDate(dtStart, duration);
  const uid = `pacelab-${unit.date}-${unit.sport}@pacelab.local`;
  const now = new Date();
  const dtStamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeICS(buildEventTitle(unit))}`,
    `DESCRIPTION:${escapeICS(buildEventDescription(unit, settings))}`,
    `CATEGORIES:PaceLab,${escapeICS(SPORT_META[unit.sport]?.label || 'Trening')}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeICS(buildEventTitle(unit))}`,
    'END:VALARM',
    'END:VEVENT',
  ].join('\r\n');
}

function buildICSCalendar(planUnits, settings) {
  const events = planUnits.map(u => unitToICSEvent(u, settings)).filter(Boolean);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PaceLab//Endurance Plan//PL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:PaceLab — ${escapeICS(settings.goalType || 'Plan treningowy')}`,
    'X-WR-TIMEZONE:Europe/Warsaw',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

function googleCalendarLink(unit, settings) {
  if (unit.sport === 'rest') return null;
  const time = defaultWorkoutTime(unit.sport, unit.dayIdx);
  // Google "TEMPLATE" link uses YYYYMMDDTHHMMSS format (floating local time)
  const dtStart = localToICSDateTime(unit.date, time);
  const duration = Math.max(unit.durationMin || 30, 30);
  const dtEnd = addMinutesToICSDate(dtStart, duration);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: buildEventTitle(unit),
    dates: `${dtStart}/${dtEnd}`,
    details: buildEventDescription(unit, settings),
    ctz: 'Europe/Warsaw',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function downloadICS(planUnits, settings) {
  const ics = buildICSCalendar(planUnits, settings);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = (settings.goalType || 'plan').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  a.href = url; a.download = `pacelab-${safe}.ics`; a.click();
  URL.revokeObjectURL(url);
}


function DayCell({ unit, onClick, isSelected, recoveryItems = [] }) {
  const isRest = unit.sport === 'rest';
  const isRace = unit.sport === 'race';
  const SportIcon = isRace ? Target : (SPORT_META[unit.sport]?.icon || null);
  const meta = STATUS_META[unit.status] || STATUS_META.future;

  let bg, border, textColor;
  if (isRace && unit.status !== 'done') {
    bg = C.lime + '15'; border = C.lime; textColor = C.lime;
  } else if (unit.status === 'skipped') {
    bg = C.surfaceAlt; border = C.borderAlt; textColor = C.muted;
  } else if (isRest) {
    bg = C.surfaceAlt; border = C.border; textColor = C.muted;
  } else if (unit.status === 'done') {
    bg = C.lime + '12'; border = C.lime + '50'; textColor = C.text;
  } else if (unit.status === 'partial') {
    bg = C.amber + '10'; border = C.amber + '40'; textColor = C.text;
  } else if (unit.status === 'today') {
    bg = C.cyan + '12'; border = C.cyan; textColor = C.text;
  } else if (unit.status === 'missed') {
    bg = C.red + '08'; border = C.red + '30'; textColor = C.muted;
  } else {
    bg = C.surfaceAlt; border = C.border; textColor = C.textDim;
  }
  if (isSelected) border = C.lime;

  const shortLabel = isRest ? 'WOLNE'
    : isRace ? 'START'
    : unit.workout.split('(')[0].replace(/^(Rower|Bieg|Pływanie)\s/, '').trim() || unit.workout;

  const structure = useMemo(
    () => inferStructure(unit.workout, unit.durationMin, unit.sport),
    [unit.workout, unit.durationMin, unit.sport]
  );

  return (
    <button onClick={onClick} className="hoverable" style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 8,
      padding: '8px 10px',
      minHeight: 88,
      cursor: 'pointer',
      fontFamily: 'inherit',
      textAlign: 'left',
      display: 'flex', flexDirection: 'column',
      color: textColor,
      transition: 'all 0.15s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="mono" style={{ fontSize: 10, color: C.muted }}>{unit.date.slice(8,10)}.{unit.date.slice(5,7)}</span>
        <span className="mono" style={{ fontSize: 11, color: meta.color, fontWeight: 600 }}>{meta.mark}</span>
      </div>
      {SportIcon && <SportIcon size={14} color={isRace ? C.lime : SPORT_META[unit.sport]?.color || C.muted} style={{ marginTop: 6 }} />}
      <div style={{ fontSize: 10.5, lineHeight: 1.35, fontWeight: 500, marginTop: 'auto', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {shortLabel}
      </div>
      {unit.durationMin > 0 && !isRace && (
        <div className="mono" style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{unit.durationMin}'</div>
      )}
      {structure.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <WorkoutStructure structure={structure} height={6} />
        </div>
      )}
      {recoveryItems.length > 0 && (
        <div style={{ display: 'flex', gap: 3, marginTop: 6, flexWrap: 'wrap' }}>
          {recoveryItems.map((r, i) => {
            const rm = RECOVERY_TYPES[r.type] || RECOVERY_TYPES.rolling;
            return (
              <span key={i} title={`${rm.label}${r.areas ? ' · ' + r.areas : ''}`} style={{
                fontSize: 9, lineHeight: 1, padding: '2px 4px', borderRadius: 4,
                background: rm.color + '22', color: rm.color, fontWeight: 600,
              }}>{rm.icon}</span>
            );
          })}
        </div>
      )}
    </button>
  );
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.future;
  return (
    <div style={{
      padding: '6px 12px', borderRadius: 99,
      background: m.color + '15', color: m.color,
      fontSize: 12, fontWeight: 500,
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      <span style={{ fontSize: 11 }}>{m.mark}</span>
      {m.label}
    </div>
  );
}

function DecouplingBadge({ value }) {
  const abs = Math.abs(value);
  let color, label, advice;
  if (value < -2) {
    color = C.cyan;
    label = 'Negatywny drift';
    advice = 'Druga połowa lepsza niż pierwsza — negative split lub źle rozłożone tempo na start.';
  } else if (abs <= 5) {
    color = C.lime;
    label = 'Świetna efektywność';
    advice = 'HR i wysiłek skorelowane przez cały trening — solidna baza tlenowa.';
  } else if (abs <= 10) {
    color = C.lime;
    label = 'Dobra efektywność';
    advice = 'Niewielki drift HR. Norma dla treningów Z2/Z3.';
  } else if (abs <= 15) {
    color = C.amber;
    label = 'Umiarkowany drift';
    advice = 'HR rósł zauważalnie przy tej samej mocy/tempie — możliwe odwodnienie, zmęczenie albo zbyt mała baza tlenowa.';
  } else {
    color = C.red;
    label = 'Duży drift';
    advice = 'Wyraźna desynchronizacja HR od wysiłku. Sprawdź nawodnienie, glikogen, sen — albo skróć następne treningi Z3+.';
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Decoupling (aerobic drift)
        </div>
        <div style={{
          padding: '3px 10px', borderRadius: 99,
          background: color + '15', color: color,
          fontSize: 12, fontWeight: 500,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }} className="mono">
          {value > 0 ? '+' : ''}{value.toFixed(1)}% · {label}
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.textDim, marginTop: 6, lineHeight: 1.5 }}>{advice}</div>
    </div>
  );
}

function ComboDayLogistics({ unit, settings, location, onLocationChange }) {
  if (!unit.strength) return null;
  const cardio = unit.workout;
  const cardioMin = unit.durationMin;
  const strengthSess = STRENGTH_SESSIONS[unit.strength];
  const strengthMin = strengthSess?.durationMin || 25;
  const totalMin = cardioMin + strengthMin + 5;

  const isHighIntensity = /Z4|Z5|próg|VO2|intervały|×/.test(cardio) || cardio.includes('3×') || cardio.includes('4×');
  const orderAdvice = isHighIntensity
    ? 'Cardio jest intensywne — siłownia PRZED cardio, żeby zachować jakość interwałów.'
    : 'Cardio jest spokojne (Z2) — cardio PRZED siłownią, mięśnie się rozgrzeją.';

  const locations = [
    { id: 'gym', label: 'Siłownia', sub: 'pełen sprzęt' },
    { id: 'home', label: 'Dom', sub: 'gumy + plecak' },
    { id: 'travel', label: 'Wyjazd', sub: 'bodyweight' },
  ];

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <SectionLabel>Combo Day · Cardio + Siłownia</SectionLabel>
        <div className="mono" style={{ fontSize: 11, color: C.muted }}>
          ~{totalMin} min · {isHighIntensity ? 'Siłka → Cardio' : 'Cardio → Siłka'}
        </div>
      </div>

      <div style={{ fontSize: 12, color: C.textDim, marginBottom: 16, lineHeight: 1.5 }}>
        {orderAdvice}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {locations.map(loc => {
          const active = location === loc.id;
          return (
            <button
              key={loc.id}
              onClick={() => onLocationChange(loc.id)}
              style={{
                padding: '10px 12px', borderRadius: 8,
                background: active ? C.lime + '12' : 'transparent',
                border: `1px solid ${active ? C.lime + '60' : C.border}`,
                color: active ? C.lime : C.textDim,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500 }}>{loc.label}</div>
              <div className="mono" style={{ fontSize: 10, marginTop: 3, opacity: 0.7 }}>{loc.sub}</div>
            </button>
          );
        })}
      </div>

      {location === 'gym' && (
        <div style={{ marginTop: 14, fontSize: 12, color: C.textDim, lineHeight: 1.7 }}>
          <SectionLabel>Co spakować</SectionLabel>
          <div style={{ marginTop: 8 }}>
            {unit.sport === 'cycling'
              ? <>• Ubrania kolarskie pod plecak siłowniowy<br/>• Ręcznik, klapki, butelka<br/>• Trasa: dom → rower → siłka → dom komunikacją</>
              : <>• Strój biegowy + zmiana na siłownię<br/>• Ręcznik, klapki, butelka<br/>• Trasa: bieg do siłki → trening → spacerem/komunikacją</>
            }
          </div>
        </div>
      )}

      {location === 'home' && (
        <div style={{ marginTop: 14, fontSize: 12, color: C.textDim, lineHeight: 1.7 }}>
          <SectionLabel>Wykonanie</SectionLabel>
          <div style={{ marginTop: 8 }}>
            • Wracasz z cardio → 5 min shake / rozluźnienie<br/>
            • 25 min strength wg wariantów poniżej<br/>
            • 10 min protokół L4-L5
          </div>
        </div>
      )}

      {location === 'travel' && (
        <div style={{ marginTop: 14, fontSize: 12, color: C.textDim, lineHeight: 1.7 }}>
          <SectionLabel>Tryb wyjazdowy</SectionLabel>
          <div style={{ marginTop: 8 }}>
            • Pokój hotelowy w zupełności wystarczy<br/>
            • Bodyweight z 3 sek fazą ekscentryczną<br/>
            • Bezwzględnie zachowaj protokół L4-L5
          </div>
        </div>
      )}
    </Card>
  );
}

function TimeInZoneChart({ activity, settings }) {
  const data = useMemo(() => computeTimeInZone(activity, settings), [activity, settings]);
  if (!data) return null;
  const total = Object.values(data.zones).reduce((a, b) => a + b, 0);
  if (total < 60) return null; // not enough data

  const zoneColors = {
    Z1: '#9ca3af',  // szary
    Z2: '#22c55e',  // zielony jasny
    Z3: '#5a8a00',  // lime (nasze)
    Z4: '#a86700',  // amber
    Z5: '#c92a0c',  // red
    Z6: '#7c1d6f',  // purple
  };

  const fmtMinSec = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const rows = Object.entries(data.zones).filter(([_, sec]) => sec > 0).map(([z, sec]) => ({
    zone: z,
    sec,
    pct: (sec / total) * 100,
    color: zoneColors[z] || C.muted,
  }));

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <SectionLabel>Czas w strefach</SectionLabel>
        <span className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          z {data.basedOn === 'power' ? 'mocy' : 'tętna'}
        </span>
      </div>

      {/* Stacked horizontal bar */}
      <div style={{ display: 'flex', height: 32, borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
        {rows.map(r => (
          <div key={r.zone} style={{
            width: `${r.pct}%`, background: r.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, color: '#fff', fontWeight: 600,
            transition: 'all 0.2s',
          }} className="mono" title={`${r.zone}: ${fmtMinSec(r.sec)} (${r.pct.toFixed(1)}%)`}>
            {r.pct >= 8 ? r.zone : ''}
          </div>
        ))}
      </div>

      {/* Detailed list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(r => (
          <div key={r.zone} style={{
            display: 'grid', gridTemplateColumns: '40px 1fr 70px 60px',
            gap: 12, alignItems: 'center', fontSize: 12,
          }}>
            <div className="mono" style={{ color: r.color, fontWeight: 600 }}>{r.zone}</div>
            <div style={{ height: 6, background: C.surfaceAlt, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${r.pct}%`, height: '100%', background: r.color }} />
            </div>
            <div className="mono" style={{ color: C.textDim, textAlign: 'right' }}>{fmtMinSec(r.sec)}</div>
            <div className="mono" style={{ color: C.muted, textAlign: 'right' }}>{r.pct.toFixed(1)}%</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PowerDurationCurveChart({ activity }) {
  const data = useMemo(() => computePowerDurationCurve(activity), [activity]);
  if (!data || data.length < 3) return null;

  return (
    <Card>
      <div style={{ marginBottom: 14 }}>
        <SectionLabel>Power Duration Curve</SectionLabel>
        <div style={{ fontSize: 12, color: C.textDim, marginTop: 6 }}>
          Najwyższa moc utrzymana przez dany czas. Im wyższa krzywa → tym lepszy stan formy.
        </div>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid stroke={C.border} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="duration"
            stroke={C.muted}
            tick={{ fontSize: 11, fill: C.muted }}
            tickLine={false}
            axisLine={{ stroke: C.border }}
          />
          <YAxis
            stroke={C.muted}
            tick={{ fontSize: 11, fill: C.muted }}
            tickLine={false}
            axisLine={{ stroke: C.border }}
            label={{ value: 'Watts', angle: -90, position: 'insideLeft', fill: C.muted, fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{ background: C.surface, border: `1px solid ${C.borderAlt}`, borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: C.text, fontWeight: 600 }}
            formatter={(v) => [`${v} W`, 'Moc']}
          />
          <Line
            type="monotone"
            dataKey="watts"
            stroke={C.lime}
            strokeWidth={2.5}
            dot={{ fill: C.lime, r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 10, marginTop: 16 }}>
        {data.map(p => (
          <div key={p.duration} style={{
            padding: '8px 10px', background: C.surfaceAlt, borderRadius: 6, textAlign: 'center',
          }}>
            <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.05em' }}>{p.duration}</div>
            <div className="mono" style={{ fontSize: 14, color: C.lime, fontWeight: 600, marginTop: 2 }}>{p.watts}W</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RPEPicker({ activity, onChange }) {
  const current = activity.rpe || null;

  const rpeLabels = {
    1: 'Bardzo lekko',
    2: 'Lekko',
    3: 'Aktywny odpoczynek',
    4: 'Komfortowo',
    5: 'Umiarkowanie',
    6: 'Dosyć ciężko',
    7: 'Ciężko',
    8: 'Bardzo ciężko',
    9: 'Maksymalnie',
    10: 'Wszystko co mam',
  };

  const colorFor = (n) => {
    if (n <= 3) return '#9ca3af';
    if (n <= 5) return C.lime;
    if (n <= 7) return C.amber;
    return C.red;
  };

  return (
    <Card>
      <div style={{ marginBottom: 12 }}>
        <SectionLabel>RPE — jak ciężko było? (1-10)</SectionLabel>
        <div style={{ fontSize: 12, color: C.textDim, marginTop: 6 }}>
          Subiektywna ocena wysiłku. Po treningu, „na świeżo". Cenna dana — TSS to liczby, RPE to Twoje odczucie.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4, marginBottom: 12 }}>
        {[1,2,3,4,5,6,7,8,9,10].map(n => {
          const active = current === n;
          const col = colorFor(n);
          return (
            <button
              key={n}
              onClick={() => onChange(active ? null : n)}
              style={{
                aspectRatio: '1', borderRadius: 6,
                background: active ? col : 'transparent',
                color: active ? '#ffffff' : C.textDim,
                border: `1px solid ${active ? col : C.border}`,
                cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13,
                transition: 'all 0.15s',
              }}
            >
              {n}
            </button>
          );
        })}
      </div>

      {current && (
        <div className="mono" style={{ fontSize: 11, color: colorFor(current), textAlign: 'center', letterSpacing: '0.05em' }}>
          {current}/10 · {rpeLabels[current]}
        </div>
      )}
    </Card>
  );
}

function SplitsTable({ activity }) {
  const splits = useMemo(() => computeSplits(activity), [activity]);
  if (!splits || splits.length === 0) return null;

  const fmtPace = (sec) => {
    if (!sec || !isFinite(sec)) return '–';
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const isRun = activity.sport === 'running';
  const unit = isRun ? '/km' : 'km/h';

  // For cycling show speed instead of pace
  const displayPace = (s) => {
    if (isRun) return fmtPace(s.paceSecPerKm);
    const kmh = s.paceSecPerKm > 0 ? (3600 / s.paceSecPerKm) : 0;
    return kmh.toFixed(1);
  };

  // Find fastest/slowest for highlighting
  const paces = splits.filter(s => !s.partial).map(s => s.paceSecPerKm);
  const fastest = Math.min(...paces);
  const slowest = Math.max(...paces);

  // HR range for color coding
  const hrs = splits.filter(s => s.avgHR).map(s => s.avgHR);
  const minHR = hrs.length ? Math.min(...hrs) : 0;
  const maxHR = hrs.length ? Math.max(...hrs) : 0;

  return (
    <Card>
      <SectionLabel>Splity · {isRun ? 'tempo per km' : 'prędkość per km'}</SectionLabel>
      <div style={{ marginTop: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: C.muted, fontWeight: 500 }}>KM</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: C.muted, fontWeight: 500 }}>{isRun ? 'Tempo' : 'Prędkość'}</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: C.muted, fontWeight: 500 }}>Tętno</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', color: C.muted, fontWeight: 500 }}>Kadencja</th>
              <th style={{ width: '30%', padding: '6px 8px' }}></th>
            </tr>
          </thead>
          <tbody>
            {splits.map(s => {
              const isFast = !s.partial && s.paceSecPerKm === fastest;
              const isSlow = !s.partial && s.paceSecPerKm === slowest && splits.length > 1;
              // bar width by inverse pace (faster = longer bar) for run, direct for bike
              const barPct = paces.length > 1
                ? (isRun
                    ? ((slowest - s.paceSecPerKm) / (slowest - fastest || 1)) * 100
                    : ((s.paceSecPerKm === 0 ? 0 : (slowest - s.paceSecPerKm) / (slowest - fastest || 1)) * 100))
                : 50;
              return (
                <tr key={s.km} style={{ borderBottom: `1px solid ${C.border}40` }}>
                  <td className="mono" style={{ padding: '6px 8px', color: C.textDim }}>
                    {s.km}{s.partial ? <span style={{ color: C.muted, fontSize: 10 }}> ({(s.distanceM/1000).toFixed(2)})</span> : ''}
                  </td>
                  <td className="mono" style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600,
                    color: isFast ? C.lime : isSlow ? C.amber : C.text }}>
                    {displayPace(s)}<span style={{ fontSize: 9, color: C.muted, fontWeight: 400 }}> {unit}</span>
                  </td>
                  <td className="mono" style={{ padding: '6px 8px', textAlign: 'right', color: s.avgHR ? C.cyan : C.muted }}>
                    {s.avgHR ? `${s.avgHR}` : '–'}
                  </td>
                  <td className="mono" style={{ padding: '6px 8px', textAlign: 'right',
                    color: s.avgCadence ? (isRun && s.avgCadence < 175 ? C.amber : C.textDim) : C.muted }}>
                    {s.avgCadence ? `${s.avgCadence}` : '–'}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <div style={{ height: 5, background: C.surfaceAlt, borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(4, barPct)}%`, height: '100%',
                        background: isFast ? C.lime : isSlow ? C.amber : C.cyan, borderRadius: 3 }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {isRun && splits.some(s => s.avgCadence && s.avgCadence < 175) && (
        <div style={{ marginTop: 10, fontSize: 11, color: C.amber, display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertCircle size={12} /> Kadencja poniżej 175 spm na niektórych km — pamiętaj o krótkim, szybkim kroku (cel 178+) dla ochrony L4-L5.
        </div>
      )}
    </Card>
  );
}

function HRDriftChart({ activity }) {
  const series = useMemo(() => computeHRDriftSeries(activity), [activity]);
  if (!series || series.length < 5) return null;

  const hrs = series.map(s => s.hr);
  const minHR = Math.min(...hrs);
  const maxHR = Math.max(...hrs);
  const hasCadence = series.some(s => s.cadence !== null);

  return (
    <Card>
      <SectionLabel>Tętno w czasie {hasCadence ? '+ kadencja' : ''}</SectionLabel>
      <div style={{ fontSize: 12, color: C.textDim, marginTop: 6, marginBottom: 12 }}>
        Jak HR zmieniał się przez trening. Wzrost przy stałym tempie = zmęczenie, odwodnienie lub żel/kofeina.
      </div>
      <div style={{ height: 200, width: '100%' }}>
        <ResponsiveContainer>
          <LineChart data={series} margin={{ top: 5, right: 8, left: -10, bottom: 5 }}>
            <CartesianGrid stroke={C.border} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="min" stroke={C.muted} tick={{ fontSize: 10, fill: C.muted }}
              tickFormatter={(v) => `${Math.round(v)}'`} tickLine={false} axisLine={{ stroke: C.border }} />
            <YAxis yAxisId="hr" domain={[minHR - 5, maxHR + 5]} stroke={C.muted}
              tick={{ fontSize: 10, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.border }} width={36} />
            {hasCadence && (
              <YAxis yAxisId="cad" orientation="right" domain={[150, 200]} stroke={C.muted}
                tick={{ fontSize: 10, fill: C.muted }} tickLine={false} axisLine={{ stroke: C.border }} width={32} />
            )}
            <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.borderAlt}`, borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: C.textDim }} labelFormatter={(v) => `${v} min`}
              formatter={(val, name) => [val, name === 'hr' ? 'Tętno (bpm)' : 'Kadencja (spm)']} />
            <Line yAxisId="hr" type="monotone" dataKey="hr" stroke={C.cyan} strokeWidth={2} dot={false} name="hr" />
            {hasCadence && (
              <Line yAxisId="cad" type="monotone" dataKey="cadence" stroke={C.lime} strokeWidth={1.5} dot={false}
                strokeDasharray="3 3" name="cadence" connectNulls />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

const NUTRITION_PRESETS = [
  'Żel energetyczny',
  'Żel z kofeiną',
  'Baton energetyczny',
  'Izotonik',
  'Woda',
  'Sok z buraka (przed)',
  'Kofeina (przed)',
  'Banan',
  'Sól / elektrolity',
];

function NutritionLog({ activity, onChange }) {
  const items = activity.nutrition || [];
  const [adding, setAdding] = useState(false);
  const [product, setProduct] = useState(NUTRITION_PRESETS[0]);
  const [customProduct, setCustomProduct] = useState('');
  const [timeMin, setTimeMin] = useState('');

  const durationMin = activity.durationSec ? Math.round(activity.durationSec / 60) : null;

  const addItem = () => {
    const name = product === '__custom__' ? customProduct.trim() : product;
    if (!name) return;
    const entry = {
      id: Date.now(),
      product: name,
      timeMin: timeMin === '' ? null : Number(timeMin),
    };
    onChange([...items, entry].sort((a, b) => (a.timeMin ?? 9999) - (b.timeMin ?? 9999)));
    setAdding(false);
    setProduct(NUTRITION_PRESETS[0]);
    setCustomProduct('');
    setTimeMin('');
  };

  const removeItem = (id) => onChange(items.filter(i => i.id !== id));

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <SectionLabel>Żywienie podczas treningu</SectionLabel>
        {!adding && (
          <button onClick={() => setAdding(true)} style={{
            background: 'transparent', border: `1px solid ${C.border}`, color: C.lime,
            cursor: 'pointer', padding: '4px 10px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>
            <Plus size={12} /> Dodaj
          </button>
        )}
      </div>

      {items.length === 0 && !adding && (
        <div style={{ fontSize: 12, color: C.muted }}>
          Brak wpisów. Dodaj żele, izotonik, kofeinę z minutą przyjęcia — AI uwzględni to w analizie wpływu na tętno i tempo.
        </div>
      )}

      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: adding ? 14 : 0 }}>
          {items.map(it => (
            <div key={it.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
              background: C.surfaceAlt, borderRadius: 8,
            }}>
              <div className="mono" style={{ fontSize: 11, color: C.amber, minWidth: 52 }}>
                {it.timeMin !== null ? `${it.timeMin} min` : '—'}
              </div>
              <div style={{ flex: 1, fontSize: 13, color: C.text }}>{it.product}</div>
              <button onClick={() => removeItem(it.id)} style={{
                background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 2,
              }}>
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, background: C.surfaceAlt, borderRadius: 8 }}>
          <div>
            <SectionLabel>Produkt</SectionLabel>
            <select value={product} onChange={(e) => setProduct(e.target.value)} style={{
              width: '100%', marginTop: 6, padding: '8px 10px', background: C.surface,
              border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 13, fontFamily: 'inherit',
            }}>
              {NUTRITION_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
              <option value="__custom__">Inny (wpisz)…</option>
            </select>
          </div>
          {product === '__custom__' && (
            <Input type="text" value={customProduct} onChange={(e) => setCustomProduct(e.target.value)} placeholder="Nazwa produktu" />
          )}
          <div>
            <SectionLabel>Minuta przyjęcia {durationMin ? `(trening: ${durationMin} min)` : ''}</SectionLabel>
            <Input type="number" value={timeMin} onChange={(e) => setTimeMin(e.target.value)}
              placeholder="np. 22 (puste = przed startem)" suffix="min" />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn variant="ghost" onClick={() => setAdding(false)}>Anuluj</Btn>
            <Btn variant="primary" onClick={addItem}>Dodaj</Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

// Displays all captured Garmin metrics, sport-aware, in a labeled grid.
function AllMetrics({ activity: a }) {
  const fmtSec = (s) => {
    if (s === null || s === undefined) return null;
    const m = Math.floor(s / 60), sec = Math.round(s % 60);
    return `${m}:${String(sec).padStart(2,'0')}`;
  };

  // Build metric list per sport
  const metrics = [];
  const push = (label, value, unit = '', accent) => {
    if (value === null || value === undefined || value === '' || value === '--') return;
    metrics.push({ label, value, unit, accent });
  };

  // Universal
  push('Kalorie', a.calories, 'kcal', C.amber);
  if (a.aerobicTE) push('Aerobic TE', a.aerobicTE, '/5', a.aerobicTE >= 3 ? C.lime : C.textDim);
  if (a.bodyBatteryDrain) push('Body Battery', a.bodyBatteryDrain, '', C.pink);

  if (a.sport === 'running') {
    push('Kadencja śr.', a.avgCadence, 'spm', a.avgCadence && a.avgCadence < 175 ? C.amber : C.cyan);
    push('Kadencja max', a.maxCadence, 'spm');
    push('Długość kroku', a.strideLength, 'm');
    push('Oscylacja pionowa', a.vertOscillation, 'cm');
    push('Stosunek pionowy', a.vertRatio, '%');
    push('Kontakt z podłożem', a.groundContact, 'ms');
    if (a.bestPaceRaw) push('Najlepsze tempo', a.bestPaceRaw, '/km', C.lime);
    if (a.gapRaw) push('GAP (skoryg.)', a.gapRaw, '/km');
    push('Kroki', a.steps, '');
  }

  if (a.sport === 'cycling') {
    push('Moc max', a.maxPower, 'W', C.purple);
    push('Prędkość max', a.bestPaceRaw, 'km/h');
  }

  if (a.sport === 'swimming') {
    push('SWOLF', a.avgSwolf, '', C.cyan);
    push('Ruchy łącznie', a.totalStrokes, '');
    if (a.avgStrokeRate) push('Tempo ruchów', a.avgStrokeRate, '/min');
    push('Okrążenia', a.laps, '');
    if (a.bestPaceRaw) push('Najlepsze tempo', a.bestPaceRaw, '/100m', C.lime);
  }

  if (a.sport === 'strength') {
    push('Powtórzenia', a.totalReps, '', C.purple);
    push('Serie', a.totalSets, '');
  }

  // Elevation (run/bike outdoor)
  if (a.sport === 'running' || a.sport === 'cycling') {
    push('Wznios', a.totalAscent, 'm', C.lime);
    push('Spadek', a.totalDescent, 'm');
  }

  // Temperature
  if (a.minTemp !== null && a.minTemp !== undefined) {
    const t = a.maxTemp && a.maxTemp !== a.minTemp ? `${a.minTemp}–${a.maxTemp}` : `${a.minTemp}`;
    push('Temperatura', t, '°C');
  }

  if (metrics.length === 0) return null;

  return (
    <Card>
      <SectionLabel>Wszystkie metryki</SectionLabel>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 10, marginTop: 12,
      }}>
        {metrics.map((m, i) => (
          <div key={i} style={{ padding: '10px 12px', background: C.surfaceAlt, borderRadius: 8 }}>
            <div className="mono" style={{ fontSize: 9, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
              {m.label}
            </div>
            <div className="mono" style={{ fontSize: 16, fontWeight: 600, color: m.accent || C.text, lineHeight: 1 }}>
              {m.value}<span style={{ fontSize: 10, color: C.muted, fontWeight: 400, marginLeft: 2 }}>{m.unit}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function MapView({ activity }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [LeafletLib, setLeafletLib] = useState(null);

  useEffect(() => {
    if (LeafletLib) return;
    import('leaflet').then(L => setLeafletLib(L.default || L));
  }, [LeafletLib]);

  useEffect(() => {
    if (!LeafletLib || !containerRef.current || !activity?.samples) return;

    const points = activity.samples
      .filter(s => s.la !== null && s.la !== undefined && s.lo !== null && s.lo !== undefined)
      .map(s => [s.la, s.lo]);

    if (points.length < 2) return;

    // Destroy previous map if any
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const L = LeafletLib;
    const map = L.map(containerRef.current, { zoomControl: true, scrollWheelZoom: false }).setView(points[0], 14);
    mapRef.current = map;

    // Dark map tiles from CartoDB
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 18,
    }).addTo(map);

    const polyline = L.polyline(points, {
      color: C.lime, weight: 4, opacity: 0.9, smoothFactor: 1.5,
    }).addTo(map);

    // Start marker (green)
    L.circleMarker(points[0], {
      radius: 6, color: '#fff', fillColor: C.lime, fillOpacity: 1, weight: 2,
    }).addTo(map);
    // End marker (red)
    L.circleMarker(points[points.length - 1], {
      radius: 6, color: '#fff', fillColor: C.red, fillOpacity: 1, weight: 2,
    }).addTo(map);

    map.fitBounds(polyline.getBounds(), { padding: [20, 20] });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [LeafletLib, activity]);

  // Check if we have GPS data at all
  const hasGPS = activity?.samples?.some(s => s.la !== null && s.la !== undefined);
  if (!hasGPS) return null;

  return (
    <Card>
      <SectionLabel>Trasa</SectionLabel>
      <div
        ref={containerRef}
        style={{
          marginTop: 12, height: 280, width: '100%',
          background: C.surfaceAlt, borderRadius: 10, overflow: 'hidden',
        }}
      />
      {!LeafletLib && (
        <div style={{ marginTop: 8, fontSize: 11, color: C.muted, textAlign: 'center' }}>
          Ładuję mapę...
        </div>
      )}
    </Card>
  );
}

function WorkoutProtocol({ unit, settings }) {
  if (!unit || unit.sport === 'rest' && !unit.workout) return null;

  const zones = useMemo(() => computeZones(settings), [settings.ftp, settings.thresholdHR, settings.maxHR, settings.thresholdPace, settings.swimCSS]);
  const protocols = useMemo(() => buildWorkoutProtocols(zones), [zones]);

  const protocol = protocols[unit.workout]
    || buildGenericProtocol(unit.workout, unit.durationMin, unit.sport, zones);

  if (!protocol) return null;

  return (
    <Card>
      <div style={{ marginBottom: 16 }}>
        <SectionLabel>Jak to wykonać</SectionLabel>
        <div className="serif" style={{ fontSize: 22, fontStyle: 'italic', marginTop: 8, lineHeight: 1.2 }}>{protocol.summary}</div>
      </div>

      <div style={{ marginBottom: 16, fontSize: 13, color: C.textDim, lineHeight: 1.55 }}>
        <span className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginRight: 8 }}>Cel</span>
        {protocol.goal}
      </div>

      {protocol.zones && protocol.zones.length > 0 && (
        <>
          <Divider marginY={14} />
          <SectionLabel>Strefy</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {protocol.zones.map((z, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 60px', gap: 12, fontSize: 13, alignItems: 'baseline' }}>
                <span style={{ color: C.text, fontWeight: 500 }}>{z.label}</span>
                <span className="mono" style={{ color: C.textDim }}>{z.range}</span>
                <span className="mono" style={{ color: C.muted, textAlign: 'right' }}>RPE {z.rpe}</span>
              </div>
            ))}
            {protocol.zones.map((z, i) => z.feel && (
              <div key={`f-${i}`} style={{ fontSize: 12, color: C.muted, fontStyle: 'italic', paddingLeft: 0 }}>
                {z.label.split(' ')[0]}: {z.feel}
              </div>
            ))}
          </div>
        </>
      )}

      <Divider marginY={14} />
      <SectionLabel>Przebieg krok po kroku</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        {protocol.sections.map((sec, i) => (
          <div key={i} style={{
            display: 'grid',
            gridTemplateColumns: '140px 1fr 140px',
            gap: 14,
            paddingBottom: 12,
            borderBottom: i < protocol.sections.length - 1 ? `1px solid ${C.border}` : 'none',
            alignItems: 'start',
          }}>
            <div>
              <div className="mono" style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{sec.time}</div>
              <div className="mono" style={{ fontSize: 10, color: C.lime, marginTop: 4, letterSpacing: '0.05em' }}>{sec.zone}</div>
            </div>
            <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.55 }}>{sec.desc}</div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              {sec.hr && (
                <div className="mono" style={{
                  padding: '3px 9px',
                  background: C.surfaceAlt,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  fontSize: 11,
                  color: C.cyan,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}>
                  {sec.hr}
                </div>
              )}
              {sec.pace && (
                <div className="mono" style={{
                  padding: '3px 9px',
                  background: C.surfaceAlt,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  fontSize: 11,
                  color: C.lime,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}>
                  {sec.pace}
                </div>
              )}
              {sec.speed && (
                <div className="mono" style={{
                  padding: '3px 9px',
                  background: C.surfaceAlt,
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  fontSize: 11,
                  color: C.lime,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}>
                  {sec.speed}
                </div>
              )}
              {!sec.hr && !sec.pace && !sec.speed && (
                <span className="mono" style={{ fontSize: 11, color: C.muted }}>—</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {protocol.tips && protocol.tips.length > 0 && (
        <>
          <Divider marginY={14} />
          <SectionLabel color={C.lime} accent={C.lime}>Wskazówki</SectionLabel>
          <ul style={{ margin: '10px 0 0', padding: '0 0 0 20px', fontSize: 13, color: C.textDim, lineHeight: 1.7 }}>
            {protocol.tips.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </>
      )}

      {protocol.mistakes && protocol.mistakes.length > 0 && (
        <>
          <Divider marginY={14} />
          <SectionLabel color={C.amber} accent={C.amber}>Częste błędy</SectionLabel>
          <ul style={{ margin: '10px 0 0', padding: '0 0 0 20px', fontSize: 13, color: C.textDim, lineHeight: 1.7 }}>
            {protocol.mistakes.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </>
      )}
    </Card>
  );
}

function StrengthSession({ strengthKey, location, equipment }) {
  const sess = STRENGTH_SESSIONS[strengthKey];
  if (!sess) return null;

  const variantColor = {
    gym: C.lime,
    home: C.cyan,
    bands: C.cyan,
    bodyweight: C.amber,
  };

  return (
    <Card>
      <div style={{ marginBottom: 16 }}>
        <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Sesja siłowa · {sess.durationMin} min
        </div>
        <div style={{ fontSize: 16, fontWeight: 500, marginTop: 4 }}>{sess.label}</div>
        <div style={{ fontSize: 12, color: C.textDim, marginTop: 6, lineHeight: 1.5 }}>{sess.purpose}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sess.exercises.map((ex, idx) => {
          const v = getExerciseVariant(ex, location, equipment);
          return (
            <div key={idx} style={{
              padding: 14, background: C.surfaceAlt,
              borderRadius: 8, border: `1px solid ${C.border}`,
              borderLeft: `3px solid ${variantColor[v.variant] || C.muted}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{idx + 1}. {ex.name}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 3, fontStyle: 'italic' }}>{ex.purpose}</div>
                </div>
                <div className="mono" style={{
                  fontSize: 10, padding: '3px 8px', borderRadius: 99,
                  background: (variantColor[v.variant] || C.muted) + '15',
                  color: variantColor[v.variant] || C.muted,
                  letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600,
                }}>
                  {v.variant === 'gym' ? 'GYM' : v.variant === 'home' ? 'DOM' : v.variant === 'bands' ? 'GUMY' : 'BODYWEIGHT'}
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 13, color: C.text }}>{v.instruction}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function DayDetailCard({ unit, onSkip, onUnskip, settings, location, onLocationChange }) {
  const SportIcon = unit.sport === 'race' ? Target : (SPORT_META[unit.sport]?.icon || Activity);
  const sportColor = unit.sport === 'race' ? C.lime : (SPORT_META[unit.sport]?.color || C.text);
  const block = BLOCK_PATTERNS[unit.block];
  const structure = useMemo(
    () => inferStructure(unit.workout, unit.durationMin, unit.sport),
    [unit.workout, unit.durationMin, unit.sport]
  );

  const handleSkip = () => {
    const note = prompt('Powód pominięcia (opcjonalnie):', '');
    if (note === null) return; // user cancelled
    onSkip(unit.date, note);
  };

  const canSkip = onSkip && unit.sport !== 'rest' && unit.sport !== 'race' && unit.status !== 'done';

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            {fmtDateFull(unit.date)} · Tydz. {unit.week} · {block.short}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <SportIcon size={22} color={sportColor} />
            <div style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.3 }}>{unit.workout}</div>
          </div>
          {unit.strength && (
            <div style={{ marginTop: 12, fontSize: 13, color: C.textDim }}>
              <span className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginRight: 8 }}>Uzupełniająco</span>
              {unit.strength}
            </div>
          )}
        </div>
        <StatusBadge status={unit.status} />
      </div>

      {structure.length > 0 && unit.status !== 'skipped' && (
        <div style={{ marginTop: 18 }}>
          <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
            Struktura · {unit.durationMin} min łącznie
          </div>
          <WorkoutStructure structure={structure} height={28} showLabels />
        </div>
      )}

      {unit.status !== 'skipped' && unit.status !== 'rest' && (
        <div style={{ marginTop: 18 }}>
          <WorkoutProtocol unit={unit} settings={settings} />
        </div>
      )}

      {unit.strength && unit.status !== 'skipped' && (
        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ComboDayLogistics unit={unit} settings={settings} location={location} onLocationChange={onLocationChange} />
          <StrengthSession strengthKey={unit.strength} location={location} equipment={settings?.homeEquipment} />
        </div>
      )}

      {unit.matchedActivity && (
        <div style={{ marginTop: 16, padding: 14, background: C.surfaceAlt, borderRadius: 8, border: `1px solid ${C.lime}30` }}>
          <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
            Powiązana aktywność z Garmina
          </div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{unit.matchedActivity.name}</div>
          <div className="mono" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8, fontSize: 12, color: C.textDim }}>
            <span>{fmtDur(unit.matchedActivity.durationSec)}</span>
            <span>{fmtDist(unit.matchedActivity.distanceM)}</span>
            {unit.matchedActivity.avgHR && <span>HR ⌀ {unit.matchedActivity.avgHR}</span>}
            {unit.matchedActivity.maxHR && <span>HR max {unit.matchedActivity.maxHR}</span>}
            <span style={{ color: C.lime }}>TSS {unit.matchedActivity.tss}</span>
          </div>
          {unit.matchedActivity.decoupling !== null && unit.matchedActivity.decoupling !== undefined && (
            <DecouplingBadge value={unit.matchedActivity.decoupling} />
          )}
        </div>
      )}

      {unit.status === 'skipped' && (
        <div style={{ marginTop: 16, padding: '12px 14px', background: C.surfaceAlt, borderRadius: 8, border: `1px solid ${C.borderAlt}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
                Pominięte świadomie
              </div>
              {unit.overrideNote ? (
                <div style={{ fontSize: 13, color: C.textDim, fontStyle: 'italic' }}>„{unit.overrideNote}"</div>
              ) : (
                <div style={{ fontSize: 12, color: C.muted }}>Bez notatki</div>
              )}
            </div>
            {onUnskip && (
              <Btn onClick={() => onUnskip(unit.date)} variant="ghost">Cofnij pominięcie</Btn>
            )}
          </div>
        </div>
      )}

      {unit.sport !== 'rest' && unit.status !== 'done' && unit.status !== 'skipped' && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, color: C.muted }}>
            Domyślna godzina: <span className="mono">{defaultWorkoutTime(unit.sport, unit.dayIdx)}</span> · <span className="mono">{unit.durationMin} min</span>
          </div>
          <a
            href={googleCalendarLink(unit, settings || {})}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
              background: 'transparent', color: C.text, border: `1px solid ${C.borderAlt}`,
              textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8,
              fontFamily: 'inherit', transition: 'all 0.15s',
            }}
          >
            <ExternalLink size={13} /> Dodaj do Google Calendar
          </a>
        </div>
      )}

      {unit.status === 'missed' && (
        <div style={{ marginTop: 16, padding: '12px 14px', background: C.red + '10', borderRadius: 8, fontSize: 12, color: C.red, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>Dzień minął bez powiązanej aktywności. Jeśli to było intencjonalne (wyjazd, regeneracja), oznacz jako pominięty.</span>
          {canSkip && <Btn onClick={handleSkip} variant="ghost">Oznacz jako pominięty</Btn>}
        </div>
      )}

      {unit.status === 'today' && (
        <div style={{ marginTop: 16, padding: '12px 14px', background: C.cyan + '10', borderRadius: 8, fontSize: 12, color: C.cyan, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>To dzisiejszy trening. Powodzenia!</span>
          {canSkip && <Btn onClick={handleSkip} variant="ghost">Pomijam dziś</Btn>}
        </div>
      )}

      {unit.status === 'future' && canSkip && (
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Btn onClick={handleSkip} variant="ghost">Pomiń ten dzień</Btn>
        </div>
      )}
    </Card>
  );
}

function WeeklyLoadChart({ planUnits, activities, todayISO }) {
  const data = useMemo(() => {
    return [1, 2, 3, 4, 5, 6, 7, 8].map(weekNum => {
      const weekUnits = planUnits.filter(u => u.week === weekNum);
      const planned = weekUnits.reduce((s, u) => s + (u.tssEstimate || 0), 0);
      const weekStart = weekUnits[0]?.date;
      const weekEnd = weekUnits[6]?.date;
      const actual = activities
        .filter(a => {
          const d = a.date.slice(0, 10);
          return d >= weekStart && d <= weekEnd;
        })
        .reduce((s, a) => s + (a.tss || 0), 0);
      const block = weekUnits[0]?.block || 1;
      const isPast = weekEnd < todayISO;
      const isCurrent = weekStart <= todayISO && todayISO <= weekEnd;
      return {
        week: `T${weekNum}`,
        weekNum,
        planned,
        actual: actual || null, // null hides the dot on the line for empty weeks
        block,
        color: BLOCK_PATTERNS[block].color,
        weekStart,
        weekEnd,
        isPast,
        isCurrent,
      };
    });
  }, [planUnits, activities, todayISO]);

  const maxTSS = Math.max(...data.map(d => Math.max(d.planned, d.actual || 0)), 100);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500 }}>Tygodniowe obciążenie</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Zaplanowany TSS (słupki, kolory bloków) vs realny (linia z Garmina)</div>
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: 11, alignItems: 'center', flexWrap: 'wrap' }} className="mono">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.textDim }}>
            <span style={{ width: 10, height: 10, background: BLOCK_PATTERNS[1].color, borderRadius: 2 }} /> Adaptacja
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.textDim }}>
            <span style={{ width: 10, height: 10, background: BLOCK_PATTERNS[2].color, borderRadius: 2 }} /> Szczyt
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.textDim }}>
            <span style={{ width: 10, height: 10, background: BLOCK_PATTERNS[3].color, borderRadius: 2 }} /> Tapering
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.textDim }}>
            <span style={{ width: 10, height: 2, background: C.text }} /> Realne
          </span>
        </div>
      </div>
      <div style={{ height: 260 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 10, right: 14, left: -10, bottom: 0 }}>
            <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="week" tick={{ fill: C.muted, fontSize: 11 }} stroke={C.border} />
            <YAxis tick={{ fill: C.muted, fontSize: 10 }} stroke={C.border} domain={[0, Math.ceil(maxTSS / 50) * 50]} />
            <Tooltip
              contentStyle={{ background: C.surfaceAlt, border: `1px solid ${C.borderAlt}`, borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: C.textDim }}
              itemStyle={{ color: C.text }}
              formatter={(value, name) => {
                if (value === null) return ['—', name];
                return [Math.round(value), name === 'planned' ? 'Zaplanowane' : 'Zrealizowane'];
              }}
            />
            <Bar dataKey="planned" radius={[4, 4, 0, 0]} maxBarSize={48}>
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.color}
                  fillOpacity={d.isCurrent ? 1 : d.isPast ? 0.4 : 0.7}
                  stroke={d.isCurrent ? d.color : 'none'}
                  strokeWidth={d.isCurrent ? 2 : 0}
                />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey="actual"
              stroke={C.text}
              strokeWidth={2}
              dot={{ fill: C.text, r: 4 }}
              activeDot={{ r: 6 }}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function Plan({ activities, pmcData, settings, setSettings, planOverrides, setPlanOverrides, recovery }) {
  const todayISO = isoDay(new Date());

  const planUnits = useMemo(() => {
    const raw = buildPlanUnits(settings.goalDate);
    return matchPlanToActivities(raw, activities, todayISO, planOverrides || {});
  }, [settings.goalDate, activities, todayISO, planOverrides]);

  const [selectedIdx, setSelectedIdx] = useState(null);
  const [aiPlan, setAiPlan] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get('pacelab:plan');
        if (r && r.value) setAiPlan(JSON.parse(r.value));
      } catch (e) {}
    })();
  }, []);

  // Auto-select today (or first unit) on load
  useEffect(() => {
    if (selectedIdx === null && planUnits.length > 0) {
      const todayIdx = planUnits.findIndex(u => u.date === todayISO);
      setSelectedIdx(todayIdx >= 0 ? todayIdx : 0);
    }
  }, [planUnits, selectedIdx, todayISO]);

  const stats = useMemo(() => {
    const training = planUnits.filter(u => u.sport !== 'rest' && u.sport !== 'race');
    const done = training.filter(u => u.status === 'done').length;
    const partial = training.filter(u => u.status === 'partial').length;
    const missed = training.filter(u => u.status === 'missed').length;
    const skipped = training.filter(u => u.status === 'skipped').length;
    const effectiveTotal = training.length - skipped; // skipped removed from denominator
    const past = done + partial + missed;
    const remaining = effectiveTotal - past;
    const pctOverall = effectiveTotal > 0 ? Math.round((done + partial * 0.5) / effectiveTotal * 100) : 0;
    return { total: training.length, effectiveTotal, done, partial, missed, skipped, past, remaining, pctOverall };
  }, [planUnits]);

  const blockStats = useMemo(() => {
    return [1, 2, 3].map(b => {
      const units = planUnits.filter(u => u.block === b && u.sport !== 'rest' && u.sport !== 'race');
      const done = units.filter(u => u.status === 'done').length;
      const partial = units.filter(u => u.status === 'partial').length;
      const missed = units.filter(u => u.status === 'missed').length;
      const skipped = units.filter(u => u.status === 'skipped').length;
      const effectiveTotal = units.length - skipped;
      const past = done + partial + missed;
      const pct = effectiveTotal > 0 ? Math.round((done + partial * 0.5) / effectiveTotal * 100) : 0;
      return { block: b, total: units.length, effectiveTotal, done, partial, missed, skipped, past, remaining: effectiveTotal - past, pct };
    });
  }, [planUnits]);

  const daysToRace = settings.goalDate
    ? Math.ceil((new Date(settings.goalDate) - new Date(todayISO)) / (1000 * 60 * 60 * 24))
    : null;

  const currentUnit = planUnits.find(u => u.date === todayISO);
  const currentBlock = currentUnit?.block || null;
  const selected = selectedIdx !== null && planUnits[selectedIdx] ? planUnits[selectedIdx] : null;

  const onSkipDay = (date, note) => {
    setPlanOverrides({
      ...(planOverrides || {}),
      [date]: { action: 'skip', note: note || '', ts: new Date().toISOString() },
    });
  };

  const onUnskipDay = (date) => {
    const next = { ...(planOverrides || {}) };
    delete next[date];
    setPlanOverrides(next);
  };

  // Strength location per day: gym | home | travel
  // Default: travel if travelMode on, else home (variant C — dom default, gym okazjonalnie)
  const getStrengthLocation = (date) => {
    const ov = planOverrides?.[date];
    if (ov?.strengthLocation) return ov.strengthLocation;
    return settings.travelMode ? 'travel' : 'home';
  };

  const setStrengthLocation = (date, loc) => {
    const prev = planOverrides?.[date] || {};
    setPlanOverrides({
      ...(planOverrides || {}),
      [date]: { ...prev, strengthLocation: loc },
    });
  };

  const generateAiPlan = async () => {
    setAiLoading(true); setAiError(null);
    const context = buildContext(activities, pmcData, settings, recovery);
    const system = `Jesteś ekspertem od treningu wytrzymałościowego. Wygeneruj plan tygodniowy w formacie JSON spójny z makrocyklem sportowca.
Zwróć WYŁĄCZNIE poprawny JSON (bez \`\`\`json), strukturą:
{
  "summary": "krótkie podsumowanie strategii tygodnia (1-2 zdania po polsku)",
  "targetTSS": liczba (cel TSS na ten tydzień),
  "days": [
    {"day":"Poniedziałek","type":"Rest|Endurance|Tempo|Threshold|VO2|Recovery|Long|Brick","sport":"cycling|running|swimming","duration":"czas","intensity":"strefa","tss":liczba,"description":"opis"}
  ]
}

${context}`;

    try {
      const data = await callClaude({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system,
        messages: [{ role: 'user', content: 'Wygeneruj plan na następny tydzień zgodny z moim makrocyklem.' }],
      });
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
      const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
      const parsed = JSON.parse(cleaned);
      parsed.generatedAt = new Date().toISOString();
      setAiPlan(parsed);
      await window.storage.set('pacelab:plan', JSON.stringify(parsed));
    } catch (e) {
      setAiError(`Nie udało się wygenerować: ${e.message}`);
    }
    setAiLoading(false);
  };

  if (!settings.goalDate) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Target size={36} color={C.muted} style={{ margin: '0 auto 16px' }} />
          <div style={{ fontSize: 16, fontWeight: 500 }}>Brak daty zawodów</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 8 }}>Ustaw datę celu w Ustawieniach żeby zobaczyć plan makrocyklu.</div>
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Race header */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Cel</div>
            <div className="serif" style={{ fontSize: 30, fontStyle: 'italic', marginTop: 6, lineHeight: 1.15 }}>{settings.goalType}</div>
            <div className="mono" style={{ fontSize: 12, color: C.lime, marginTop: 8 }}>{fmtDateFull(settings.goalDate)}</div>
            <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <Btn onClick={() => downloadICS(planUnits, settings)} variant="ghost" icon={Download}>
                Eksport do kalendarza (.ics)
              </Btn>
              <button
                onClick={() => setSettings({...settings, travelMode: !settings.travelMode})}
                style={{
                  padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                  background: settings.travelMode ? C.amber + '15' : 'transparent',
                  color: settings.travelMode ? C.amber : C.textDim,
                  border: `1px solid ${settings.travelMode ? C.amber + '60' : C.borderAlt}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                }}
              >
                {settings.travelMode ? '✈ Tryb wyjazdowy: ON' : 'Tryb wyjazdowy: OFF'}
              </button>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              {daysToRace > 0 ? 'do startu' : daysToRace === 0 ? 'DZIŚ!' : 'po starcie'}
            </div>
            <div className="mono" style={{ fontSize: 64, fontWeight: 500, color: C.lime, lineHeight: 1, letterSpacing: '-0.03em', marginTop: 4 }}>
              {Math.abs(daysToRace)}
            </div>
            <div className="mono" style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>dni</div>
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12 }}>
            <span style={{ color: C.textDim }}>Realizacja planu treningowego</span>
            <span className="mono" style={{ color: C.text }}>{stats.done + stats.partial}/{stats.effectiveTotal} jednostek · <span style={{ color: C.lime }}>{stats.pctOverall}%</span></span>
          </div>
          <div style={{ height: 8, background: C.surfaceAlt, borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(stats.done / Math.max(stats.effectiveTotal,1) * 100)}%`, background: C.lime }} />
            <div style={{ position: 'absolute', left: `${(stats.done / Math.max(stats.effectiveTotal,1) * 100)}%`, top: 0, bottom: 0, width: `${(stats.partial / Math.max(stats.effectiveTotal,1) * 100)}%`, background: C.amber }} />
            <div style={{ position: 'absolute', left: `${((stats.done + stats.partial) / Math.max(stats.effectiveTotal,1) * 100)}%`, top: 0, bottom: 0, width: `${(stats.missed / Math.max(stats.effectiveTotal,1) * 100)}%`, background: C.red + '60' }} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12, fontSize: 11 }} className="mono">
            <span style={{ color: C.lime }}>✓ {stats.done} wykonane</span>
            {stats.partial > 0 && <span style={{ color: C.amber }}>~ {stats.partial} częściowo</span>}
            {stats.missed > 0 && <span style={{ color: C.red }}>✗ {stats.missed} opuszczone</span>}
            {stats.skipped > 0 && <span style={{ color: C.muted }}>⊘ {stats.skipped} pominięte intencjonalnie</span>}
            <span style={{ color: C.textDim, marginLeft: 'auto' }}>○ {stats.remaining} przed Tobą</span>
          </div>
        </div>
      </Card>

      {/* Block progress */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {blockStats.map((bs) => {
          const block = BLOCK_PATTERNS[bs.block];
          const isCurrent = currentBlock === bs.block;
          return (
            <Card key={bs.block} style={{ borderColor: isCurrent ? block.color : C.border, position: 'relative', borderWidth: isCurrent ? 1 : 1 }}>
              {isCurrent && (
                <div className="mono" style={{ position: 'absolute', top: 12, right: 12, fontSize: 9, padding: '3px 8px', background: block.color + '20', color: block.color, borderRadius: 99, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  teraz
                </div>
              )}
              <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Blok {bs.block}</div>
              <div style={{ fontSize: 16, fontWeight: 500, marginTop: 4 }}>{block.short}</div>
              <div className="mono" style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Tygodnie {block.weeks.join('–')}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 18 }}>
                <span className="mono" style={{ fontSize: 32, fontWeight: 500, color: block.color, lineHeight: 1, letterSpacing: '-0.02em' }}>{bs.pct}%</span>
                <span className="mono" style={{ fontSize: 11, color: C.muted }}>{bs.done + bs.partial}/{bs.total}</span>
              </div>
              <div style={{ height: 4, background: C.surfaceAlt, borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${bs.pct}%`, background: block.color }} />
              </div>
            </Card>
          );
        })}
      </div>

      {/* Weekly load chart */}
      <WeeklyLoadChart planUnits={planUnits} activities={activities} todayISO={todayISO} />

      {/* Calendar grid */}
      <Card>
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Kalendarz makrocyklu</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Kliknij dzień żeby zobaczyć szczegóły</div>
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, alignItems: 'center', flexWrap: 'wrap' }} className="mono">
            <span style={{ color: C.lime }}>✓ wykonane</span>
            <span style={{ color: C.amber }}>~ częściowo</span>
            <span style={{ color: C.cyan }}>● dziś</span>
            <span style={{ color: C.red }}>✗ opuszczone</span>
            <span style={{ color: C.textDim }}>○ przed</span>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '108px repeat(7, minmax(94px, 1fr))', gap: 4, minWidth: 760 }}>
            <div></div>
            {['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Ndz'].map(d => (
              <div key={d} className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', textAlign: 'center', paddingBottom: 8 }}>{d}</div>
            ))}

            {[1, 2, 3, 4, 5, 6, 7, 8].map(weekNum => {
              const weekUnits = planUnits.filter(u => u.week === weekNum);
              const blockId = weekUnits[0]?.block || 1;
              const block = BLOCK_PATTERNS[blockId];
              const weekStart = weekUnits[0]?.date;
              const weekEnd = weekUnits[6]?.date;
              const isCurrentWeek = weekUnits.some(u => u.date === todayISO);

              return (
                <React.Fragment key={weekNum}>
                  <div style={{ padding: '8px 8px 8px 0', borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div className="mono" style={{ fontSize: 12, color: isCurrentWeek ? block.color : C.text, fontWeight: 600 }}>T{weekNum}</div>
                    <div className="mono" style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>
                      {weekStart && `${weekStart.slice(8,10)}.${weekStart.slice(5,7)}`}–{weekEnd && `${weekEnd.slice(8,10)}.${weekEnd.slice(5,7)}`}
                    </div>
                    <div className="mono" style={{ fontSize: 9, color: block.color, marginTop: 4, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 500 }}>
                      {block.short.slice(0, 8)}
                    </div>
                  </div>
                  {weekUnits.map((u) => {
                    const globalIdx = planUnits.findIndex(x => x.date === u.date);
                    const dayRecovery = (recovery || []).filter(r => r.date === u.date);
                    return <DayCell key={u.date} unit={u} onClick={() => setSelectedIdx(globalIdx)} isSelected={selectedIdx === globalIdx} recoveryItems={dayRecovery} />;
                  })}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Selected day detail */}
      {selected && <DayDetailCard unit={selected} onSkip={onSkipDay} onUnskip={onUnskipDay} settings={settings} location={getStrengthLocation(selected.date)} onLocationChange={(loc) => setStrengthLocation(selected.date, loc)} />}

      {/* AI weekly plan (collapsible) */}
      <Card>
        <button onClick={() => setAiOpen(o => !o)} style={{
          background: 'transparent', border: 'none', color: C.text, fontFamily: 'inherit',
          cursor: 'pointer', width: '100%', textAlign: 'left',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Plan ad-hoc z Coach AI</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
              Dynamiczny plan tygodniowy uwzględniający Twoje aktualne CTL/TSB i wyjazdy.
            </div>
          </div>
          <Sparkles size={16} color={C.lime} style={{ transform: aiOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
        </button>

        {aiOpen && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
            <Btn onClick={generateAiPlan} variant="primary" icon={aiLoading ? Loader2 : Sparkles} disabled={aiLoading}>
              {aiLoading ? 'Generuję...' : aiPlan ? 'Wygeneruj nowy' : 'Wygeneruj plan tygodnia'}
            </Btn>
            {aiError && <div style={{ marginTop: 12, padding: '8px 12px', background: C.red + '15', color: C.red, borderRadius: 6, fontSize: 12 }}>{aiError}</div>}
            {aiPlan && (
              <div style={{ marginTop: 16 }}>
                {aiPlan.summary && (
                  <div className="serif" style={{ fontSize: 16, fontStyle: 'italic', color: C.textDim, lineHeight: 1.5, marginBottom: 16, paddingLeft: 14, borderLeft: `2px solid ${C.lime}` }}>
                    {aiPlan.summary}
                  </div>
                )}
                {aiPlan.targetTSS && (
                  <div className="mono" style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>
                    Cel tygodnia: <span style={{ color: C.lime }}>{aiPlan.targetTSS} TSS</span>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(aiPlan.days || []).map((d, i) => {
                    const SI = SPORT_META[d.sport]?.icon || Activity;
                    return (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 28px 1fr 70px 60px 50px', gap: 12, alignItems: 'center', padding: '10px 12px', background: C.surfaceAlt, borderRadius: 6 }}>
                        <div style={{ fontSize: 12 }}>{d.day}</div>
                        <SI size={14} color={SPORT_META[d.sport]?.color || C.muted} />
                        <div style={{ fontSize: 12, color: C.textDim }}>{d.description}</div>
                        <div className="mono" style={{ fontSize: 11, color: C.muted, textAlign: 'right' }}>{d.duration}</div>
                        <div className="mono" style={{ fontSize: 11, color: C.muted, textAlign: 'right' }}>{d.intensity}</div>
                        <div className="mono" style={{ fontSize: 12, color: C.lime, textAlign: 'right', fontWeight: 500 }}>{d.tss || 0}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// ============================================================
// Settings tab
// ============================================================
function RulesEditor({ rules, onChange }) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...rules, v]);
    setDraft('');
  };
  const remove = (idx) => onChange(rules.filter((_, i) => i !== idx));
  const edit = (idx, val) => onChange(rules.map((r, i) => i === idx ? val : r));

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {rules.length === 0 && (
          <div style={{ fontSize: 12, color: C.muted, fontStyle: 'italic', padding: '12px 14px', background: C.surfaceAlt, borderRadius: 8 }}>
            Brak reguł. Dodaj poniżej — np. „Bez 2 ciężkich dni z rzędu".
          </div>
        )}
        {rules.map((r, idx) => (
          <div key={idx} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: C.surfaceAlt, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: '8px 12px',
          }}>
            <div className="mono" style={{ fontSize: 11, color: C.lime, fontWeight: 600, minWidth: 20 }}>{idx + 1}.</div>
            <input
              value={r}
              onChange={e => edit(idx, e.target.value)}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: C.text, fontSize: 13, fontFamily: 'inherit',
              }}
            />
            <button onClick={() => remove(idx)} style={{
              background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 4,
            }}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Dodaj nową regułę..."
          style={{
            flex: 1, background: C.surfaceAlt, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 13,
            fontFamily: 'inherit', outline: 'none',
          }}
        />
        <Btn onClick={add} variant="ghost" disabled={!draft.trim()}>Dodaj</Btn>
      </div>
    </div>
  );
}

function Journal({ journal, setJournal, onOpenNew, activities }) {
  const sorted = useMemo(() => {
    return [...(journal || [])].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [journal]);

  const handleDelete = (id) => {
    if (!confirm('Skasować wpis?')) return;
    setJournal(prev => prev.filter(e => e.id !== id));
  };

  const feelingMeta = {
    great: { label: 'Świetnie', color: C.lime,  emoji: '🟢' },
    good:  { label: 'Dobrze',   color: C.lime,  emoji: '🟢' },
    meh:   { label: 'Średnio',  color: C.amber, emoji: '🟡' },
    bad:   { label: 'Słabo',    color: C.red,   emoji: '🔴' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <SectionLabel>Dziennik treningu</SectionLabel>
            <div className="serif" style={{ fontSize: 28, fontStyle: 'italic', marginTop: 6, lineHeight: 1.1 }}>
              Twoje refleksje
            </div>
            <div style={{ fontSize: 13, color: C.textDim, marginTop: 10, lineHeight: 1.55 }}>
              Wszystkie wpisy głosowe i tekstowe. AI uczy się Twoich wzorców i sugeruje zmiany w planie.
            </div>
          </div>
          <Btn onClick={onOpenNew} variant="primary" icon={Mic}>
            Nowy wpis
          </Btn>
        </div>
      </Card>

      {sorted.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <MessageSquare size={28} color={C.muted} style={{ margin: '0 auto 12px' }} />
            <div style={{ fontSize: 14, color: C.textDim }}>Brak wpisów</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Kliknij „Nowy wpis" żeby zacząć.</div>
          </div>
        </Card>
      ) : (
        sorted.map(entry => {
          const linkedAct = entry.activityId ? activities.find(a => a.id === entry.activityId) : null;
          const f = entry.analysis?.feeling ? feelingMeta[entry.analysis.feeling] : null;
          const dt = new Date(entry.timestamp);
          return (
            <Card key={entry.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <div>
                  <SectionLabel accent={f?.color}>
                    {dt.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' })} · {dt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                  </SectionLabel>
                  {f && (
                    <div style={{ marginTop: 8 }}>
                      <span className="mono" style={{
                        padding: '3px 10px', borderRadius: 99,
                        background: f.color + '15', color: f.color,
                        fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
                      }}>
                        Samopoczucie: {f.label}
                      </span>
                    </div>
                  )}
                </div>
                <button onClick={() => handleDelete(entry.id)} style={{
                  background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 4,
                }} title="Usuń">
                  <Trash2 size={14} />
                </button>
              </div>

              {linkedAct && (
                <div style={{ marginBottom: 12, padding: '8px 12px', background: C.surfaceAlt, borderRadius: 6, fontSize: 12, color: C.textDim, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {(() => { const Icon = SPORT_META[linkedAct.sport]?.icon || Activity; return <Icon size={12} color={SPORT_META[linkedAct.sport]?.color} />; })()}
                  {linkedAct.name} · {fmtDur(linkedAct.durationSec)} · TSS {linkedAct.tss}
                </div>
              )}

              <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6, fontStyle: 'italic', padding: '10px 14px', background: C.surfaceAlt, borderRadius: 8, marginBottom: 12 }}>
                „{entry.transcript}"
              </div>

              {entry.analysis && (
                <>
                  {entry.analysis.summary && (
                    <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.55, marginBottom: 12 }}>
                      <span className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginRight: 8 }}>AI</span>
                      {entry.analysis.summary}
                    </div>
                  )}

                  {entry.analysis.observations?.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <SectionLabel>Obserwacje</SectionLabel>
                      <ul style={{ margin: '8px 0 0', padding: '0 0 0 20px', fontSize: 12, color: C.textDim, lineHeight: 1.65 }}>
                        {entry.analysis.observations.map((o, i) => <li key={i}>{o}</li>)}
                      </ul>
                    </div>
                  )}

                  {entry.analysis.suggestions?.length > 0 && (
                    <div>
                      <SectionLabel>Sugestie</SectionLabel>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                        {entry.analysis.suggestions.map((s, i) => {
                          const wasAccepted = entry.acceptedSuggestionIds?.includes(s.id);
                          return (
                            <div key={i} style={{
                              padding: '8px 12px', borderRadius: 6, fontSize: 12,
                              background: wasAccepted ? C.lime + '08' : 'transparent',
                              border: `1px solid ${wasAccepted ? C.lime + '30' : C.border}`,
                              color: C.textDim,
                            }}>
                              <span className="mono" style={{ fontSize: 9, color: wasAccepted ? C.lime : C.muted, marginRight: 8, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                                {wasAccepted ? '✓ Zaakceptowane' : s.type}
                              </span>
                              {s.text || (s.type === 'skip' ? `Pominięcie ${s.date}: ${s.note}` : '')}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}

function Glossary() {
  const MetricCard = ({ symbol, name, alias, color, summary, scale, formula, advice }) => (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div className="mono" style={{ fontSize: 11, color: color, fontWeight: 600, letterSpacing: '0.1em' }}>{symbol}</div>
          <div className="serif" style={{ fontSize: 28, fontStyle: 'italic', marginTop: 4, lineHeight: 1.1 }}>{name}</div>
          {alias && <div style={{ fontSize: 13, color: C.textDim, marginTop: 4 }}>„{alias}"</div>}
        </div>
      </div>
      <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6, marginBottom: formula ? 12 : 0 }}>
        {summary}
      </div>
      {formula && (
        <div className="mono" style={{ padding: '10px 14px', background: C.surfaceAlt, borderRadius: 6, fontSize: 12, color: C.textDim, marginBottom: 12 }}>
          {formula}
        </div>
      )}
      {scale && (
        <>
          <Divider marginY={14} />
          <SectionLabel>Skala</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {scale.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 12, fontSize: 13 }}>
                <span className="mono" style={{ color: s.color || C.textDim, minWidth: 100, fontWeight: 500 }}>{s.range}</span>
                <span style={{ color: C.text }}>{s.label}</span>
                {s.note && <span style={{ color: C.muted, fontSize: 12 }}>· {s.note}</span>}
              </div>
            ))}
          </div>
        </>
      )}
      {advice && (
        <>
          <Divider marginY={14} />
          <SectionLabel>W praktyce</SectionLabel>
          <div style={{ fontSize: 13, color: C.textDim, marginTop: 10, lineHeight: 1.6 }}>{advice}</div>
        </>
      )}
    </Card>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820 }}>
      <Card>
        <div className="serif" style={{ fontSize: 32, fontStyle: 'italic', lineHeight: 1.1 }}>
          Ściąga — metryki treningu
        </div>
        <div style={{ fontSize: 14, color: C.textDim, marginTop: 10, lineHeight: 1.6 }}>
          Cztery liczby z modelu <span className="mono" style={{ color: C.lime }}>TrainingPeaks/Banister</span>. Standard w kolarstwie, biegu, triathlonie od lat 90.
          Wszystko co potrzebujesz, żeby zrozumieć liczby w aplikacji.
        </div>
      </Card>

      <MetricCard
        symbol="TSS"
        name="Training Stress Score"
        alias="Punktacja jednego treningu"
        color={C.lime}
        summary="Im trudniejszy i dłuższy trening, tym wyższy TSS. Skala skalibrowana tak, żeby 100 TSS odpowiadało jednej godzinie wysiłku na progu (FTP dla roweru, LTHR dla biegania)."
        formula="TSS ≈ godziny × (intensywność / próg)² × 100"
        scale={[
          { range: '< 50',   label: 'Krótki / łatwy trening' },
          { range: '50–100', label: 'Standardowa sesja Z2' },
          { range: '100–200', label: 'Solidny trening lub interwały' },
          { range: '200–300', label: 'Ciężki, długie wyjazdy', note: 'np. granfondo średnim tempem' },
          { range: '300+',   label: 'Bardzo ciężki, regeneracja 2–3 dni', color: C.amber },
        ]}
        advice="W PaceLab TSS liczy się z mocą (jeśli masz watt-metra) lub z tętna. Dla siłowni heurystyka ~70 TSS/h, dla manualnych możesz wpisać sam."
      />

      <MetricCard
        symbol="CTL"
        name="Chronic Training Load"
        alias="Fitness · długoterminowa kondycja"
        color={C.lime}
        summary="Eksponencjalna średnia Twoich TSS z ostatnich 42 dni. Mówi ile średnio trenujesz długoterminowo, czyli ile organizm jest przygotowany znosić obciążenie."
        formula="CTL_dziś = CTL_wczoraj + (TSS_dziś − CTL_wczoraj) / 42"
        scale={[
          { range: '40–60',   label: 'Początkujący amator' },
          { range: '60–90',   label: 'Regularny amator' },
          { range: '90–110',  label: 'Zaawansowany amator', color: C.lime },
          { range: '110+',    label: 'Wyczynowy', color: C.lime },
        ]}
        advice="Bezpieczne tempo wzrostu to ok. 5–7 punktów/tydzień. Szybciej = ryzyko kontuzji, przetrenowania. Spadek CTL w taperingu albo urlopie jest naturalny — 3–5 punktów/tydzień przy braku treningu."
      />

      <MetricCard
        symbol="ATL"
        name="Acute Training Load"
        alias="Zmęczenie · świeży tygodniowy ładunek"
        color={C.red}
        summary="Ta sama formuła co CTL ale na 7 dni zamiast 42. Pokazuje co Ci zostało po ostatnim tygodniu. Reaguje szybko — ciężki weekend podbije ATL o 15–25 punktów, tydzień luzu spuści tyle samo."
        formula="ATL_dziś = ATL_wczoraj + (TSS_dziś − ATL_wczoraj) / 7"
        advice="ATL samo w sobie niewiele mówi. Interesujące jest jego porównanie z CTL, czyli TSB poniżej."
      />

      <MetricCard
        symbol="TSB"
        name="Training Stress Balance"
        alias="Forma · najważniejsza metryka w praktyce"
        color={C.cyan}
        summary={'Mówi czy jesteś gotowy iść mocno, czy potrzebujesz odpocząć. „Ile organizm umie znieść (CTL)" minus „ile właśnie znosi (ATL)".'}
        formula="TSB = CTL − ATL"
        scale={[
          { range: '> +10',   label: 'Bardzo świeży',     color: C.cyan,  note: 'czas na start albo rekord' },
          { range: '+5 do +10', label: 'Wypoczęty',        color: C.cyan,  note: 'dobry moment na zawody' },
          { range: '−10 do +5', label: 'Optymalny',        color: C.lime,  note: '„w formie", solidne treningi' },
          { range: '−30 do −10', label: 'Zmęczony',        color: C.amber, note: 'normalne w bloku budowy' },
          { range: '< −30',     label: 'Czerwone światło', color: C.red,   note: 'ryzyko kontuzji, 3–5 łatwych dni' },
        ]}
        advice={'Klasyczny tapering: 1–2 tygodnie przed startem spuszczasz objętość. ATL spada szybko, CTL spada wolno, TSB rośnie do +10/+15. Tracisz minimum fitness, zyskasz świeżość. Pułapka: nie próbuj „nadrobić" 3 dni przed zawodami — ATL skacze, TSB zjeżdża, przychodzisz zmęczony.'}
      />

      <Card>
        <SectionLabel>Czego te metryki NIE mierzą</SectionLabel>
        <div style={{ fontSize: 13, color: C.textDim, marginTop: 10, lineHeight: 1.7 }}>
          Snu (zmęczenie z bezsenności nie pojawi się w ATL). Stresu życiowego (kłótnia z szefem nie podbije ATL). Jakości regeneracji (rolowanie, masaż). Odżywiania. Motywacji.
          <br/><br/>
          Dlatego dobry trener patrzy na liczby, ale zawsze pyta „jak się czujesz?" — bo nawet dobre TSB przegrywa z chorobą.
        </div>
      </Card>
    </div>
  );
}

function SettingsTab({ settings, setSettings, setActivities, setCoachHistory, setPlanOverrides }) {
  const [local, setLocal] = useState(settings);
  const [saved, setSaved] = useState(false);
  const theme = useTheme();

  useEffect(() => { setLocal(settings); }, [settings]);

  const apply = () => {
    setSettings(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const reset = async () => {
    if (!confirm('Skasować wszystkie dane (aktywności, ustawienia, historia coacha, override\'y planu)? Tego nie cofniesz.')) return;
    setActivities([]); setCoachHistory([]); setSettings(DEFAULT_SETTINGS); setLocal(DEFAULT_SETTINGS);
    if (setPlanOverrides) setPlanOverrides({});
    await window.storage.delete('pacelab:plan').catch(()=>{});
    await window.storage.delete('pacelab:analyses').catch(()=>{});
  };

  const exportData = async () => {
    const state = await loadState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `pacelab-backup-${isoDay(new Date())}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>Motyw</div>
            <div style={{ fontSize: 12, color: C.muted }}>
              Tryb ciemny domyślny — łatwiejsze dla oczu, lepsze na telefonie. Jasny dostępny opcjonalnie.
            </div>
          </div>
          <div style={{ display: 'inline-flex', gap: 4, padding: 3, background: C.surfaceAlt, borderRadius: 8, border: `1px solid ${C.border}` }}>
            {[{k:'dark',label:'Ciemny'},{k:'light',label:'Jasny'}].map(opt => {
              const active = theme.name === opt.k;
              return (
                <button
                  key={opt.k}
                  onClick={() => theme.set(opt.k)}
                  style={{
                    padding: '6px 14px', borderRadius: 6, border: 'none',
                    background: active ? C.surface : 'transparent',
                    color: active ? C.lime : C.textDim,
                    fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'all 0.15s',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>Strefy treningowe</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>
          Bez tego TSS będzie tylko szacunkiem. Wartości znajdziesz na Garminie albo na Intervals.icu.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Field label="FTP" sub="Functional Threshold Power (kolarstwo)" suffix="W">
            <Input type="number" value={local.ftp} onChange={e => setLocal({...local, ftp: +e.target.value || 0})} suffix="W" />
          </Field>
          <Field label="Progowe HR" sub="LT/anaerobic threshold (bieg)" suffix="bpm">
            <Input type="number" value={local.thresholdHR} onChange={e => setLocal({...local, thresholdHR: +e.target.value || 0})} suffix="bpm" />
          </Field>
          <Field label="Max HR" suffix="bpm">
            <Input type="number" value={local.maxHR} onChange={e => setLocal({...local, maxHR: +e.target.value || 0})} suffix="bpm" />
          </Field>
          <Field label="Waga" suffix="kg">
            <Input type="number" value={local.weight} onChange={e => setLocal({...local, weight: +e.target.value || 0})} suffix="kg" />
          </Field>
          <Field label="Tempo progowe (bieg)" sub="Pace progowe Threshold — M:SS/km">
            <Input
              type="text"
              value={(() => {
                const s = local.thresholdPace || 285;
                return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
              })()}
              onChange={e => {
                const m = e.target.value.match(/^(\d+):(\d{1,2})$/);
                if (m) setLocal({...local, thresholdPace: (+m[1])*60 + (+m[2])});
              }}
              suffix="/km"
              placeholder="4:45"
            />
          </Field>
          <Field label="CSS pływania" sub="Critical Swim Speed — M:SS/100m">
            <Input
              type="text"
              value={(() => {
                const s = local.swimCSS || 105;
                return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
              })()}
              onChange={e => {
                const m = e.target.value.match(/^(\d+):(\d{1,2})$/);
                if (m) setLocal({...local, swimCSS: (+m[1])*60 + (+m[2])});
              }}
              suffix="/100m"
              placeholder="1:45"
            />
          </Field>
        </div>
        <div style={{ marginTop: 20 }}>
          <Field label="Główny sport">
            <div style={{ display: 'flex', gap: 8 }}>
              {Object.entries(SPORT_META).filter(([k]) => k !== 'other').map(([k, m]) => {
                const Icon = m.icon;
                const active = local.primarySport === k;
                return (
                  <button key={k} onClick={() => setLocal({...local, primarySport: k})} style={{
                    flex: 1, padding: '10px 14px', borderRadius: 8,
                    background: active ? m.color + '15' : C.surfaceAlt,
                    border: `1px solid ${active ? m.color : C.border}`,
                    color: active ? m.color : C.textDim,
                    cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}>
                    <Icon size={14} /> {m.label}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      </Card>

      <Card>
        <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>Cel</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>
          Coach AI użyje tego do generowania planu.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Co planujesz?" sub={'np. „Maraton w Berlinie", „Granfondo 160 km", „Ironman 70.3"'}>
            <Input value={local.goalType} onChange={e => setLocal({...local, goalType: e.target.value})} placeholder="Twój cel..." />
          </Field>
          <Field label="Data celu">
            <Input type="date" value={local.goalDate} onChange={e => setLocal({...local, goalDate: e.target.value})} />
          </Field>
          <Field label="Notatki" sub="Cokolwiek istotnego: kontuzje, ograniczenia czasowe, preferencje">
            <textarea
              value={local.goalNotes}
              onChange={e => setLocal({...local, goalNotes: e.target.value})}
              rows={3}
              style={{
                width: '100%', background: C.surfaceAlt, border: `1px solid ${C.border}`,
                borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14,
                fontFamily: 'inherit', outline: 'none', resize: 'vertical',
              }}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>Profil sportowca</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
          Pełny kontekst dla Coach AI — historia, ograniczenia medyczne, plan trenera, struktura tygodnia.
          Wszystko co tu wpiszesz jest dołączane do każdej rozmowy z coachem.
        </div>
        <textarea
          value={local.profile || ''}
          onChange={e => setLocal({...local, profile: e.target.value})}
          rows={14}
          placeholder="Opisz swoją sytuację: cele, ograniczenia, historię, plan trenera, strukturę tygodnia..."
          style={{
            width: '100%', background: C.surfaceAlt, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: '12px 14px', color: C.text, fontSize: 13,
            lineHeight: 1.55, fontFamily: 'inherit', outline: 'none', resize: 'vertical',
          }}
        />
        <div className="mono" style={{ fontSize: 11, color: C.muted, marginTop: 8, textAlign: 'right' }}>
          {(local.profile || '').length} znaków
        </div>
      </Card>

      <Card>
        <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>Twarde reguły coachingu</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
          Konkretne nakazy/zakazy które Coach AI musi przestrzegać przy każdym planowaniu.
          Krótkie, jednoznaczne. Działają silniej niż opis w profilu — to są twarde ograniczenia.
        </div>
        <RulesEditor rules={local.rules || []} onChange={(rules) => setLocal({...local, rules})} />
      </Card>

      <Card>
        <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>Sprzęt domowy do siłowni</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
          Co masz lub planujesz mieć w domu. PaceLab dobierze warianty ćwiczeń pod Twój sprzęt — nie będzie proponować hantli których nie masz.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          {[
            { key: 'bands',          label: 'Gumy oporowe',         hint: 'Uniwersalne, ~50-100 zł' },
            { key: 'loadedBackpack', label: 'Plecak z obciążeniem', hint: 'Darmowy — woda + książki' },
            { key: 'dumbbells',      label: 'Hantle regulowane',    hint: '~200-400 zł' },
            { key: 'kettlebell',     label: 'Kettlebell',           hint: '16-24 kg, ~100-200 zł' },
            { key: 'pullupBar',      label: 'Drążek do drzwi',      hint: '~60-120 zł' },
            { key: 'matRoller',      label: 'Mata + roller',        hint: 'Do dekompresji L4-L5' },
          ].map(eq => {
            const active = local.homeEquipment?.[eq.key];
            return (
              <button
                key={eq.key}
                onClick={() => setLocal({
                  ...local,
                  homeEquipment: { ...(local.homeEquipment || {}), [eq.key]: !active },
                })}
                style={{
                  padding: 12, borderRadius: 8, textAlign: 'left',
                  background: active ? C.lime + '15' : C.surfaceAlt,
                  border: `1px solid ${active ? C.lime + '50' : C.border}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  transition: 'all 0.15s',
                }}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: 4,
                  background: active ? C.lime : 'transparent',
                  border: `1.5px solid ${active ? C.lime : C.borderAlt}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, marginTop: 1,
                }}>
                  {active && <Check size={11} color="#ffffff" strokeWidth={3} />}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: active ? C.text : C.textDim }}>{eq.label}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{eq.hint}</div>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Btn onClick={apply} variant="primary" icon={saved ? Check : undefined}>
          {saved ? 'Zapisano' : 'Zapisz zmiany'}
        </Btn>
        <Btn onClick={exportData} icon={Upload}>Eksport danych (JSON)</Btn>
        <div style={{ flex: 1 }} />
        <Btn onClick={reset} variant="danger" icon={Trash2}>Skasuj wszystko</Btn>
      </div>

      <Card style={{ background: C.surfaceAlt }}>
        <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>O aplikacji</div>
        <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.7 }}>
          PaceLab liczy TSS dwoma metodami: <span className="mono" style={{ color: C.lime }}>power-based</span> (gdy aktywność ma watty — używa FTP) oraz <span className="mono" style={{ color: C.lime }}>HR-based</span> (gdy nie ma — używa progowego HR). CTL/ATL liczone są jak w TrainingPeaks — eksponencjalne średnie ze stałymi czasowymi 42 i 7 dni.
          <br/><br/>
          Dane trzymane są lokalnie, nigdzie nie wychodzą. Coach AI dostaje podsumowanie Twojego treningu i pytanie — żeby działał potrzebne jest połączenie z Claude API.
        </div>
      </Card>
    </div>
  );
}

function Field({ label, sub, children }) {
  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

// ============================================================
// Header & Main App
// ============================================================
function Header({ tab, setTab, authUser, onLogout }) {
  const tabs = [
    { id: 'dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
    { id: 'activities', label: 'Aktywności', icon: FileText },
    { id: 'coach',      label: 'Coach AI',   icon: Sparkles },
    { id: 'plan',       label: 'Plan',       icon: Target },
    { id: 'journal',    label: 'Dziennik',   icon: MessageSquare },
    { id: 'recovery',   label: 'Regeneracja', icon: Activity },
    { id: 'glossary',   label: 'Wiedza',     icon: BookOpen },
    { id: 'settings',   label: 'Ustawienia', icon: SettingsIcon },
  ];
  const [isNarrow, setIsNarrow] = useState(typeof window !== 'undefined' ? window.innerWidth < 720 : false);
  useEffect(() => {
    const onR = () => setIsNarrow(window.innerWidth < 720);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  return (
    <header style={{
      borderBottom: `1px solid ${C.border}`, background: C.bg,
      position: 'sticky', top: 0, zIndex: 50,
    }}>
      <div style={{
        maxWidth: 1280, margin: '0 auto',
        padding: isNarrow ? '14px 16px' : '20px 24px',
        display: 'flex', alignItems: 'center', gap: isNarrow ? 12 : 40, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: C.lime, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 12px ${C.lime}40` }}>
            <Zap size={18} color={C.bg} strokeWidth={2.5} />
          </div>
          <div>
            <div style={{ fontSize: isNarrow ? 16 : 18, fontWeight: 600, letterSpacing: '-0.02em' }}>PaceLab</div>
            {!isNarrow && <div className="mono" style={{ fontSize: 10, color: C.muted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Endurance · Personal</div>}
          </div>
        </div>
        <nav style={{
          display: 'flex', gap: isNarrow ? 2 : 4,
          marginLeft: isNarrow ? 0 : 'auto',
          flex: isNarrow ? '1 1 100%' : '0 1 auto',
          overflowX: isNarrow ? 'auto' : 'visible',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: isNarrow ? 2 : 0,
        }}>
          {tabs.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: isNarrow ? '8px 10px' : '8px 14px', borderRadius: 8, border: 'none',
                background: active ? C.surfaceAlt : 'transparent',
                color: active ? C.lime : C.textDim,
                fontSize: 13, fontWeight: 500, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: isNarrow ? 0 : 8,
                fontFamily: 'inherit', transition: 'all 0.15s',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                <Icon size={14} /> {!isNarrow && t.label}
              </button>
            );
          })}
        </nav>
        {authUser && !isNarrow && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 12, borderLeft: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, color: C.muted, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={authUser.email}>
              {authUser.email}
            </div>
            <button
              onClick={onLogout}
              title="Wyloguj"
              style={{
                background: 'transparent', border: `1px solid ${C.border}`, color: C.muted,
                cursor: 'pointer', padding: '6px 8px', borderRadius: 6, fontFamily: 'inherit',
                display: 'inline-flex', alignItems: 'center', transition: 'all 0.15s',
              }}
            >
              <LogOut size={13} />
            </button>
          </div>
        )}
        {authUser && isNarrow && (
          <button onClick={onLogout} title="Wyloguj" style={{
            background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 4, marginLeft: 'auto',
          }}>
            <LogOut size={14} />
          </button>
        )}
      </div>
    </header>
  );
}

const RECOVERY_TYPES = {
  physio:     { label: 'Fizjoterapia', icon: '🩺', color: '#ff4d9a' },
  rolling:    { label: 'Rolowanie',    icon: '🟦', color: '#33d9ff' },
  massage:    { label: 'Masaż',        icon: '💆', color: '#a3ff3a' },
  stretching: { label: 'Stretching',   icon: '🧘', color: '#ffba2e' },
  sauna:      { label: 'Sauna / zimno', icon: '🔥', color: '#ff5547' },
};

function RecoveryModal({ entry, onSave, onClose }) {
  const [date, setDate] = useState(entry?.date || isoDay(new Date()));
  const [type, setType] = useState(entry?.type || 'rolling');
  const [areas, setAreas] = useState(entry?.areas || '');
  const [notes, setNotes] = useState(entry?.notes || '');
  const [durationMin, setDurationMin] = useState(entry?.durationMin || '');

  const save = () => {
    onSave({
      id: entry?.id || Date.now(),
      date, type, areas: areas.trim(), notes: notes.trim(),
      durationMin: durationMin === '' ? null : Number(durationMin),
    });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <Card style={{ width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }} >
        <div onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{entry ? 'Edytuj wpis' : 'Nowy wpis regeneracji'}</div>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer' }}><X size={18} /></button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <SectionLabel>Typ</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 6, marginTop: 6 }}>
                {Object.entries(RECOVERY_TYPES).map(([k, v]) => (
                  <button key={k} onClick={() => setType(k)} style={{
                    padding: '10px 6px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                    background: type === k ? v.color + '22' : 'transparent',
                    border: `1px solid ${type === k ? v.color : C.border}`,
                    color: type === k ? v.color : C.textDim, fontSize: 12, fontWeight: 500,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  }}>
                    <span style={{ fontSize: 18 }}>{v.icon}</span>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <SectionLabel>Data</SectionLabel>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <SectionLabel>Czas trwania</SectionLabel>
                <Input type="number" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} placeholder="min" suffix="min" />
              </div>
            </div>

            <div>
              <SectionLabel>Obszary ciała</SectionLabel>
              <Input type="text" value={areas} onChange={(e) => setAreas(e.target.value)}
                placeholder="np. odcinek L4-L5, prawe kolano, łydki" />
            </div>

            <div>
              <SectionLabel>Co zostało zrobione / zalecenia</SectionLabel>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
                placeholder="np. mobilizacja odcinka lędźwiowego, terapia manualna prawego kolana. Fizjo zalecił 3 dni bez biegania, dozwolony rower Z2."
                style={{ width: '100%', background: C.surfaceAlt, border: `1px solid ${C.border}`,
                  borderRadius: 8, padding: '10px 12px', color: C.text, fontSize: 14,
                  fontFamily: 'inherit', outline: 'none', resize: 'vertical', marginTop: 6, lineHeight: 1.5 }} />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <Btn variant="ghost" onClick={onClose}>Anuluj</Btn>
              <Btn variant="primary" onClick={save}>Zapisz</Btn>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Recovery({ recovery, setRecovery }) {
  const [modal, setModal] = useState(null); // null | {} | entry

  const sorted = useMemo(() =>
    [...(recovery || [])].sort((a, b) => new Date(b.date) - new Date(a.date)),
  [recovery]);

  const save = (entry) => {
    setRecovery(prev => {
      const exists = (prev || []).some(e => e.id === entry.id);
      if (exists) return prev.map(e => e.id === entry.id ? entry : e);
      return [...(prev || []), entry];
    });
    setModal(null);
  };

  const remove = (id) => {
    if (!confirm('Usunąć ten wpis?')) return;
    setRecovery(prev => (prev || []).filter(e => e.id !== id));
  };

  // Stats
  const now = new Date();
  const last30 = sorted.filter(e => (now - new Date(e.date)) / 86400000 <= 30);
  const physioCount = last30.filter(e => e.type === 'physio').length;
  const rollingCount = last30.filter(e => e.type === 'rolling').length;
  const lastPhysio = sorted.find(e => e.type === 'physio');
  const daysSincePhysio = lastPhysio ? Math.floor((now - new Date(lastPhysio.date)) / 86400000) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>Regeneracja</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
            Fizjoterapia, rolowanie, stretching. AI uwzględnia te wpisy w planowaniu treningów.
          </div>
        </div>
        <Btn variant="primary" icon={Plus} onClick={() => setModal({})}>Dodaj wpis</Btn>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <KPI label="Fizjo (30 dni)" value={physioCount} sub={daysSincePhysio !== null ? `ostatnia ${daysSincePhysio} dni temu` : 'brak wpisów'} accent={C.pink} />
        <KPI label="Rolowanie (30 dni)" value={rollingCount} sub="sesje" accent={C.cyan} />
        <KPI label="Wszystkie (30 dni)" value={last30.length} sub="sesje regeneracji" accent={C.lime} />
      </div>

      <Card>
        <SectionLabel>Historia</SectionLabel>
        {sorted.length === 0 ? (
          <div style={{ color: C.muted, textAlign: 'center', padding: 32, fontSize: 13 }}>
            Brak wpisów. Dodaj wizytę u fizjo lub sesję rolowania.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {sorted.map(e => {
              const meta = RECOVERY_TYPES[e.type] || RECOVERY_TYPES.rolling;
              return (
                <div key={e.id} style={{
                  display: 'flex', gap: 12, padding: '12px 14px', background: C.surfaceAlt,
                  borderRadius: 10, borderLeft: `3px solid ${meta.color}`, alignItems: 'flex-start',
                }}>
                  <div style={{ fontSize: 20 }}>{meta.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: meta.color }}>{meta.label}</span>
                      <span className="mono" style={{ fontSize: 11, color: C.muted }}>{fmtDateFull(e.date)}</span>
                      {e.durationMin && <span className="mono" style={{ fontSize: 11, color: C.muted }}>· {e.durationMin} min</span>}
                    </div>
                    {e.areas && <div style={{ fontSize: 13, color: C.textDim, marginTop: 4 }}><strong>Obszary:</strong> {e.areas}</div>}
                    {e.notes && <div style={{ fontSize: 13, color: C.textDim, marginTop: 4, lineHeight: 1.5 }}>{e.notes}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => setModal(e)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 4 }}><Edit2 size={13} /></button>
                    <button onClick={() => remove(e.id)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 4 }}><Trash2 size={13} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {modal !== null && (
        <RecoveryModal
          entry={modal && modal.id ? modal : null}
          onSave={save}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function App({ authUser }) {
  const [activities, setActivities] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [coachHistory, setCoachHistory] = useState([]);
  const [planOverrides, setPlanOverrides] = useState({});
  const [journal, setJournal] = useState([]);
  const [recovery, setRecovery] = useState([]);
  const [tab, setTab] = useState('dashboard');
  const [loaded, setLoaded] = useState(false);
  const [importStatus, setImportStatus] = useState(null);
  const [globalManualModal, setGlobalManualModal] = useState(null);
  const [voiceModal, setVoiceModal] = useState(null); // { activity?, unit? } or null

  useEffect(() => {
    (async () => {
      const s = await loadState();
      if (s) {
        if (s.activities) setActivities(s.activities);
        if (s.settings) setSettings({ ...DEFAULT_SETTINGS, ...s.settings });
        if (s.coachHistory) setCoachHistory(s.coachHistory);
        if (s.planOverrides) setPlanOverrides(s.planOverrides);
        if (s.journal) setJournal(s.journal);
        if (s.recovery) setRecovery(s.recovery);
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    saveState({ activities, settings, coachHistory, planOverrides, journal, recovery });
  }, [activities, settings, coachHistory, planOverrides, journal, recovery, loaded]);

  useEffect(() => {
    if (!loaded || activities.length === 0) return;
    setActivities(prev => prev.map(a => ({ ...a, tss: computeTSS(a, settings) })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.ftp, settings.thresholdHR, loaded]);

  const pmcData = useMemo(() => computePMC(activities, 90), [activities]);
  const today = pmcData[pmcData.length - 1] || { ctl: 0, atl: 0, tsb: 0 };

  const todayPlanUnit = useMemo(() => {
    if (!settings.goalDate) return null;
    const units = buildPlanUnits(settings.goalDate);
    const todayStr = isoDay(new Date());
    const matched = matchPlanToActivities(units, activities, todayStr, planOverrides || {});
    return matched.find(u => u.date === todayStr) || null;
  }, [settings.goalDate, activities, planOverrides]);

  const markStrengthDone = (unit) => {
    const sportLabel = unit.strength || 'Siłownia';
    const newAct = makeManualActivity({
      date: unit.date,
      sport: 'strength',
      durationMin: 25,
      distanceKm: '',
      avgHR: '',
      tss: 30,
      name: sportLabel,
    });
    newAct.tss = 30;
    setActivities(prev => [...prev, newAct].sort((a, b) => new Date(b.date) - new Date(a.date)));
  };

  const saveGlobalManual = (act) => {
    setActivities(prev => [...prev, act].sort((a, b) => new Date(b.date) - new Date(a.date)));
    setGlobalManualModal(null);
  };

  const saveJournalEntry = (entry, newRules) => {
    setJournal(prev => [...(prev || []), entry]);
    if (newRules && newRules.length > 0) {
      setSettings(prev => ({
        ...prev,
        rules: [...(prev.rules || []), ...newRules],
      }));
    }
  };

  const handleFiles = async (files) => {
    setImportStatus({ type: 'loading', msg: `Wczytuję ${files.length} plik(ów)...` });
    const newActs = []; let errors = 0;
    for (const f of files) {
      try {
        const text = await f.text();
        let p = [];
        if (f.name.toLowerCase().endsWith('.tcx')) p = parseTCX(text);
        else if (f.name.toLowerCase().endsWith('.gpx')) p = parseGPX(text);
        else if (f.name.toLowerCase().endsWith('.csv')) p = parseGarminCSV(text);
        else { errors++; continue; }
        p.forEach(a => {
          a.tss = computeTSS(a, settings);
          if (!a.name) a.name = `${SPORT_META[a.sport].label} · ${fmtDateFull(a.date)}`;
        });
        newActs.push(...p);
      } catch (e) { errors++; }
    }
    setActivities(prev => {
      const existing = new Set(prev.map(a => a.id));
      const fresh = newActs.filter(a => !existing.has(a.id));
      return [...prev, ...fresh].sort((a,b) => new Date(b.date) - new Date(a.date));
    });
    setImportStatus({
      type: errors ? 'partial' : 'success',
      msg: `Dodano ${newActs.length} aktywności${errors ? ` (${errors} plików nieudane)` : ''}.`,
    });
    setTimeout(() => setImportStatus(null), 4000);
  };

  if (!loaded) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontFamily: 'Geist, system-ui, sans-serif' }}>
        <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: 'Geist, system-ui, sans-serif' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap');
        body { background: ${C.bg}; margin: 0; }
        * { box-sizing: border-box; }
        .mono { font-family: 'Geist Mono', ui-monospace, monospace; font-feature-settings: 'tnum' on; }
        .serif { font-family: 'Instrument Serif', serif; }
        .scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .scroll::-webkit-scrollbar-track { background: ${C.surface}; }
        .scroll::-webkit-scrollbar-thumb { background: ${C.borderAlt}; border-radius: 3px; }
        .hoverable:hover { background: ${C.surfaceHi} !important; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
        input:focus, textarea:focus { border-color: ${C.lime} !important; }
        button:hover:not(:disabled) { filter: brightness(1.1); }
      `}</style>

      <Header
        tab={tab}
        setTab={setTab}
        authUser={authUser}
        onLogout={async () => {
          if (!supabase) return;
          if (!confirm('Wylogować się?')) return;
          await supabase.auth.signOut();
          setCachedAuthUser(null);
          // AppRoot's onAuthStateChange will handle re-rendering AuthScreen
        }}
      />

      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 24px 80px' }}>
        {globalManualModal && (
          <WorkoutFormModal
            onClose={() => setGlobalManualModal(null)}
            onSave={saveGlobalManual}
            settings={settings}
            defaultDate={globalManualModal.date}
          />
        )}
        {voiceModal && (
          <VoiceJournalModal
            onClose={() => setVoiceModal(null)}
            onSave={saveJournalEntry}
            activity={voiceModal.activity}
            unit={voiceModal.unit}
            settings={settings}
            activities={activities}
            pmcData={pmcData}
            planOverrides={planOverrides}
            setPlanOverrides={setPlanOverrides}
            recovery={recovery}
          />
        )}
        {tab === 'dashboard'  && <Dashboard activities={activities} pmcData={pmcData} today={today} settings={settings} onImport={handleFiles} importStatus={importStatus} todayPlanUnit={todayPlanUnit} onSkip={(date, note) => setPlanOverrides({...(planOverrides||{}), [date]: {action:'skip', note: note||'', ts: new Date().toISOString()}})} onUnskip={(date) => { const n = {...(planOverrides||{})}; delete n[date]; setPlanOverrides(n); }} onMarkStrength={markStrengthDone} onAddManual={(date) => setGlobalManualModal({ date })} onOpenVoice={(opts) => { setVoiceModal(opts || {}); }} />}
        {tab === 'activities' && <Activities activities={activities} setActivities={setActivities} pmcData={pmcData} settings={settings} recovery={recovery} />}
        {tab === 'coach'      && <Coach activities={activities} pmcData={pmcData} settings={settings} history={coachHistory} setHistory={setCoachHistory} recovery={recovery} />}
        {tab === 'plan'       && <Plan activities={activities} pmcData={pmcData} settings={settings} setSettings={setSettings} planOverrides={planOverrides} setPlanOverrides={setPlanOverrides} recovery={recovery} />}
        {tab === 'journal'    && <Journal journal={journal} setJournal={setJournal} onOpenNew={() => setVoiceModal({})} activities={activities} />}
        {tab === 'recovery'   && <Recovery recovery={recovery} setRecovery={setRecovery} />}
        {tab === 'glossary'   && <Glossary />}
        {tab === 'settings'   && <SettingsTab settings={settings} setSettings={setSettings} setActivities={setActivities} setCoachHistory={setCoachHistory} setPlanOverrides={setPlanOverrides} />}
      </main>
    </div>
  );
}

// ============================================================
// AUTH + MIGRATION (Supabase backend integration)
// ============================================================

function LoadingScreen({ message }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 16, background: C.bg,
    }}>
      <Loader2 size={32} className="animate-spin" color={C.muted} />
      {message && <div style={{ fontSize: 13, color: C.muted }}>{message}</div>}
    </div>
  );
}

function AuthScreen({ onSuccess }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  const handleSubmit = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!email || !password) { setError('Wpisz email i hasło'); return; }
    setLoading(true); setError(null); setInfo(null);
    try {
      if (mode === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user) onSuccess(data.user);
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user && data.session) {
          onSuccess(data.user);
        } else {
          setInfo('Konto utworzone. Możesz się teraz zalogować.');
          setMode('login');
        }
      }
    } catch (e) {
      const msg = e.message || 'Nieznany błąd';
      const polishMsg =
        /invalid login credentials/i.test(msg) ? 'Nieprawidłowy email lub hasło' :
        /email.*confirmation/i.test(msg)       ? 'Sprawdź skrzynkę — wysłaliśmy link aktywacyjny' :
        /password.*should be at least/i.test(msg) ? 'Hasło musi mieć minimum 6 znaków' :
        /signup.*disabled/i.test(msg)          ? 'Rejestracja zamknięta' :
        msg;
      setError(polishMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: C.bg, padding: 20,
    }}>
      <Card style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div className="serif" style={{ fontSize: 32, color: C.text, marginBottom: 4, lineHeight: 1 }}>PaceLab</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 8 }}>
            {mode === 'login' ? 'Zaloguj się żeby kontynuować' : 'Załóż konto'}
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <SectionLabel>Email</SectionLabel>
            <Input
              type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ty@example.com" autoComplete="email"
            />
          </div>
          <div>
            <SectionLabel>Hasło</SectionLabel>
            <Input
              type="password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'Minimum 6 znaków' : '••••••••'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            />
          </div>

          {error && (
            <div style={{
              padding: '10px 12px', background: C.red + '15', color: C.red,
              borderRadius: 8, fontSize: 12, border: `1px solid ${C.red}30`,
            }}>{error}</div>
          )}

          {info && (
            <div style={{
              padding: '10px 12px', background: C.lime + '15', color: C.lime,
              borderRadius: 8, fontSize: 12, border: `1px solid ${C.lime}30`,
            }}>{info}</div>
          )}

          <Btn
            variant="primary" onClick={handleSubmit} disabled={loading}
            style={{ justifyContent: 'center', padding: '10px 14px', marginTop: 4 }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            {loading ? 'Czekaj...' : mode === 'login' ? 'Zaloguj się' : 'Załóż konto'}
          </Btn>
        </form>

        <div style={{
          marginTop: 18, paddingTop: 18, borderTop: `1px solid ${C.border}`,
          textAlign: 'center', fontSize: 12, color: C.muted,
        }}>
          {mode === 'login' ? (
            <span>Nie masz jeszcze konta?{' '}
              <button onClick={() => { setMode('signup'); setError(null); setInfo(null); }} style={{
                background: 'transparent', border: 'none', color: C.cyan, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 12, padding: 0, textDecoration: 'underline',
              }}>Zarejestruj się</button>
            </span>
          ) : (
            <span>Masz już konto?{' '}
              <button onClick={() => { setMode('login'); setError(null); setInfo(null); }} style={{
                background: 'transparent', border: 'none', color: C.cyan, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 12, padding: 0, textDecoration: 'underline',
              }}>Zaloguj się</button>
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}

function MigrationPrompt({ user, onDone }) {
  const [info, setInfo] = useState(null);
  const [migrating, setMigrating] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let activityCount = 0;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('pacelab:') && k !== 'pacelab-auth') keys.push(k);
    }
    try {
      const main = localStorage.getItem('pacelab:v1');
      if (main) {
        const parsed = JSON.parse(main);
        activityCount = parsed.activities?.length || 0;
      }
    } catch {}
    setInfo({ keys, activityCount });
  }, []);

  const handleMigrate = async () => {
    setMigrating(true); setError(null);
    try {
      const rows = [];
      for (const key of info.keys) {
        const raw = localStorage.getItem(key);
        if (raw === null) continue;
        let value;
        try { value = JSON.parse(raw); } catch { value = raw; }
        rows.push({ user_id: user.id, key, value, updated_at: new Date().toISOString() });
      }
      if (rows.length > 0) {
        const { error: err } = await supabase.from('kv_store').upsert(rows, { onConflict: 'user_id,key' });
        if (err) throw err;
      }
      setDone(true);
    } catch (e) {
      setError(e.message || 'Błąd migracji');
    } finally {
      setMigrating(false);
    }
  };

  if (!info) return <LoadingScreen message="Sprawdzam dane lokalne..." />;

  if (done) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, padding: 20 }}>
      <Card style={{ maxWidth: 400, textAlign: 'center' }}>
        <div style={{ fontSize: 36, color: C.lime, marginBottom: 8 }}>✓</div>
        <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>Migracja zakończona</div>
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 20, lineHeight: 1.6 }}>
          Twoje dane są w chmurze. Dostępne z każdego urządzenia po zalogowaniu.
        </div>
        <Btn variant="primary" onClick={onDone} style={{ padding: '10px 20px' }}>Otwórz PaceLab</Btn>
      </Card>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg, padding: 20 }}>
      <Card style={{ maxWidth: 480 }}>
        <div className="serif" style={{ fontSize: 24, marginBottom: 8 }}>Wykryto lokalne dane</div>
        <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6, marginBottom: 20 }}>
          Twoja przeglądarka ma {info.activityCount > 0 ? <strong>{info.activityCount} aktywności</strong> : <strong>dane PaceLab</strong>} zapisanych lokalnie.
          Chcesz przenieść je do chmury żeby były dostępne na innych urządzeniach?
        </div>

        {error && (
          <div style={{ padding: '10px 12px', background: C.red + '15', color: C.red, borderRadius: 8, fontSize: 12, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Btn variant="ghost" onClick={onDone} disabled={migrating}>Pomiń, zacznij od zera</Btn>
          <Btn variant="primary" onClick={handleMigrate} disabled={migrating}>
            {migrating ? <Loader2 size={14} className="animate-spin" /> : null}
            {migrating ? 'Przenoszę...' : 'Tak, przenieś'}
          </Btn>
        </div>
      </Card>
    </div>
  );
}

export default function AppRoot() {
  // Subscribe to theme so the whole tree re-renders on toggle
  useTheme();

  const [authChecked, setAuthChecked] = useState(!isSupabaseEnabled);
  const [authUser, setAuthUser] = useState(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [migrationChecked, setMigrationChecked] = useState(!isSupabaseEnabled);

  useEffect(() => {
    if (!isSupabaseEnabled) return;

    const checkMigration = async (user) => {
      try {
        const { data } = await supabase.from('kv_store').select('key').eq('user_id', user.id).limit(1);
        const hasCloudData = data && data.length > 0;
        let hasLocalData = false;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('pacelab:') && k !== 'pacelab-auth') { hasLocalData = true; break; }
        }
        setNeedsMigration(!hasCloudData && hasLocalData);
      } catch (e) {
        console.warn('Migration check failed:', e);
      } finally {
        setMigrationChecked(true);
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      const u = data?.session?.user || null;
      setCachedAuthUser(u);
      setAuthUser(u);
      setAuthChecked(true);
      if (u) checkMigration(u);
      else setMigrationChecked(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user || null;
      setCachedAuthUser(u);
      setAuthUser(u);
      if (event === 'SIGNED_IN' && u) {
        setMigrationChecked(false);
        checkMigration(u);
      } else if (event === 'SIGNED_OUT') {
        setNeedsMigration(false);
        setMigrationChecked(true);
      }
    });

    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  if (!authChecked) return <LoadingScreen message="Sprawdzam sesję..." />;
  if (isSupabaseEnabled && !authUser) return <AuthScreen onSuccess={(u) => { setCachedAuthUser(u); setAuthUser(u); }} />;
  if (!migrationChecked) return <LoadingScreen message="Sprawdzam dane..." />;
  if (needsMigration) return <MigrationPrompt user={authUser} onDone={() => setNeedsMigration(false)} />;

  return <App authUser={authUser} />;
}
