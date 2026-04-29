2026-04-29

- Fixed flag resolution returning deprecated ISO codes (e.g. "fx" for France, "cs" for Serbia) caused by `buildIsoNameIndex()` iterating retired ISO 3166-1 codes that collide with current ones. Added an explicit blocklist of deprecated codes (AN, BU, CS, DD, FX, NT, SU, TP, YU, ZR) so they are skipped during index construction.
- Added "yugoslavia" and "serbia and montenegro" aliases in `dxccNameAliases` pointing to "rs" (Serbia), so callsigns whose DXCC name comes from the API as a historical Yugoslavia-era string resolve to the correct Serbian flag.
- Added Serbian callsign prefixes YU, YT, and YZ to `callsignPrefixMap` mapped to "rs", so portable callsigns like YU/OK1WED/P are correctly identified as Serbian even when the DXCC field is absent or unrecognized.
- Added South Korean callsign prefixes HL, DS, 6K, 6L, 6M, and 6N to `callsignPrefixMap` mapped to "kr", so callsigns like DS2MGT display the correct South Korean flag.
