'use strict';

// ── Config ──────────────────────────────────────────────────────────────────
// Resolution order:
//   1. localhost / 127.0.0.1   → local BFF on port 9000
//   2. production              → bff.outdoordx.net
const BFF_URL = (function () {
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') {
    return 'http://localhost:9000/stream';
  }
  return 'https://bff.outdoordx.net/stream';
})();

const READY_URL = (function () {
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') {
    return 'http://localhost:9000/ready';
  }
  return 'https://bff.outdoordx.net/ready';
})();

// ── State ───────────────────────────────────────────────────────────────────
const spots = new Map();   // winnerId → winner spot (rendered rows)
const spotBuckets = new Map(); // dedupeKey → Map(rawSpotId → raw spot)
const spotKeyById = new Map(); // rawSpotId → dedupeKey
const spotWinnerByKey = new Map(); // dedupeKey → winnerId

const filters = {
  sources:    new Set(['DXPED', 'IOTA', 'POTA', 'SOTA', 'WWFF', 'WWBOTA']),
  modes:      new Set(['cw', 'ssb', 'digi', 'other']),
  continents: new Set(['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA', 'UNK']),
  band:       '',
  showQrt:    false,
};

const tableState = {
  sortBy:  'time',
  sortDir: 'desc',
  search: {
    activator: '',
    reference: '',
    name:      '',
  },
};

let usersSessionsOnline = '0/0';

// localStorage keys — bump the suffix (v1 → v2) to force a clean slate on all clients
// when the stored shape changes and the old data would be misread.
const FLAG_CACHE_KEY = 'odx:flag_cc_v1';
const UI_STATE_KEY   = 'odx:ui_state_v1';

// Callsign → ISO-2 country code, persisted so the flag lookup survives page reloads
// without re-resolving every activator on the next `init` event.
const flagCache = (function loadFlagCache() {
  try { return JSON.parse(localStorage.getItem(FLAG_CACHE_KEY) || '{}') || {}; }
  catch { return {}; }
})();

