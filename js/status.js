// status.js — OutdoorDX system status page
//
// Probes /ready and /health on the BFF and API backends, measures round-trip
// latency from the browser, and renders the results into cards that refresh
// automatically every REFRESH_MS milliseconds.
//
// CORS requirement: HAProxy only issues Access-Control-Allow-Origin for
// requests originating from https://outdoordx.com, so this page must be
// served from that exact origin or probes will be blocked by the browser.

'use strict';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Each entry describes one backend service and the health endpoints to probe.
const SERVICES = [
  { id: 'bff', name: 'BFF', host: 'https://bff.outdoordx.net', paths: ['/ready', '/health'] },
  { id: 'api', name: 'API', host: 'https://api.outdoordx.net', paths: ['/ready', '/health'] },
];

// Milliseconds between automatic refresh cycles.
const REFRESH_MS = 30_000;

// Handle for the setInterval that drives the countdown display.
let countdownTimer = null;
let countdownSec   = 0;

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

// Fetches url and returns { ok, status, latency, body } on success or
// { ok: false, status: null, latency, error } on network failure.
// Latency is the full round-trip in ms as seen by the browser.
async function probe(url) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const latency = Math.round(performance.now() - t0);
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, latency, body };
  } catch (err) {
    return { ok: false, status: null, latency: Math.round(performance.now() - t0), error: err.message };
  }
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

// Maps a latency value to a CSS class for colour-coding:
//   green  < 100 ms  (lat-fast)
//   amber  < 300 ms  (lat-mid)
//   red   >= 300 ms  (lat-slow)
function latencyClass(ms) {
  if (ms < 100) return 'lat-fast';
  if (ms < 300) return 'lat-mid';
  return 'lat-slow';
}

// Returns the deterministic DOM id used for a service+path card.
function cardId(svcId, path) {
  return `st-card-${svcId}-${path.replace('/', '')}`;
}

// Builds and returns the initial card element for a service endpoint.
// The card shows placeholder dashes until the first probe result arrives.
function buildCard(svcId, path) {
  const card = document.createElement('div');
  card.className = 'st-card';
  card.id = cardId(svcId, path);
  card.innerHTML =
    '<div class="st-card-path">' + path + '</div>' +
    '<div class="st-card-meta">' +
      '<span class="st-dot checking"></span>' +
      '<span class="st-code">—</span>' +
      '<span class="st-latency">—</span>' +
    '</div>' +
    '<pre class="st-body">checking…</pre>' +
    '<div class="st-updated"></div>';
  return card;
}

// Fills an existing card with the result returned by probe().
// HTTP 4xx → amber code, 5xx or network error → red code and red dot.
function updateCard(card, result) {
  const dot     = card.querySelector('.st-dot');
  const code    = card.querySelector('.st-code');
  const latency = card.querySelector('.st-latency');
  const body    = card.querySelector('.st-body');
  const updated = card.querySelector('.st-updated');

  dot.className = 'st-dot ' + (result.ok ? 'ok' : 'error');
  card.classList.remove('st-card--ok', 'st-card--err');
  card.classList.add(result.ok ? 'st-card--ok' : 'st-card--err');

  if (result.status !== null) {
    code.textContent = String(result.status);
    code.className = 'st-code ' + (result.ok ? 'code-ok' : result.status < 500 ? 'code-warn' : 'code-err');
  } else {
    code.textContent = 'ERR';
    code.className = 'st-code code-err';
  }

  latency.textContent = result.latency + ' ms';
  latency.className = 'st-latency ' + latencyClass(result.latency);

  if (result.body !== null && result.body !== undefined) {
    body.textContent = JSON.stringify(result.body, null, 2);
  } else if (result.error) {
    body.textContent = result.error;
  } else {
    body.textContent = '(empty)';
  }

  updated.textContent = 'Checked ' + new Date().toLocaleTimeString();
}

// ---------------------------------------------------------------------------
// Refresh logic
// ---------------------------------------------------------------------------

// Marks all cards as "checking", then fires all probes in parallel and
// updates each card as its result arrives.
async function checkAll() {
  const targets = SERVICES.flatMap(svc =>
    svc.paths.map(path => ({ svc, path, card: document.getElementById(cardId(svc.id, path)) }))
  );

  for (const { card } of targets) {
    if (card) card.querySelector('.st-dot').className = 'st-dot checking';
  }

  await Promise.all(targets.map(async ({ svc, path, card }) => {
    if (!card) return;
    const result = await probe(svc.host + path);
    updateCard(card, result);
  }));
}

// Resets the REFRESH_MS countdown and schedules the next checkAll() call.
// Also updates the #st-countdown label once per second.
function startCountdown() {
  clearInterval(countdownTimer);
  countdownSec = REFRESH_MS / 1000;
  const el = document.getElementById('st-countdown');

  function tick() {
    if (el) el.textContent = 'Next check in ' + countdownSec + 's';
    if (countdownSec <= 0) {
      clearInterval(countdownTimer);
      checkAll().then(startCountdown);
      return;
    }
    countdownSec--;
  }

  tick();
  countdownTimer = setInterval(tick, 1000);
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('st-services');

  // Build one section per service, each containing a card per endpoint.
  for (const svc of SERVICES) {
    const section = document.createElement('div');
    section.className = 'st-section';

    const hdr = document.createElement('div');
    hdr.className = 'st-section-hdr';
    hdr.innerHTML =
      '<span class="st-section-name">' + svc.name + '</span>' +
      '<span class="st-section-host">' + svc.host.replace('https://', '') + '</span>';

    const cards = document.createElement('div');
    cards.className = 'st-cards';
    cards.id = 'st-cards-' + svc.id;

    for (const path of svc.paths) {
      cards.appendChild(buildCard(svc.id, path));
    }

    section.appendChild(hdr);
    section.appendChild(cards);
    container.appendChild(section);
  }

  // Manual refresh button cancels the current countdown and re-probes immediately.
  document.getElementById('st-refresh-btn').addEventListener('click', () => {
    clearInterval(countdownTimer);
    checkAll().then(startCountdown);
  });

  checkAll().then(startCountdown);
});
