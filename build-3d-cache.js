// scripts/build-3d-cache.js
// ─────────────────────────────────────────────────────────────────────────────
// R7-2: Pre-fetch 3D structure files (SDF format) from NIH's CACTVS service.
//
// What this does:
//   1. Reads the NAME_MAP from ../jsmol-adapter.js
//   2. Extracts every unique CACTVS query name
//   3. Fetches the 3D SDF for each from https://cactus.nci.nih.gov/
//   4. Writes each response to ../js/3d-cache/<query-name>.sdf
//   5. Generates ../js/3d-cache/manifest.json listing successful fetches
//
// Why:
//   The live site prefers local SDF files over live CACTVS lookup because:
//     - local load is instant (vs. ~1-5 seconds for a network fetch)
//     - works offline once cached
//     - CACTVS has occasional downtime; local cache keeps the tool working
//
// When to run:
//   Once, after setting up JSmol per docs/jsmol-setup.html. Re-run anytime
//   the NAME_MAP changes (e.g., after adding new molecules).
//
// Usage (from the repo root):
//   node scripts/build-3d-cache.js
//
// Requirements:
//   Node 18+ (uses global fetch). The script takes ~1-2 minutes to complete
//   because it deliberately paces requests to be polite to CACTVS.
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');

// ── Configuration ──────────────────────────────────────────────────────────
const CACTVS_BASE  = 'https://cactus.nci.nih.gov/chemical/structure';
const CACHE_DIR    = path.resolve(__dirname, '..', 'js', '3d-cache');
const MANIFEST     = path.join(CACHE_DIR, 'manifest.json');
const ADAPTER_PATH = path.resolve(__dirname, '..', 'jsmol-adapter.js');
const REQUEST_DELAY_MS = 400;   // pause between requests (polite pacing)
const REQUEST_TIMEOUT_MS = 15000;

// ── Sanitize a CACTVS query name into a safe filesystem filename ──────────
// CACTVS names can contain spaces, commas, and hyphens. We keep the name
// readable while making it URL-safe and filesystem-safe on every platform.
//   "1,4-dichlorobenzene" → "1-4-dichlorobenzene.sdf"
//   "alpha-d-glucose"     → "alpha-d-glucose.sdf"
//   "silicon tetrafluoride" → "silicon-tetrafluoride.sdf"
function sanitizeForFilename(cactvsName) {
  return cactvsName
    .toLowerCase()
    .replace(/,/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '');
}

// ── Load NAME_MAP from adapter ─────────────────────────────────────────────
// jsmol-adapter.js is an IIFE that assigns to `JSMOL`. In Node, it also
// does `module.exports = JSMOL`, so we can require it directly.
function loadNameMap() {
  if (!fs.existsSync(ADAPTER_PATH)) {
    console.error('ERROR: cannot find jsmol-adapter.js at ' + ADAPTER_PATH);
    process.exit(1);
  }
  const JSMOL = require(ADAPTER_PATH);
  if (!JSMOL || !JSMOL.NAME_MAP) {
    console.error('ERROR: jsmol-adapter.js did not export NAME_MAP');
    process.exit(1);
  }
  return JSMOL.NAME_MAP;
}

// ── Fetch a single SDF from CACTVS ────────────────────────────────────────
// Returns { ok: true, sdf: "..." } on success, or { ok: false, error: "..." }
async function fetchSdf(cactvsName) {
  const encoded = encodeURIComponent(cactvsName);
  const url = CACTVS_BASE + '/' + encoded + '/file?format=sdf&get3d=true';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      return { ok: false, error: 'HTTP ' + response.status };
    }
    const text = await response.text();
    // Basic sanity check: CACTVS sometimes returns HTML error pages with 200
    if (!text || text.length < 50) {
      return { ok: false, error: 'Empty or truncated response' };
    }
    if (text.trim().startsWith('<')) {
      return { ok: false, error: 'Got HTML instead of SDF' };
    }
    // SDF files end with a $$$$ delimiter — verify we got a complete file
    if (!text.includes('$$$$')) {
      return { ok: false, error: 'Missing $$$$ delimiter (incomplete SDF)' };
    }
    return { ok: true, sdf: text };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return { ok: false, error: 'Request timed out' };
    }
    return { ok: false, error: err.message || String(err) };
  }
}