// ── DOM refs ─────────────────────────────────────────────────────────────────
const tbody      = document.getElementById('spots-body');
const emptyRow   = document.getElementById('empty-row');
const connDot    = document.getElementById('conn-dot');
const connLabel  = document.getElementById('conn-label');
const statsBar   = document.getElementById('stats-bar');
const sortHeads  = document.querySelectorAll('.head-main th.sortable');
const SEARCH_COLS = ['activator', 'reference', 'name'];
const SORT_COLS = new Set(['time', 'source', 'band', 'frequency', 'mode', 'activator', 'reference']);

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatFreq(hz) {
  if (hz == null) return '—';
  if (hz >= 1_000_000_000) {
    return (hz / 1_000_000_000).toLocaleString('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 5 }) + ' GHz';
  }
  return (hz / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + ' MHz';
}

function formatTime(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return d.toISOString().slice(11, 16);   // "HH:MM"
  } catch {
    return '—';
  }
}

function sourceClass(source) {
  return (source || '').toLowerCase();
}

function saveFlagCache() {
  try { localStorage.setItem(FLAG_CACHE_KEY, JSON.stringify(flagCache)); }
  catch { /* ignore quota/private mode errors */ }
}

function saveUiState() {
  try {
    localStorage.setItem(UI_STATE_KEY, JSON.stringify({
      filters: {
        sources:    [...filters.sources],
        modes:      [...filters.modes],
        continents: [...filters.continents],
        band:       filters.band,
        showQrt:    filters.showQrt,
      },
      table: {
        sortBy:  tableState.sortBy,
        sortDir: tableState.sortDir,
        search:  { ...tableState.search },
      },
    }));
  } catch {
    /* ignore quota/private mode errors */
  }
}

function loadUiState() {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Restores filter/sort/search values into both the in-memory state objects
// AND the corresponding DOM controls so they stay in sync after a page reload.
function applyUiState(state) {
  if (!state || typeof state !== 'object') return;

  const f = state.filters || {};
  const t = state.table || {};

  if (Array.isArray(f.sources) && f.sources.length) {
    filters.sources.clear();
    f.sources.forEach(v => filters.sources.add(v));
  }
  if (Array.isArray(f.modes) && f.modes.length) {
    filters.modes.clear();
    f.modes.forEach(v => filters.modes.add(v));
  }
  if (Array.isArray(f.continents) && f.continents.length) {
    filters.continents.clear();
    f.continents.forEach(v => filters.continents.add(v));
  }
  if (typeof f.band === 'string') filters.band = f.band;
  if (typeof f.showQrt === 'boolean') filters.showQrt = f.showQrt;

  if (typeof t.sortBy === 'string' && SORT_COLS.has(t.sortBy)) tableState.sortBy = t.sortBy;
  if (t.sortDir === 'asc' || t.sortDir === 'desc') tableState.sortDir = t.sortDir;

  SEARCH_COLS.forEach(col => {
    const v = t.search && typeof t.search[col] === 'string' ? t.search[col] : '';
    tableState.search[col] = normText(v.trim());
  });

  ['filter-source', 'filter-mode', 'filter-continent'].forEach(id => {
    const set = id === 'filter-source'    ? filters.sources
              : id === 'filter-mode'      ? filters.modes
              :                             filters.continents;
    document.getElementById(id).querySelectorAll('.toggle').forEach(btn => {
      btn.classList.toggle('active', set.has(btn.dataset.value));
    });
  });

  document.getElementById('filter-band').value = filters.band;
  document.getElementById('filter-qrt').checked = filters.showQrt;
  SEARCH_COLS.forEach(col => {
    document.getElementById(`search-${col}`).value = tableState.search[col];
  });
  updateSortHeaderUi();
}

// For portable callsigns like YU/OK1WED/P the first segment is the DXCC prefix.
// For home callsigns like F4JKY/P the first segment is the callsign itself.
function callsignBase(cs) {
  return String(cs || '').toUpperCase().split('/')[0];
}

function normCountryName(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Retired ISO 3166-1 codes that cause collisions with current ones.
const DEPRECATED_ISO_CODES = new Set(['AN', 'BU', 'CS', 'DD', 'FX', 'NT', 'SU', 'TP', 'YU', 'ZR']);

// Builds a name → ISO-2 index by brute-forcing all AA–ZZ combinations through
// Intl.DisplayNames. Intl returns the code itself (e.g. "ZZ") for unassigned
// codes, so those are filtered out. First match wins to avoid overwriting a
// valid code with a later collision.
function buildIsoNameIndex() {
  const out = {};
  const dn = new Intl.DisplayNames(['en'], { type: 'region' });
  for (let i = 65; i <= 90; i++) {
    for (let j = 65; j <= 90; j++) {
      const code = String.fromCharCode(i) + String.fromCharCode(j);
      if (DEPRECATED_ISO_CODES.has(code)) continue;
      const name = dn.of(code);
      if (!name || name === code) continue;
      const key = normCountryName(name);
      if (!out[key]) out[key] = code.toLowerCase();
    }
  }
  return out;
}

const isoNameIndex = buildIsoNameIndex();

// DXCC entities whose names differ from any ISO country name (sub-national
// regions, historical territories, islands with their own DXCC entity, etc.).
const dxccNameAliases = {
  'england': 'gb',
  'scotland': 'gb',
  'wales': 'gb',
  'northern ireland': 'gb',
  'canary islands': 'es',
  'balearic islands': 'es',
  'azores': 'pt',
  'madeira islands': 'pt',
  'sardinia': 'it',
  'sicily': 'it',
  'hawaii': 'us',
  'alaska': 'us',
  'guam': 'gu',
  'puerto rico': 'pr',
  'faroe islands': 'fo',
  'martinique': 'mq',
  'guadeloupe': 'gp',
  'french guiana': 'gf',
  'new caledonia': 'nc',
  'greenland': 'gl',
  'yugoslavia': 'rs',
  'serbia and montenegro': 'rs',
  'czech republic': 'cz',
  'rodriguez i':    'mu',   // "Rodriguez I." → Rodrigues Island, part of Mauritius
  'rodrigues island': 'mu',
  'bonaire': 'bq',
  'western kiribati': 'ki',
  'central kiribati': 'ki',
  'eastern kiribati': 'ki',
  'banaba island': 'ki',
};

// Longer prefixes must appear before any shorter prefix they start with
// (e.g. 'KH6' before 'K'), otherwise the shorter one matches first.
const callsignPrefixMap = [
  ['K', 'us'], ['N', 'us'], ['W', 'us'], ['AA', 'us'], ['AB', 'us'], ['AC', 'us'], ['AD', 'us'], ['AE', 'us'], ['AF', 'us'], ['AG', 'us'], ['AI', 'us'], ['AJ', 'us'], ['AK', 'us'], ['AL', 'us'], ['KM', 'us'], ['KH6', 'us'],
  ['VE', 'ca'], ['VA', 'ca'], ['VO', 'ca'], ['VY', 'ca'],
  ['EA', 'es'], ['EB', 'es'], ['EC', 'es'], ['ED', 'es'],
  ['CT', 'pt'], ['CQ', 'pt'],
  ['F', 'fr'], ['TM', 'fr'],
  ['DL', 'de'], ['DA', 'de'], ['DB', 'de'], ['DC', 'de'], ['DD', 'de'], ['DF', 'de'], ['DG', 'de'], ['DH', 'de'], ['DJ', 'de'], ['DK', 'de'], ['DM', 'de'], ['DN', 'de'], ['DO', 'de'], ['DP', 'de'], ['DR', 'de'],
  ['I', 'it'], ['IS', 'it'], ['IU', 'it'], ['IK', 'it'], ['IZ', 'it'],
  ['G', 'gb'], ['M', 'gb'], ['2E', 'gb'], ['GM', 'gb'], ['GW', 'gb'], ['GI', 'gb'], ['MM', 'gb'],
  ['JA', 'jp'], ['JE', 'jp'], ['JF', 'jp'], ['JG', 'jp'], ['JH', 'jp'], ['JI', 'jp'], ['JJ', 'jp'], ['JK', 'jp'], ['JL', 'jp'], ['JM', 'jp'], ['JN', 'jp'], ['JO', 'jp'], ['JR', 'jp'], ['JS', 'jp'], ['7J', 'jp'], ['7K', 'jp'],
  ['VK', 'au'], ['AX', 'au'],
  ['ZL', 'nz'],
  ['PY', 'br'], ['PP', 'br'], ['PQ', 'br'], ['PR', 'br'], ['PS', 'br'], ['PT', 'br'], ['PU', 'br'],
  ['LU', 'ar'], ['LW', 'ar'], ['CX', 'uy'], ['CE', 'cl'],
  ['PJ4', 'bq'],
  ['PA', 'nl'], ['PB', 'nl'], ['PC', 'nl'], ['PD', 'nl'], ['PE', 'nl'], ['PG', 'nl'], ['PH', 'nl'], ['PI', 'nl'],
  ['ON', 'be'], ['OE', 'at'], ['HB', 'ch'], ['SM', 'se'], ['LA', 'no'], ['OH', 'fi'], ['OZ', 'dk'],
  ['SP', 'pl'], ['OK', 'cz'], ['OL', 'cz'], ['OM', 'sk'], ['S5', 'si'], ['9A', 'hr'], ['YO', 'ro'], ['YU', 'rs'], ['YT', 'rs'], ['YZ', 'rs'], ['LZ', 'bg'], ['SV', 'gr'], ['TA', 'tr'],
  ['UA', 'ru'], ['R', 'ru'], ['RA', 'ru'], ['RK', 'ru'], ['RN', 'ru'], ['RU', 'ru'], ['RX', 'ru'], ['RW', 'ru'],
  ['ZS', 'za'], ['3B8', 'mu'], ['3B9', 'mu'], ['5R', 'mg'], ['5H', 'tz'], ['5N', 'ng'],
  ['VU', 'in'], ['HS', 'th'], ['9M', 'my'], ['YB', 'id'], ['DU', 'ph'], ['BY', 'cn'], ['BD', 'cn'], ['BH', 'cn'], ['BI', 'cn'], ['BG', 'cn'],
  ['HL', 'kr'], ['DS', 'kr'], ['6K', 'kr'], ['6L', 'kr'], ['6M', 'kr'], ['6N', 'kr'],
  ['T30', 'ki'], ['T31', 'ki'], ['T32', 'ki'], ['T33', 'ki'],
];

function flagCodeFromDxccName(dxccName) {
  const key = normCountryName(dxccName);
  if (!key) return '';
  return dxccNameAliases[key] || isoNameIndex[key] || '';
}

function flagCodeFromCallsign(cs) {
  const base = callsignBase(cs);
  if (!base) return '';
  for (const [prefix, cc] of callsignPrefixMap) {
    if (base.startsWith(prefix)) return cc;
  }
  return '';
}

// DXCC name takes priority: a foreign station operating portable in another
// DXCC entity should show the entity's flag, not its home callsign prefix.
function resolveFlagCode(spot) {
  const key = callsignBase(spot.activator);
  if (!key) return '';
  if (flagCache[key]) return flagCache[key];

  const cc = flagCodeFromDxccName(spot.dxcc) || flagCodeFromCallsign(key);
  if (!cc) return '';
  flagCache[key] = cc;
  saveFlagCache();
  return cc;
}

function refsText(spot) {
  if (spot.source === 'DXPED') return spot.meta?.hamalert?.fullCallsign || '';
  return (spot.references || []).join(', ');
}

function sanitizeCallsignForText(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/[^A-Z0-9/ -]/g, '')
    .trim();
}

function sanitizeCallsignForUrl(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/[^A-Z0-9/]/g, '')
    .trim();
}

function sanitizeReferenceForUrl(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/[^A-Z0-9/-]/g, '')
    .trim();
}

