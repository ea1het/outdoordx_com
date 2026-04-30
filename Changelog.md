# Changelog

2026-04-30

- Added IOTA and DXped as new spot sources fed from HamAlert via the BFF. Both appear in the source filter bar (order: DXped → IOTA → POTA → SOTA → WWBOTA → WWFF), the stats bar, and the spot table with coloured badges (IOTA pink, DXped orange).
- Added reference URL for IOTA spots linking to the IOTA World island groups page. DXped spots carry no programme reference so their reference cell shows a dash.
- Replaced the ad-hoc `resolveFilterMode` function with a dictionary (`MODE_FILTER`) covering the full ADIF 3.1.7 mode enumeration. Rules: CW → cw; SSB / USB / LSB / DSB / VOICE → ssb; everything else in the ADIF list → digi; FM / AM and unrecognised modes → other. This fixes HamAlert spots whose `mode_class` field uses incompatible category names.
- Removed FM from the mode filter buttons. FM and AM are now classified as Other. The CSS toggle rule for FM was also removed.
- Changed IOTA colour from teal (#2dd4bf) to hot pink (#f472b6) to avoid visual similarity with POTA green.
- Added HamAlert to the footer credits (linked to hamalert.org/stats). DXped and IOTA are HamAlert-aggregated sources, not independent programmes.
- Fixed Czech Republic flag not resolving for OL-prefix callsigns (e.g. OL1TWR). Added `OL` to `callsignPrefixMap` and `'czech republic'` to `dxccNameAliases` to cover both the callsign path and the DXCC name path (Intl.DisplayNames returns "Czechia" for CZ, not "Czech Republic").
- Fixed `applyUiState` not trimming whitespace from restored search strings, which could cause silent mismatches against live spot data.
- Reference cell (`col-ref`) now wraps text instead of truncating, so all references are visible when a spot carries multiple (e.g. multi-bunker WWBOTA activations). The tooltip is kept as a bonus.
- Removed redundant `.conn-dot.wait` CSS rule (the base `.conn-dot` already sets the waiting colour).
- Removed `es.onopen` call that duplicated `setConnState('ok')` already handled by the `init` SSE event handler.
- Removed spurious `box-shadow` from the SA continent toggle active state for consistency with all other continent toggles.
- Added human-readable comments throughout `app.js`, `index.html`, and `style.css` explaining non-obvious logic: localStorage key versioning strategy, flag cache persistence, `buildIsoNameIndex` brute-force approach, Unicode regional indicator emoji encoding, CSS animation reset via forced reflow, `modeCls` vs filter mode distinction, event delegation in `wireToggleGroup`, `table-layout: fixed` rationale, and SVG hero scene structure.

2026-04-29

- Fixed flag resolution returning deprecated ISO codes (e.g. "fx" for France, "cs" for Serbia) caused by `buildIsoNameIndex()` iterating retired ISO 3166-1 codes that collide with current ones. Added an explicit blocklist of deprecated codes (AN, BU, CS, DD, FX, NT, SU, TP, YU, ZR) so they are skipped during index construction.
- Added "yugoslavia" and "serbia and montenegro" aliases in `dxccNameAliases` pointing to "rs" (Serbia), so callsigns whose DXCC name comes from the API as a historical Yugoslavia-era string resolve to the correct Serbian flag.
- Added Serbian callsign prefixes YU, YT, and YZ to `callsignPrefixMap` mapped to "rs", so portable callsigns like YU/OK1WED/P are correctly identified as Serbian even when the DXCC field is absent or unrecognized.
- Added South Korean callsign prefixes HL, DS, 6K, 6L, 6M, and 6N to `callsignPrefixMap` mapped to "kr", so callsigns like DS2MGT display the correct South Korean flag.
- Improved inline documentation in `app.js`: added comments explaining the portable callsign format handled by `callsignBase`, the purpose of `dxccNameAliases`, the prefix ordering requirement in `callsignPrefixMap`, the DXCC-first priority in `resolveFlagCode`, and the sort reset on new spots in `addSpot`/`updateSpot`. Removed a redundant comment in the clear-filters handler.
