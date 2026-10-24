'use strict';
/**
 * solver.js — the locked captcha entry point of the family contract.
 *
 * yjs's rail is HTTP-only: signup and verification are `/api/...` calls, and the
 * pinned engine refuses to run at all when the panel reports
 * `turnstile_check=true` ("this panel needs the browser mint; aborting"), so no
 * run of this tool has ever needed a token. `--auto` is the default and needs no
 * solver: there is nothing to solve here.
 *
 * A silent no-op would be a lie, so this module answers truthfully instead:
 * `solverState()` is what `--help` prints, and `solveCaptcha()` fails loudly with
 * the exact piece a panel would have to grow first. No browser is bundled.
 */
const SITE = 'https://api.yjs.im';
const SITEKEY = '';

function solverState() {
  return `no captcha on this rail (HTTP signup at ${SITE}) — --auto needs no token`;
}

async function solveCaptcha({ type = 'turnstile', sitekey = '', url = '', proxy = null } = {}) {
  throw new Error(
    `solveCaptcha: ${SITE} has no captcha (turnstile_check=false) — ${type} is not part of this rail` +
      `${sitekey ? ` (asked for sitekey ${sitekey})` : ''}${url ? ` (asked for ${url})` : ''}${proxy ? ` via ${label(proxy)}` : ''}`
  );
}

const label = (p) => (typeof p === 'string' ? p : p && p.host ? `${p.protocol || 'http'}://${p.host}:${p.port}` : '(direct)');

module.exports = { solveCaptcha, solverState, SITE, SITEKEY };
