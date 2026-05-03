# Changelog

2026-05-03

- Added support for new DXCC (Corsica, FR)

2026-05-02

- Improved visualization of data being refreshed by backend.
- Added corrections for recognizing Kiribti DXCC.
- Frequency display now unit-adaptive: below 1 GHz shown as MHz with 4 decimal places; 1 GHz and above shown as GHz with 5 decimal places. Fixes 23cm and microwave band frequencies overflowing the column.
- Live sort now preserved when new spots arrive. Previously any `add` or `update` SSE event reset the sort to time-descending so the new spot surfaced at the top. Now the active sort is kept: new and updated spots are inserted directly into their correct sorted position in the DOM (`insertRowSorted`), and removals delete only the affected row — no full table rebuild on incremental changes.
- Updated stats bar wording on desktop from "`N spots`" to `Total activations: N - Users/Sessions active: X/Y`.
- Mobile stats-bar behavior adjusted so only source counters are shown (DXped/IOTA/POTA/SOTA/WWBOTA/WWFF), with desktop activation/session text hidden and the counters centered.

2026-05-01

- Fixed Bonaire flag not resolving for PJ4-prefix callsigns (e.g. PJ4TB). Added `PJ4` to `callsignPrefixMap` and `'bonaire'` to `dxccNameAliases`, both mapped to `bq`, covering both the callsign and DXCC name resolution paths.

2026-04-30

- Added "What's New" changelog modal: shown automatically when the top entry date in Changelog.md is newer than the last-seen date stored in localStorage (`odx:changelog_seen_v1`). Fetches and parses the Markdown file at runtime — no constant to maintain in code. Dismisses via "Got it" button, clicking the backdrop, or Escape key; all paths save the date to localStorage so the modal does not reappear until a new entry is added.
- Added IOTA and DXped as new spot sources fed from HamAlert via the BFF. Both appear in the source filter bar (order: DXped, IOTA, POTA, SOTA, WWBOTA, WWFF), the stats bar, and the spot table with coloured badges.
- Added reference URL for IOTA spots linking to the IOTA World island groups page. DXped spots carry no programme reference so their reference cell shows a dash.
- Replaced the ad-hoc `resolveFilterMode` function with a dictionary (`MODE_FILTER`) covering the full ADIF 3.1.7 mode enumeration. Rules: CW = cw; SSB / USB / LSB / DSB / VOICE = ssb; everything else in the ADIF list = digi; FM / AM and unrecognised modes = other. This fixes HamAlert spots whose `mode_class` field uses incompatible category names.
- Removed FM from the mode filter buttons. FM and AM are now classified as Other. The CSS toggle rule for FM was also removed.
- Added HamAlert to the footer credits (linked to hamalert.org/stats). DXped and IOTA are HamAlert-aggregated sources, not independent programmes.
- Fixed Czech Republic flag not resolving for OL-prefix callsigns (e.g. OL1TWR). Added `OL` to `callsignPrefixMap` and `'czech republic'` to `dxccNameAliases` to cover both the callsign path and the DXCC name path (Intl.DisplayNames returns "Czechia" for CZ, not "Czech Republic").
- Fixed Rodrigues Island flag not resolving for 3B9-prefix callsigns (e.g. 3B9G). Added `3B9` (Rodrigues Island) and `3B8` (Mauritius proper) to `callsignPrefixMap` mapped to `mu`, and added `'rodriguez i'` and `'rodrigues island'` to `dxccNameAliases` to handle the BFF DXCC name "Rodriguez I." through both resolution paths.
- Fixed `applyUiState` not trimming whitespace from restored search strings, which could cause silent mismatches against live spot data.
- Reference cell (`col-ref`) now wraps text instead of truncating, so all references are visible when a spot carries multiple (e.g. multi-bunker WWBOTA activations). The tooltip is kept as a bonus.
- Removed redundant `.conn-dot.wait` CSS rule (the base `.conn-dot` already sets the waiting colour).
- Removed `es.onopen` call that duplicated `setConnState('ok')` already handled by the `init` SSE event handler.
- Removed spurious `box-shadow` from the SA continent toggle active state for consistency with all other continent toggles.
- Added code comments throughout `app.js`, `index.html`, and `style.css` explaining non-obvious logic: localStorage key versioning strategy, flag cache persistence, `buildIsoNameIndex` brute-force approach, Unicode regional indicator emoji encoding, CSS animation reset via forced reflow, `modeCls` vs filter mode distinction, event delegation in `wireToggleGroup`, `table-layout: fixed` rationale, and SVG hero scene structure.

2026-04-29

- Fixed flag resolution returning deprecated ISO codes (e.g. "fx" for France, "cs" for Serbia) caused by `buildIsoNameIndex()` iterating retired ISO 3166-1 codes that collide with current ones. Added an explicit blocklist of deprecated codes (AN, BU, CS, DD, FX, NT, SU, TP, YU, ZR) so they are skipped during index construction.
- Added "yugoslavia" and "serbia and montenegro" aliases in `dxccNameAliases` pointing to "rs" (Serbia), so callsigns whose DXCC name comes from the API as a historical Yugoslavia-era string resolve to the correct Serbian flag.
- Added Serbian callsign prefixes YU, YT, and YZ to `callsignPrefixMap` mapped to "rs", so portable callsigns like YU/OK1WED/P are correctly identified as Serbian even when the DXCC field is absent or unrecognized.
- Added South Korean callsign prefixes HL, DS, 6K, 6L, 6M, and 6N to `callsignPrefixMap` mapped to "kr", so callsigns like DS2MGT display the correct South Korean flag.
- Improved inline documentation in `app.js`: added comments explaining the portable callsign format handled by `callsignBase`, the purpose of `dxccNameAliases`, the prefix ordering requirement in `callsignPrefixMap`, the DXCC-first priority in `resolveFlagCode`, and the sort reset on new spots in `addSpot`/`updateSpot`. Removed a redundant comment in the clear-filters handler.
