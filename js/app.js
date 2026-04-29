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

// ── State ───────────────────────────────────────────────────────────────────
const spots = new Map();   // id → spot

const filters = {
  sources:    new Set(['POTA', 'SOTA', 'WWFF', 'WWBOTA']),
  modes:      new Set(['cw', 'ssb', 'fm', 'digi', 'other']),
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

const FLAG_CACHE_KEY = 'odx:flag_cc_v1';
const UI_STATE_KEY   = 'odx:ui_state_v1';
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
const SORT_COLS = new Set(['time', 'source', 'band', 'frequency', 'mode', 'activator', 'continent', 'reference', 'name']);

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatFreq(hz) {
  if (hz == null) return '—';
  return (hz / 1000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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
    tableState.search[col] = normText(v);
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
  ['PA', 'nl'], ['PB', 'nl'], ['PC', 'nl'], ['PD', 'nl'], ['PE', 'nl'], ['PG', 'nl'], ['PH', 'nl'], ['PI', 'nl'],
  ['ON', 'be'], ['OE', 'at'], ['HB', 'ch'], ['SM', 'se'], ['LA', 'no'], ['OH', 'fi'], ['OZ', 'dk'],
  ['SP', 'pl'], ['OK', 'cz'], ['OM', 'sk'], ['S5', 'si'], ['9A', 'hr'], ['YO', 'ro'], ['YU', 'rs'], ['YT', 'rs'], ['YZ', 'rs'], ['LZ', 'bg'], ['SV', 'gr'], ['TA', 'tr'],
  ['UA', 'ru'], ['R', 'ru'], ['RA', 'ru'], ['RK', 'ru'], ['RN', 'ru'], ['RU', 'ru'], ['RX', 'ru'], ['RW', 'ru'],
  ['ZS', 'za'], ['5R', 'mg'], ['5H', 'tz'], ['5N', 'ng'],
  ['VU', 'in'], ['HS', 'th'], ['9M', 'my'], ['YB', 'id'], ['DU', 'ph'], ['BY', 'cn'], ['BD', 'cn'], ['BH', 'cn'], ['BI', 'cn'], ['BG', 'cn'],
  ['HL', 'kr'], ['DS', 'kr'], ['6K', 'kr'], ['6L', 'kr'], ['6M', 'kr'], ['6N', 'kr'],
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
    default:       return '';
  }
}

function normText(v) {
  return String(v || '').toLowerCase();
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
  if (!filters.modes.has(spot.mode_class))          return false;
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
  const refsTitle = referenceItems.join(', ') || '—';

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
    tdRef.textContent = '—';
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

function flash(tr, cls) {
  tr.classList.remove('flash-new', 'flash-upd');
  void tr.offsetWidth;   // force reflow to restart animation
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
  const bySource = { POTA: 0, SOTA: 0, WWBOTA: 0, WWFF: 0 };
  visible.forEach(s => { if (s.source in bySource) bySource[s.source]++; });

  statsBar.innerHTML = `
    <span class="stat-total">${visible.length} spot${visible.length !== 1 ? 's' : ''}</span>
    <span class="stat-sep"></span>
    <span class="stat-source pota">POTA <b>${bySource.POTA}</b></span>
    <span class="stat-source sota">SOTA <b>${bySource.SOTA}</b></span>
    <span class="stat-source wwbota">WWBOTA <b>${bySource.WWBOTA}</b></span>
    <span class="stat-source wwff">WWFF <b>${bySource.WWFF}</b></span>
  `;
}

// ── Spot management ───────────────────────────────────────────────────────────

function addSpot(spot) {
  spots.set(spot.id, spot);
  // Always reset to newest-first so the new spot appears at the top.
  tableState.sortBy = 'time';
  tableState.sortDir = 'desc';
  updateSortHeaderUi();
  renderTable();
  const tr = tbody.querySelector(`#row-${CSS.escape(spot.id)}`);
  if (tr) flash(tr, 'flash-new');
  updateEmptyRow();
  updateStats();
}

function updateSpot(spot) {
  spots.set(spot.id, spot);
  // Same reset as addSpot: an updated spot is still a fresh event worth surfacing.
  tableState.sortBy = 'time';
  tableState.sortDir = 'desc';
  updateSortHeaderUi();
  renderTable();
  const tr = tbody.querySelector(`#row-${CSS.escape(spot.id)}`);
  if (tr) flash(tr, 'flash-upd');
  updateEmptyRow();
  updateStats();
}

function removeSpot(id) {
  spots.delete(id);
  renderTable();
  updateEmptyRow();
  updateStats();
}

function loadInit(spotList) {
  spots.clear();
  spotList.forEach(s => spots.set(s.id, s));
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
    try { const { spot } = JSON.parse(e.data); addSpot(spot); } catch (err) { console.error('add parse error', err); }
  });

  es.addEventListener('update', (e) => {
    try { const { spot } = JSON.parse(e.data); updateSpot(spot); } catch (err) { console.error('update parse error', err); }
  });

  es.addEventListener('remove', (e) => {
    try { const { id } = JSON.parse(e.data); removeSpot(id); } catch (err) { console.error('remove parse error', err); }
  });

  es.onerror = () => {
    setConnState('error');
    // EventSource auto-reconnects; we just show the status.
  };

  es.onopen = () => setConnState('ok');
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

function wireToggleGroup(containerId, filterSet) {
  const container = document.getElementById(containerId);
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle');
    if (!btn) return;
    const val = btn.dataset.value;
    if (filterSet.has(val)) { filterSet.delete(val); btn.classList.remove('active'); }
    else                    { filterSet.add(val);    btn.classList.add('active'); }
    resetSortToDefault();
    refilter();
  });
}

wireToggleGroup('filter-source',    filters.sources);
wireToggleGroup('filter-mode',      filters.modes);
wireToggleGroup('filter-continent', filters.continents);

document.getElementById('filter-band').addEventListener('change', (e) => {
  filters.band = e.target.value;
  resetSortToDefault();
  refilter();
});

document.getElementById('filter-qrt').addEventListener('change', (e) => {
  filters.showQrt = e.target.checked;
  resetSortToDefault();
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

// ── Boot ──────────────────────────────────────────────────────────────────────
updateSortHeaderUi();
applyUiState(loadUiState());
connect();
