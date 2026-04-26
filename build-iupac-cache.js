// scripts/build-iupac-cache.js
// ─────────────────────────────────────────────────────────────────────────────
// IUPAC-1: Pre-fetch IUPAC names from NIH's CACTVS service.
//
// What this does:
//   1. Reads the NAME_MAP from ../jsmol-adapter.js
//   2. Extracts every unique CACTVS query name
//   3. Fetches the IUPAC name for each from
//      https://cactus.nci.nih.gov/chemical/structure/<name>/iupac_name
//   4. Writes results to ../js/iupac-cache/manifest.js
//      (loaded at runtime as window.IUPAC_CACHE)
//
// CACTVS's name service automatically uses OPSIN (Open Parser for Systematic
// IUPAC Nomenclature) in the chain, so responses are systematic IUPAC names
// when available. Reference: https://cactus.nci.nih.gov/blog/?cat=10
//
// When to run:
//   Once, after setup (see docs/jsmol-setup.html). Re-run when NAME_MAP
//   changes. Takes about 40-80 seconds.
//
// Usage (from the repo root):
//   node scripts/build-iupac-cache.js
//
// Requirements:
//   Node 18+ (uses global fetch).
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');

const CACTVS_BASE  = 'https://cactus.nci.nih.gov/chemical/structure';
const CACHE_DIR    = path.resolve(__dirname, '..', 'js', 'iupac-cache');
const MANIFEST_JSON = path.join(CACHE_DIR, 'manifest.json');
const MANIFEST_JS   = path.join(CACHE_DIR, 'manifest.js');
const ADAPTER_PATH  = path.resolve(__dirname, '..', 'jsmol-adapter.js');
const REQUEST_DELAY_MS = 400;
const REQUEST_TIMEOUT_MS = 15000;

// ── Load NAME_MAP from adapter ────────────────────────────────────────────
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

// ── Fetch a single IUPAC name from CACTVS ─────────────────────────────────
// Returns { ok: true, name: "..." } on success, or { ok: false, error: "..." }
async function fetchIupacName(cactvsName) {
  const encoded = encodeURIComponent(cactvsName);
  const url = CACTVS_BASE + '/' + encoded + '/iupac_name';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      return { ok: false, error: 'HTTP ' + response.status };
    }
    const text = (await response.text()).trim();
    if (!text) {
      return { ok: false, error: 'Empty response' };
    }
    if (text.toLowerCase().includes('<html')) {
      return { ok: false, error: 'Got HTML instead of a name' };
    }
    // CACTVS sometimes returns multiple names separated by newlines;
    // take the first (it's usually the preferred IUPAC form)
    const firstLine = text.split(/\r?\n/)[0].trim();
    if (!firstLine) {
      return { ok: false, error: 'First line empty' };
    }
    return { ok: true, name: firstLine };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return { ok: false, error: 'Request timed out' };
    }
    return { ok: false, error: err.message || String(err) };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('Building IUPAC name cache for Lewis Structure Generator');
  console.log('========================================================\n');

  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    console.log('Created directory: ' + CACHE_DIR);
  }

  const nameMap = loadNameMap();
  const uniqueNames = Array.from(new Set(Object.values(nameMap))).sort();
  console.log('Will fetch IUPAC names for ' + uniqueNames.length + ' molecules');
  console.log('Each request paced at ' + REQUEST_DELAY_MS + 'ms.');
  console.log('Expected runtime: ~' +
    Math.ceil((uniqueNames.length * REQUEST_DELAY_MS) / 1000) + 's\n');

  // Resumable: load existing manifest if present so we can skip already-cached
  let existing = {};
  if (fs.existsSync(MANIFEST_JSON)) {
    try {
      const prev = JSON.parse(fs.readFileSync(MANIFEST_JSON, 'utf8'));
      existing = prev.cached || {};
    } catch (_) { /* start fresh */ }
  }

  const cached  = Object.assign({}, existing);
  const failures = [];
  let i = 0;
  for (const cactvsName of uniqueNames) {
    i++;
    process.stdout.write('[' + i + '/' + uniqueNames.length + '] ' + cactvsName + ' … ');

    if (cached[cactvsName]) {
      console.log('already cached (' + cached[cactvsName] + ')');
      continue;
    }

    const result = await fetchIupacName(cactvsName);
    if (result.ok) {
      cached[cactvsName] = result.name;
      console.log('OK → ' + result.name);
    } else {
      console.log('FAILED — ' + result.error);
      failures.push({ cactvsName, error: result.error });
    }

    if (i < uniqueNames.length) await sleep(REQUEST_DELAY_MS);
  }

  const manifest = {
    generated: new Date().toISOString(),
    sourceNameMap: path.relative(CACHE_DIR, ADAPTER_PATH),
    successCount: Object.keys(cached).length,
    failureCount: failures.length,
    cached: cached,
    failures: failures
  };
  fs.writeFileSync(MANIFEST_JSON, JSON.stringify(manifest, null, 2));
  console.log('\nWrote JSON manifest: ' + MANIFEST_JSON);

  // Write a sibling JS file for synchronous runtime access
  const jsBody =
    '// Auto-generated by scripts/build-iupac-cache.js — do not edit by hand.\n' +
    '// Regenerate by running: node scripts/build-iupac-cache.js\n' +
    'window.IUPAC_CACHE = ' +
    JSON.stringify(cached, null, 2) + ';\n';
  fs.writeFileSync(MANIFEST_JS, jsBody);
  console.log('Wrote JS manifest: ' + MANIFEST_JS);

  console.log('\n========================================================');
  console.log('Done. ' + Object.keys(cached).length + ' cached, ' +
              failures.length + ' failed.');
  if (failures.length > 0) {
    console.log('\nFailures (will fall back to live CACTVS at runtime):');
    for (const f of failures) {
      console.log('  - ' + f.cactvsName + ': ' + f.error);
    }
  }
  console.log('\nNext step: commit the js/iupac-cache/ directory and push.');
}

main().catch((err) => {
  console.error('\nUnexpected error:', err);
  process.exit(1);
});
