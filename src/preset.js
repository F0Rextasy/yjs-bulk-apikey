// Shared run-shape presets (operator standard v3). Explicit flags always win;
// no --preset flag => the repo's own historical defaults are untouched.
'use strict';
const PRESETS = { turbo: { conc: 5, gap: 3 }, balanced: { conc: 4, gap: 6 }, safe: { conc: 2, gap: 8 } };
function presetArgv(argv) {
  argv = argv || process.argv.slice(2);
  const h = argv.find((a) => a.startsWith('--preset='));
  return h ? h.split('=').slice(1).join('=') : null;
}
// resolvePreset({preset, conc, gap, defaultConc, defaultGap}) -> {name, conc, gap}
function resolvePreset(o) {
  o = o || {};
  const p = o.preset && PRESETS[o.preset] ? PRESETS[o.preset] : null;
  return {
    name: p ? o.preset : null,
    conc: o.conc != null ? o.conc : (p ? p.conc : (o.defaultConc != null ? o.defaultConc : null)),
    gap: o.gap != null ? o.gap : (p ? p.gap : (o.defaultGap != null ? o.defaultGap : null)),
  };
}
module.exports = { PRESETS, presetArgv, resolvePreset };
