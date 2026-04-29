2026-04-29
- Fixed flag resolution returning deprecated ISO code "fx" instead of "fr" for French stations, caused by `buildIsoNameIndex()` overwriting valid codes with obsolete ones (e.g. FX for Metropolitan France). Changed to first-match-wins so earlier, canonical codes take precedence.
- Added "yugoslavia" and "serbia and montenegro" aliases in `dxccNameAliases` pointing to "rs" (Serbia), so callsigns whose DXCC name comes from the API as a historical Yugoslavia-era string resolve to the correct Serbian flag.
- Added Serbian callsign prefixes YU, YT, and YZ to `callsignPrefixMap` mapped to "rs", so portable callsigns like YU/OK1WED/P are correctly identified as Serbian even when the DXCC field is absent or unrecognized.