// ── Pause helper ───────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('Building 3D cache for Lewis Structure Generator');
  console.log('================================================\n');

  // Ensure cache dir exists
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    console.log('Created directory: ' + CACHE_DIR);
  }

  // Collect unique CACTVS query names
  const nameMap = loadNameMap();
  const uniqueNames = Array.from(new Set(Object.values(nameMap))).sort();
  console.log('Will fetch ' + uniqueNames.length + ' unique molecules from CACTVS');
  console.log('Each request is paced at ' + REQUEST_DELAY_MS + 'ms to be polite to the server.');
  console.log('Expected runtime: ~' +
    Math.ceil((uniqueNames.length * REQUEST_DELAY_MS) / 1000) + 's\n');

  const successes = [];
  const failures  = [];
  let i = 0;
  for (const cactvsName of uniqueNames) {
    i++;
    const filename = sanitizeForFilename(cactvsName) + '.sdf';
    const filepath = path.join(CACHE_DIR, filename);
    process.stdout.write('[' + i + '/' + uniqueNames.length + '] ' + cactvsName + ' … ');

    // Skip if already cached (allows resuming after interruption)
    if (fs.existsSync(filepath)) {
      const existing = fs.readFileSync(filepath, 'utf8');
      if (existing.includes('$$$$')) {
        console.log('already cached, skipping');
        successes.push({ cactvsName, filename });
        continue;
      }
    }

    const result = await fetchSdf(cactvsName);
    if (result.ok) {
      fs.writeFileSync(filepath, result.sdf);
      console.log('OK (' + result.sdf.length + ' bytes)');
      successes.push({ cactvsName, filename });
    } else {
      console.log('FAILED — ' + result.error);
      failures.push({ cactvsName, error: result.error });
    }

    // Polite pacing (skip on the last iteration)
    if (i < uniqueNames.length) await sleep(REQUEST_DELAY_MS);
  }

  // Write manifest (JSON — for humans and tooling)
  const manifest = {
    generated: new Date().toISOString(),
    sourceNameMap: path.relative(CACHE_DIR, ADAPTER_PATH),
    successCount: successes.length,
    failureCount: failures.length,
    cached: successes.reduce((acc, s) => {
      acc[s.cactvsName] = s.filename;
      return acc;
    }, {}),
    failures: failures
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log('\nWrote manifest: ' + MANIFEST);

  // Write a sibling JS file that the adapter can load via a regular
  // <script> tag. This gives us synchronous access to the cache list
  // at page load time, without needing an async fetch.
  const manifestJs = path.join(CACHE_DIR, 'manifest.js');
  const jsBody =
    '// Auto-generated by scripts/build-3d-cache.js — do not edit by hand.\n' +
    '// Regenerate by running: node scripts/build-3d-cache.js\n' +
    'window.JSMOL_CACHE_MANIFEST = ' +
    JSON.stringify(manifest.cached, null, 2) + ';\n';
  fs.writeFileSync(manifestJs, jsBody);
  console.log('Wrote JS manifest: ' + manifestJs);

  // Summary
  console.log('\n================================================');
  console.log('Done. ' + successes.length + ' cached, ' +
              failures.length + ' failed.');
  if (failures.length > 0) {
    console.log('\nFailures (these will still work via live CACTVS at runtime):');
    for (const f of failures) {
      console.log('  - ' + f.cactvsName + ': ' + f.error);
    }
  }
  console.log('\nNext step: commit the js/3d-cache/ directory and push to GitHub.');
}

main().catch((err) => {
  console.error('\nUnexpected error:', err);
  process.exit(1);
});