function safeText(v) {
  const t = String(v || '').trim();
  return t || '—';
}

// Unicode regional indicator letters: adding 127397 to 'A'(65)…'Z'(90) maps
// them to the Regional Indicator Symbols (U+1F1E6–U+1F1FF). Browsers that
// support the emoji zwj sequences render the pair as a flag.
function countryFlagEmoji(cc) {
  const code = String(cc || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  const base = 127397;
  return String.fromCodePoint(code.charCodeAt(0) + base)
       + String.fromCodePoint(code.charCodeAt(1) + base);
}

function referenceUrl(source, ref) {
  const cleanRef = sanitizeReferenceForUrl(ref);
  if (!cleanRef) return '';
  const safeRef = encodeURIComponent(cleanRef);
  switch (source) {
    case 'POTA':   return `https://pota.app/#/park/${safeRef}`;
    case 'SOTA':   return `https://www.sotadata.org.uk/en/summit/${safeRef.replaceAll('%2F', '/')}`;
    case 'WWFF':   return `https://spots.wwff.co/references/direct?wwff=${safeRef}`;
    case 'WWBOTA': return `https://wwbota.org/?s=${safeRef}`;
    case 'IOTA':   return `https://www.iota-world.org/iotamaps/?uuid=777777&grpref=${safeRef}`;
    default:       return '';
  }
}

function normText(v) {
  return String(v || '').toLowerCase();
}

function normToken(v) {
  return String(v || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

const MODE_FILTER = {
  // cw
  CW:           'cw',
  // ssb / voice
  SSB: 'ssb', DSB: 'ssb', LSB: 'ssb', USB: 'ssb', VOICE: 'ssb',
  // other (analog non-ssb)
  FM: 'other', AM: 'other',
  // digi — full ADIF 3.1.7 mode enumeration minus the entries above
  ARDOP: 'digi', ATV: 'digi', CHIP: 'digi', CLO: 'digi', CONTESTI: 'digi',
  DIGITALVOICE: 'digi', DOMINO: 'digi', DYNAMIC: 'digi', FAX: 'digi',
  FSK: 'digi', FSK441: 'digi', FT8: 'digi', HELL: 'digi', ISCAT: 'digi',
  JT4: 'digi', JT6M: 'digi', JT9: 'digi', JT44: 'digi', JT65: 'digi',
  MFSK: 'digi', MSK144: 'digi', MT63: 'digi', MTONE: 'digi', OFDM: 'digi',
  OLIVIA: 'digi', OPERA: 'digi', PAC: 'digi', PAX: 'digi', PKT: 'digi',
  PSK: 'digi', PSK2K: 'digi', Q15: 'digi', QRA64: 'digi', ROS: 'digi',
  RTTY: 'digi', RTTYM: 'digi', SSTV: 'digi', T10: 'digi', THOR: 'digi',
  THRB: 'digi', TOR: 'digi', V4: 'digi', VOI: 'digi', WINMOR: 'digi',
  WSPR: 'digi',
};

function resolveFilterMode(spot) {
  const m = String(spot.mode || '').toUpperCase();
  return MODE_FILTER[m] ?? 'other';
}

function sortValue(spot, col) {
  switch (col) {
    case 'time':      return new Date(spot.spot_time).getTime() || 0;
    case 'source':    return normText(spot.source);
    case 'band':      return normText(spot.band);
    case 'frequency': return Number(spot.frequency) || 0;
    case 'mode':      return normText(spot.mode);
    case 'activator': return normText(spot.activator);
    case 'continent': return normText(spot.continent || 'UNK');
    case 'reference': return normText(refsText(spot));
    case 'name':      return normText(spot.name);
    default:          return '';
  }
}

function normalizedRefs(spot) {
  return (spot.references || [])
    .map(sanitizeReferenceForUrl)
    .filter(Boolean)
    .map(normToken)
    .sort()
    .join(',');
}

function dedupeKey(spot) {
  const source = normToken(spot.source);
  if (!source) return `UNK|${spot.id}`;
  if (source === 'DXPED') return `DXPED|${spot.id}`;
  const activator = normToken(sanitizeCallsignForUrl(spot.activator)) || '-';
  const refs = normalizedRefs(spot) || '-';
  const band = normToken(spot.band) || '-';
  const mode = normToken(spot.mode) || '-';
  return `${source}|${activator}|${refs}|${band}|${mode}`;
}

function pickBucketWinner(bucket) {
  let winner = null;
  for (const spot of bucket.values()) winner = spot;
  return winner; // last inserted in the bucket (arrival-order winner)
}

function sortedSpots() {
  const dir = tableState.sortDir === 'asc' ? 1 : -1;
  const col = tableState.sortBy;
  return [...spots.values()].sort((a, b) => {
    const av = sortValue(a, col);
    const bv = sortValue(b, col);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    // stable secondary sort: newest first
    const at = new Date(a.spot_time).getTime() || 0;
    const bt = new Date(b.spot_time).getTime() || 0;
    return bt - at;
  });
}

function spotVisible(spot) {
  if (!filters.sources.has(spot.source))            return false;
  if (!filters.modes.has(resolveFilterMode(spot)))  return false;
  if (!filters.continents.has(spot.continent || 'UNK')) return false;
  if (filters.band && spot.band !== filters.band)   return false;
  if (!filters.showQrt && spot.status === 'qrt')    return false;
  if (tableState.search.activator && !normText(spot.activator).includes(tableState.search.activator)) return false;
  if (tableState.search.reference && !normText(refsText(spot)).includes(tableState.search.reference)) return false;
  if (tableState.search.name && !normText(spot.name).includes(tableState.search.name)) return false;
  return true;
}

function buildRow(spot) {
  const tr = document.createElement('tr');
  tr.id = `row-${CSS.escape(spot.id)}`;
  tr.dataset.id = spot.id;

  if (spot.status === 'qrt') tr.classList.add('status-qrt');

  const src = sourceClass(spot.source);
  const sourceText = safeText(spot.source);
  const bandText = safeText(spot.band);
  const modeText = safeText(spot.mode);
  const contText = safeText(spot.continent);
  const nameText = safeText(spot.name);
  // modeCls drives CSS colour only; it intentionally uses the raw mode_class/mode
  // string (e.g. "ft8", "ssb") rather than the normalised filter bucket so the
  // colour rules can be as specific or broad as the stylesheet chooses.
  const modeCls = normText(spot.mode_class || spot.mode || 'other').replace(/[^a-z0-9-]/g, '');
  const contCls = normText(spot.continent || 'unk').replace(/[^a-z0-9-]/g, '');
  const flagCc = resolveFlagCode(spot);
  const flagEmoji = countryFlagEmoji(flagCc);
  const activatorText = sanitizeCallsignForText(spot.activator) || '—';
  const activatorSlug = sanitizeCallsignForUrl(spot.activator);
  const activatorPath = encodeURIComponent(activatorSlug).replaceAll('%2F', '/');
  const activatorHref = activatorPath
    ? (spot.source === 'POTA'
      ? `https://pota.app/#/profile/${activatorPath}`
      : `https://www.hamqth.com/${activatorPath}`)
    : '';
  const referenceItems = (spot.references || [])
    .map(sanitizeReferenceForUrl)
    .filter(Boolean);
  const dxpedFullCs = spot.source === 'DXPED' ? sanitizeCallsignForText(spot.meta?.hamalert?.fullCallsign) : '';
  const refsTitle = referenceItems.join(', ') || dxpedFullCs || '—';

  const tdTime = document.createElement('td');
  tdTime.className = 'col-time';
  tdTime.textContent = formatTime(spot.spot_time);
  tr.appendChild(tdTime);

  const tdSource = document.createElement('td');
  tdSource.className = 'col-source';
  const sourceBadge = document.createElement('span');
  sourceBadge.className = `badge badge-${src}`;
  sourceBadge.textContent = sourceText;
  tdSource.appendChild(sourceBadge);
  tr.appendChild(tdSource);

  const tdBand = document.createElement('td');
  tdBand.className = 'col-band';
  tdBand.textContent = bandText;
  tr.appendChild(tdBand);

  const tdFreq = document.createElement('td');
  tdFreq.className = 'col-freq';
  tdFreq.textContent = formatFreq(spot.frequency);
  tr.appendChild(tdFreq);

  const tdMode = document.createElement('td');
  tdMode.className = `col-mode mode-${modeCls}`;
  tdMode.textContent = modeText;
  tr.appendChild(tdMode);

  const tdActivator = document.createElement('td');
  tdActivator.className = 'col-activator';
  const activatorLink = document.createElement('a');
  activatorLink.className = 'act-link';
  activatorLink.target = '_blank';
  activatorLink.rel = 'noopener';
  activatorLink.href = activatorHref || '#';
  if (!activatorHref) activatorLink.addEventListener('click', (e) => e.preventDefault());
  if (flagEmoji) {
    const flagSpan = document.createElement('span');
    flagSpan.className = 'act-flag';
    flagSpan.textContent = flagEmoji;
    activatorLink.appendChild(flagSpan);
  }
  activatorLink.appendChild(document.createTextNode(activatorText));
  tdActivator.appendChild(activatorLink);
  tr.appendChild(tdActivator);

  const tdCont = document.createElement('td');
  tdCont.className = `col-cont cont-${contCls}`;
  tdCont.textContent = contText;
  tr.appendChild(tdCont);

  const tdRef = document.createElement('td');
  tdRef.className = 'col-ref';
  tdRef.title = refsTitle;
  if (referenceItems.length === 0) {
    tdRef.textContent = dxpedFullCs || '—';
  } else {
    referenceItems.forEach((ref, idx) => {
      if (idx > 0) tdRef.appendChild(document.createTextNode(', '));
      const href = referenceUrl(spot.source, ref);
      if (!href) {
        tdRef.appendChild(document.createTextNode(ref));
        return;
      }
      const link = document.createElement('a');
      link.className = 'ref-link';
      link.target = '_blank';
      link.rel = 'noopener';
      link.href = href;
      link.textContent = ref;
      tdRef.appendChild(link);
    });
  }
  tr.appendChild(tdRef);

  const tdName = document.createElement('td');
  tdName.className = 'col-name';
  tdName.title = nameText;
  tdName.textContent = nameText;
  tr.appendChild(tdName);

  return tr;
}

// Removes the class first, forces a reflow by reading offsetWidth (which flushes
// pending style changes), then re-adds it — this resets the CSS animation so it
// plays again even if the row was already flashing.
function flash(tr, cls) {
  tr.classList.remove('flash-new', 'flash-upd');
  void tr.offsetWidth;
  tr.classList.add(cls);
  tr.addEventListener('animationend', () => tr.classList.remove(cls), { once: true });
}

function updateSortHeaderUi() {
  sortHeads.forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort !== tableState.sortBy) return;
    th.classList.add(tableState.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

function renderTable() {
  tbody.querySelectorAll('tr[data-id]').forEach(r => r.remove());
  sortedSpots().forEach(spot => {
    if (!spotVisible(spot)) return;
    tbody.appendChild(buildRow(spot));
  });
}

function updateEmptyRow() {
  const hasVisible = [...spots.values()].some(spotVisible);
  emptyRow.classList.toggle('hidden', hasVisible);
  if (!hasVisible) {
    emptyRow.querySelector('td').textContent =
      spots.size === 0 ? 'Waiting for spots…' : 'No spots match the current filters.';
  }
}

function updateStats() {
  const visible = [...spots.values()].filter(spotVisible);
  const bySource = { DXPED: 0, IOTA: 0, POTA: 0, SOTA: 0, WWBOTA: 0, WWFF: 0 };
  visible.forEach(s => { if (s.source in bySource) bySource[s.source]++; });

  statsBar.innerHTML = `
    <span class="stat-total">Total activations: ${visible.length} - Users/Sessions active: ${usersSessionsOnline}</span>
    <span class="stat-sep"></span>
    <span class="stat-source dxped">DXped <b>${bySource.DXPED}</b></span>
    <span class="stat-source iota">IOTA <b>${bySource.IOTA}</b></span>
    <span class="stat-source pota">POTA <b>${bySource.POTA}</b></span>
    <span class="stat-source sota">SOTA <b>${bySource.SOTA}</b></span>
    <span class="stat-source wwbota">WWBOTA <b>${bySource.WWBOTA}</b></span>
    <span class="stat-source wwff">WWFF <b>${bySource.WWFF}</b></span>
  `;
}

async function refreshReadyStatus() {
  try {
    const res = await fetch(READY_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data && typeof data.online === 'string' && data.online.trim()) {
      usersSessionsOnline = data.online.trim();
      updateStats();
    }
  } catch {
    // Keep previous value on failures; this must never interrupt SSE rendering.
  }
}

function startReadyStatusPolling() {
  refreshReadyStatus();
  setInterval(refreshReadyStatus, 120000);
}

// ── Spot management ───────────────────────────────────────────────────────────

function insertRowSorted(newTr, spot) {
  const col = tableState.sortBy;
  const dir = tableState.sortDir === 'asc' ? 1 : -1;
  const newVal = sortValue(spot, col);
  const newTime = new Date(spot.spot_time).getTime() || 0;
  for (const row of tbody.querySelectorAll('tr[data-id]')) {
    const rowSpot = spots.get(row.dataset.id);
    if (!rowSpot) continue;
    const rowVal = sortValue(rowSpot, col);
    let before;
    if (newVal < rowVal)      before = dir > 0;
    else if (newVal > rowVal) before = dir < 0;
    else {
      const rowTime = new Date(rowSpot.spot_time).getTime() || 0;
      before = newTime > rowTime;
    }
    if (before) { tbody.insertBefore(newTr, row); return; }
  }
  tbody.insertBefore(newTr, emptyRow);
}

function addSpot(spot) {
  const existing = tbody.querySelector(`#row-${CSS.escape(spot.id)}`);
  if (existing) existing.remove();
  if (spotVisible(spot)) {
    const tr = buildRow(spot);
    insertRowSorted(tr, spot);
    flash(tr, 'flash-new');
  }
  updateEmptyRow();
  updateStats();
}

function updateSpot(spot) {
  const existing = tbody.querySelector(`#row-${CSS.escape(spot.id)}`);
  if (existing) existing.remove();
  if (spotVisible(spot)) {
    const tr = buildRow(spot);
    insertRowSorted(tr, spot);
    flash(tr, 'flash-upd');
  }
  updateEmptyRow();
  updateStats();
}

function removeSpot(id) {
  const row = tbody.querySelector(`#row-${CSS.escape(id)}`);
  if (row) row.remove();
  updateEmptyRow();
  updateStats();
}

function syncBucketWinner(key, flashClass = null) {
  const bucket = spotBuckets.get(key);
  const prevWinnerId = spotWinnerByKey.get(key) || null;
  const prevWinnerSpot = prevWinnerId ? spots.get(prevWinnerId) : null;
  const nextWinner = bucket ? pickBucketWinner(bucket) : null;
  const nextWinnerId = nextWinner ? nextWinner.id : null;

  if (!nextWinner) {
    if (prevWinnerId != null) {
      spotWinnerByKey.delete(key);
      spots.delete(prevWinnerId);
      removeSpot(prevWinnerId);
    }
    return;
  }

  spotWinnerByKey.set(key, nextWinnerId);
  spots.set(nextWinnerId, nextWinner);

  if (prevWinnerId && prevWinnerId !== nextWinnerId) {
    spots.delete(prevWinnerId);
    removeSpot(prevWinnerId);
  }

  const winnerChanged = prevWinnerId !== nextWinnerId;
  const winnerUpdated = !winnerChanged && !!prevWinnerSpot
    && JSON.stringify(prevWinnerSpot) !== JSON.stringify(nextWinner);
  if (!winnerChanged && !winnerUpdated) return;

  if (flashClass === 'flash-new') addSpot(nextWinner);
  else if (flashClass === 'flash-upd') updateSpot(nextWinner);
}

function ingestSpot(spot, flashClass = null) {
  const key = dedupeKey(spot);
  const prevKey = spotKeyById.get(spot.id);
  if (prevKey && prevKey !== key) {
    const prevBucket = spotBuckets.get(prevKey);
    if (prevBucket) {
      prevBucket.delete(spot.id);
      if (prevBucket.size === 0) spotBuckets.delete(prevKey);
      syncBucketWinner(prevKey, null);
    }
  }

  let bucket = spotBuckets.get(key);
  if (!bucket) {
    bucket = new Map();
    spotBuckets.set(key, bucket);
  }
  bucket.set(spot.id, spot);
  spotKeyById.set(spot.id, key);
  syncBucketWinner(key, flashClass);
}

function removeRawSpot(id) {
  const key = spotKeyById.get(id);
  if (!key) return;
  spotKeyById.delete(id);
  const bucket = spotBuckets.get(key);
  if (!bucket) return;
  bucket.delete(id);
  if (bucket.size === 0) spotBuckets.delete(key);
  syncBucketWinner(key, null);
}

// Full replacement: the BFF sends the current live snapshot on (re)connect,
// so we discard any previously cached spots before loading the new list.
function loadInit(spotList) {
  spots.clear();
  spotBuckets.clear();
  spotKeyById.clear();
  spotWinnerByKey.clear();
  spotList.forEach(s => {
    const key = dedupeKey(s);
    let bucket = spotBuckets.get(key);
    if (!bucket) {
      bucket = new Map();
      spotBuckets.set(key, bucket);
    }
    bucket.set(s.id, s);
    spotKeyById.set(s.id, key);
  });
  for (const [key, bucket] of spotBuckets.entries()) {
    const winner = pickBucketWinner(bucket);
    if (!winner) continue;
    spotWinnerByKey.set(key, winner.id);
    spots.set(winner.id, winner);
  }
  renderTable();
  updateEmptyRow();
  updateStats();
}

// ── SSE connection ─────────────────────────────────────────────────────────────

let es = null;

function setConnState(state) {
  connDot.className = 'conn-dot ' + state;
  connLabel.textContent = {
    ok:    'Connected',
    error: 'Disconnected — retrying…',
    wait:  'Connecting…',
  }[state] || state;
}

function connect() {
  setConnState('wait');
  if (es) { es.close(); es = null; }

  es = new EventSource(BFF_URL);

  es.addEventListener('init', (e) => {
    setConnState('ok');
    try { loadInit(JSON.parse(e.data)); } catch (err) { console.error('init parse error', err); }
  });

  es.addEventListener('add', (e) => {
    try { const { spot } = JSON.parse(e.data); ingestSpot(spot, 'flash-new'); } catch (err) { console.error('add parse error', err); }
  });

  es.addEventListener('update', (e) => {
    try { const { spot } = JSON.parse(e.data); ingestSpot(spot, 'flash-upd'); } catch (err) { console.error('update parse error', err); }
  });

  es.addEventListener('remove', (e) => {
    try { const { id } = JSON.parse(e.data); removeRawSpot(id); } catch (err) { console.error('remove parse error', err); }
  });

  // EventSource handles reconnection automatically with exponential back-off;
  // we only update the UI label here — no manual retry logic needed.
  es.onerror = () => {
    setConnState('error');
  };

}

// ── Filter wiring ─────────────────────────────────────────────────────────────

function refilter() {
  renderTable();
  updateEmptyRow();
  updateStats();
  saveUiState();
}

function resetSortToDefault() {
  tableState.sortBy = 'time';
  tableState.sortDir = 'desc';
  updateSortHeaderUi();
}

// Single delegated listener on the group container — handles all toggle buttons
// inside without attaching one listener per button.
function wireToggleGroup(containerId, filterSet) {
  const container = document.getElementById(containerId);
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle');
    if (!btn) return;
    const val = btn.dataset.value;
    if (filterSet.has(val)) { filterSet.delete(val); btn.classList.remove('active'); }
    else                    { filterSet.add(val);    btn.classList.add('active'); }
    refilter();
  });
}

wireToggleGroup('filter-source',    filters.sources);
wireToggleGroup('filter-mode',      filters.modes);
wireToggleGroup('filter-continent', filters.continents);

document.getElementById('filter-band').addEventListener('change', (e) => {
  filters.band = e.target.value;
  refilter();
});

document.getElementById('filter-qrt').addEventListener('change', (e) => {
  filters.showQrt = e.target.checked;
  refilter();
});

sortHeads.forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    if (tableState.sortBy === col) {
      tableState.sortDir = tableState.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      tableState.sortBy = col;
      tableState.sortDir = col === 'time' ? 'desc' : 'asc';
    }
    updateSortHeaderUi();
    refilter();
  });
});

SEARCH_COLS.forEach(col => {
  const input = document.getElementById(`search-${col}`);
  input.addEventListener('input', (e) => {
    tableState.search[col] = normText(e.target.value.trim());
    refilter();
  });
});

document.getElementById('btn-clear').addEventListener('click', () => {
  ['filter-source', 'filter-mode', 'filter-continent'].forEach(id => {
    document.getElementById(id).querySelectorAll('.toggle').forEach(btn => {
      btn.classList.add('active');
      const set = id === 'filter-source'    ? filters.sources
                : id === 'filter-mode'      ? filters.modes
                :                             filters.continents;
      set.add(btn.dataset.value);
    });
  });
  filters.band    = '';
  filters.showQrt = false;
  document.getElementById('filter-band').value = '';
  document.getElementById('filter-qrt').checked = false;
  tableState.search.activator = '';
  tableState.search.reference = '';
  tableState.search.name = '';
  document.getElementById('search-activator').value = '';
  document.getElementById('search-reference').value = '';
  document.getElementById('search-name').value = '';
  resetSortToDefault();
  refilter();
});

// ── Changelog modal ───────────────────────────────────────────────────────────

const CHANGELOG_SEEN_KEY = 'odx:changelog_seen_v1';

// Extracts the date and bullet list from the topmost entry in the Markdown file.
function parseChangelog(mdText) {
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  let date = null;
  const bullets = [];
  for (const raw of mdText.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (dateRe.test(line)) {
      if (date) break;   // second date reached — done with the first entry
      date = line;
      continue;
    }
    if (date && line.startsWith('- ')) bullets.push(line.slice(2));
  }
  return { date, bullets };
}

function buildChangelogModal(date, bullets) {
  const dismiss = () => {
    try { localStorage.setItem(CHANGELOG_SEEN_KEY, date); } catch { /* quota/private */ }
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };

  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
  document.addEventListener('keydown', onKey);

  const overlay = document.createElement('div');
  overlay.className = 'cl-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });

  const card = document.createElement('div');
  card.className = 'cl-card';

  const header = document.createElement('div');
  header.className = 'cl-header';
  header.innerHTML =
    `<h2 class="cl-title">What's new</h2>` +
    `<span class="cl-date">${date}</span>`;

  const sub = document.createElement('p');
  sub.className = 'cl-sub';
  sub.innerHTML = 'Full changelog available at <a href="https://github.com/ea1het/outdoordx_com/blob/gh-pages/Changelog.md" target="_blank" rel="noopener">GitHub repo</a>';

  const list = document.createElement('ul');
  list.className = 'cl-list';
  bullets.forEach(b => {
    const li = document.createElement('li');
    li.textContent = b;
    list.appendChild(li);
  });

  const footer = document.createElement('div');
  footer.className = 'cl-footer';
  const btn = document.createElement('button');
  btn.className = 'cl-btn';
  btn.textContent = 'Got it';
  btn.addEventListener('click', dismiss);
  footer.appendChild(btn);

  card.append(header, sub, list, footer);
  overlay.appendChild(card);
  return overlay;
}

async function checkChangelog() {
  try {
    const res = await fetch('Changelog.md');
    if (!res.ok) return;
    const { date, bullets } = parseChangelog(await res.text());
    if (!date || !bullets.length) return;
    if (localStorage.getItem(CHANGELOG_SEEN_KEY) === date) return;
    document.body.appendChild(buildChangelogModal(date, bullets));
  } catch { /* network error or localStorage blocked — silently skip */ }
}

// ── Easter egg ────────────────────────────────────────────────────────────────
// Five rapid clicks on the ♥ in the credit note clears all odx: localStorage
// keys and reloads — handy for resetting cached flags / UI state during debugging.
(function () {
  const heart = document.querySelector('.credit-heart');
  if (!heart) return;
  let clicks = 0, timer = null;
  heart.addEventListener('click', () => {
    clicks++;
    clearTimeout(timer);
    if (clicks >= 5) {
      clicks = 0;
      heart.textContent = '✓';
      heart.style.color = 'var(--pota)';
      setTimeout(() => {
        Object.keys(localStorage)
          .filter(k => k.startsWith('odx:'))
          .forEach(k => localStorage.removeItem(k));
        location.reload();
      }, 600);
      return;
    }
    timer = setTimeout(() => { clicks = 0; }, 1500);
  });
})();

// ── Boot ──────────────────────────────────────────────────────────────────────
updateSortHeaderUi();
applyUiState(loadUiState());
connect();
startReadyStatusPolling();
checkChangelog();
