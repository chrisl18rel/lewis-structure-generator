// jsmol-adapter.js
// ─────────────────────────────────────────────────────────────────────────────
// R7-1: JSmol 3D viewer adapter.
//
// Lifecycle:
//   1. When the user clicks "View in 3D", controller calls JSMOL.show(molecule, targetId)
//   2. Adapter resolves the molecule to a CACTVS-compatible query name
//   3. Adapter creates (or reuses) a JSmol applet inside the target container
//   4. Adapter issues "load $<name>" — CACTVS fetches the 3D structure
//
// Resolution strategy:
//   1. If molecule matches a known engine-input → use the name-table mapping
//   2. Otherwise, use the bare formula/input as the CACTVS query
//
// External dependencies (vendored under /js/):
//   - jQuery (hard requirement for JSmol)
//   - JSmol.min.nojq.js plus the j2s/ assets directory
//
// If JSmol isn't loaded (user hasn't vendored the library yet), the adapter
// surfaces a clean "JSmol library not installed — see docs/jsmol-setup.md"
// message instead of crashing.
// ─────────────────────────────────────────────────────────────────────────────

const JSMOL = (function () {

  // ── Name-to-CACTVS-query mapping ─────────────────────────────────────────
  // Maps the user's engine-recognized input (or a recognized engine output
  // like normalizedFormula) to a CACTVS query string that reliably returns
  // a 3D model. CACTVS accepts common chemical names, SMILES, and InChI —
  // we prefer common names because they're most reliable.
  //
  // Every entry corresponds to a molecule the engine can produce. Entries
  // are keyed by a canonical form (lowercase, whitespace stripped, hyphens
  // and commas removed) so lookup is robust to user-typed variation.
  const NAME_MAP = {
    // ── Main tab: simple molecules (Worksheet #1 Group A) ──────────────
    'ch4':          'methane',
    'nh3':          'ammonia',
    'h2o':          'water',
    'sif4':         'silicon tetrafluoride',
    'ncl3':         'nitrogen trichloride',

    // ── Main tab: multiple bonds (Worksheet #1 Group C) ────────────────
    'h2co':         'formaldehyde',
    'hcn':          'hydrogen cyanide',
    'co':           'carbon monoxide',
    'co2':          'carbon dioxide',

    // ── Main tab: incomplete octets (Worksheet #1 Group D) ─────────────
    'bcl3':         'boron trichloride',
    'bef2':         'beryllium fluoride',

    // ── Main tab: expanded octets (Worksheet #1 Group E) ───────────────
    'sf6':          'sulfur hexafluoride',
    'clf3':         'chlorine trifluoride',
    'xef4':         'xenon tetrafluoride',

    // ── Main tab: multiple central atoms (Worksheet #1 Group F) ────────
    'c2h6':         'ethane',
    'c3h8':         'propane',
    'c2h5oh':       'ethanol',
    'ch3ch2oh':     'ethanol',
    'c2h4':         'ethylene',
    'c2f2':         'difluoroacetylene',
    'pcl5':         'phosphorus pentachloride',
    'brf5':         'bromine pentafluoride',

    // ── Worksheet #2 molecules ─────────────────────────────────────────
    'br2':          'bromine',
    'bh3':          'borane',
    'o2':           'oxygen',
    'h2cs':         'thioformaldehyde',
    'chcl3':        'chloroform',
    'sf2':          'sulfur difluoride',
    'shf':          'sulfur hypofluorite',     // CACTVS may not have this
    'n2f4':         'tetrafluorohydrazine',
    'xeo4':         'xenon tetroxide',
    'n2o3':         'dinitrogen trioxide',
    'no2':          'nitrogen dioxide',
    'n2o4':         'dinitrogen tetroxide',
    'n2o5':         'dinitrogen pentoxide',
    'n2o':          'nitrous oxide',

    // ── Worksheet #3 molecules ─────────────────────────────────────────
    'bf3':          'boron trifluoride',
    'ccl4':         'carbon tetrachloride',
    'h2s':          'hydrogen sulfide',
    'pf5':          'phosphorus pentafluoride',
    'sf4':          'sulfur tetrafluoride',
    'icl3':         'iodine trichloride',
    'xef2':         'xenon difluoride',
    'clf5':         'chlorine pentafluoride',

    // ── Covalent worksheet additions ───────────────────────────────────
    'ch3br':        'bromomethane',
    'pcl3':         'phosphorus trichloride',
    'gacl3':        'gallium trichloride',
    'hf':           'hydrogen fluoride',
    'cbr4':         'carbon tetrabromide',
    'sicl4':        'silicon tetrachloride',
    'hocl':         'hypochlorous acid',
    'asf3':         'arsenic trifluoride',

    // ── Polyatomic ions ────────────────────────────────────────────────
    'po4{-3}':      'phosphate',
    'po4{3-}':      'phosphate',
    'clo3{-1}':     'chlorate',
    'clo3{-}':      'chlorate',
    'clo4{-1}':     'perchlorate',
    'clo4{-}':      'perchlorate',
    'so3{-2}':      'sulfite',
    'so3{2-}':      'sulfite',
    'ps3{-1}':      'trithiophosphite',     // CACTVS may not have this
    'cho2{-1}':     'formate',
    'cho2{-}':      'formate',
    'hcoo{-1}':     'formate',
    'cno{-1}':      'cyanate',
    'cno{-}':       'cyanate',
    'no2{-1}':      'nitrite',
    'no2{-}':       'nitrite',
    'h3o{+1}':      'hydronium',
    'h3o{+}':       'hydronium',
    'no3{-1}':      'nitrate',
    'no3{-}':       'nitrate',

    // ── Rings: R5 ──────────────────────────────────────────────────────
    'benzene':      'benzene',
    'c6h6':         'benzene',
    'cyclohexane':  'cyclohexane',
    'c6h12':        'cyclohexane',
    'cyclopentane': 'cyclopentane',
    'c5h10':        'cyclopentane',
    'cyclobutane':  'cyclobutane',
    'c4h8':         'cyclobutane',
    'cyclopropane': 'cyclopropane',
    'c3h6':         'cyclopropane',
    'cyclopentene': 'cyclopentene',
    'c5h8':         'cyclopentene',
    'cyclohexene':  'cyclohexene',
    'c6h10':        'cyclohexene',

    // ── Rings: R6a monosubstituted aromatics ───────────────────────────
    'phenol':       'phenol',
    'c6h5oh':       'phenol',
    'toluene':      'toluene',
    'c6h5ch3':      'toluene',
    'aniline':      'aniline',
    'c6h5nh2':      'aniline',
    'benzoicacid':  'benzoic acid',
    'c6h5cooh':     'benzoic acid',
    'benzaldehyde': 'benzaldehyde',
    'c6h5cho':      'benzaldehyde',
    'chlorobenzene':'chlorobenzene',
    'c6h5cl':       'chlorobenzene',
    'bromobenzene': 'bromobenzene',
    'c6h5br':       'bromobenzene',
    'fluorobenzene':'fluorobenzene',
    'c6h5f':        'fluorobenzene',
    'iodobenzene':  'iodobenzene',
    'c6h5i':        'iodobenzene',
    'nitrobenzene': 'nitrobenzene',
    'c6h5no2':      'nitrobenzene',

    // ── Rings: R6b disubstituted aromatics ─────────────────────────────
    'oxylene':      'o-xylene',
    'mxylene':      'm-xylene',
    'pxylene':      'p-xylene',
    'ocresol':      '2-methylphenol',
    'mcresol':      '3-methylphenol',
    'pcresol':      '4-methylphenol',
    'odichlorobenzene': '1,2-dichlorobenzene',
    'mdichlorobenzene': '1,3-dichlorobenzene',
    'pdichlorobenzene': '1,4-dichlorobenzene',
    'odibromobenzene':  '1,2-dibromobenzene',
    'pdibromobenzene':  '1,4-dibromobenzene',
    'odinitrobenzene':  '1,2-dinitrobenzene',
    'mdinitrobenzene':  '1,3-dinitrobenzene',
    'pdinitrobenzene':  '1,4-dinitrobenzene',
    // Also accept "1,N-" numeric prefix forms (normalize strips the comma/hyphen)
    '12dichlorobenzene': '1,2-dichlorobenzene',
    '13dichlorobenzene': '1,3-dichlorobenzene',
    '14dichlorobenzene': '1,4-dichlorobenzene',
    '12dibromobenzene':  '1,2-dibromobenzene',
    '14dibromobenzene':  '1,4-dibromobenzene',
    '12dinitrobenzene':  '1,2-dinitrobenzene',
    '13dinitrobenzene':  '1,3-dinitrobenzene',
    '14dinitrobenzene':  '1,4-dinitrobenzene',
    // Xylenes with numeric prefixes (the engine also accepts these)
    '12xylene': 'o-xylene',
    '13xylene': 'm-xylene',
    '14xylene': 'p-xylene',

    // ── Rings: R6c heterocycles ────────────────────────────────────────
    'pyridine':     'pyridine',
    'c5h5n':        'pyridine',
    'pyrrole':      'pyrrole',
    'c4h5n':        'pyrrole',
    'c4h4nh':       'pyrrole',
    'furan':        'furan',
    'c4h4o':        'furan',
    'thiophene':    'thiophene',
    'c4h4s':        'thiophene',

    // ── Rings: R6d sugars ──────────────────────────────────────────────
    // CACTVS accepts several glucose names; "alpha-d-glucose" and
    // "beta-d-glucose" return the correct pyranose anomer. Plain
    // "glucose" falls back to the α anomer per our R6d convention.
    'glucose':        'alpha-d-glucose',
    'alphaglucose':   'alpha-d-glucose',
    'αglucose':       'alpha-d-glucose',
    'aglucose':       'alpha-d-glucose',
    'alphadglucose':  'alpha-d-glucose',
    'αdglucose':      'alpha-d-glucose',
    'betaglucose':    'beta-d-glucose',
    'βglucose':       'beta-d-glucose',
    'bglucose':       'beta-d-glucose',
    'betadglucose':   'beta-d-glucose',
    'βdglucose':      'beta-d-glucose'
  };

  // Normalize user input for lookup: lowercase, strip whitespace/hyphens/commas.
  // Preserves curly-brace charge notation (e.g., "SO4{-2}") because the
  // minus sign inside {} is part of the charge and must not be stripped.
  // Strategy: extract brace groups, normalize the rest, then reattach.
  function _normalizeKey(raw) {
    if (!raw) return '';
    const s = String(raw);
    // Split into segments: text outside braces (to be stripped) and
    // brace-delimited pieces (preserved intact for charge notation).
    let out = '';
    let i = 0;
    while (i < s.length) {
      if (s[i] === '{') {
        const end = s.indexOf('}', i);
        if (end === -1) {
          // Unmatched brace — just strip as usual
          out += s.slice(i).replace(/[\s\-,]+/g, '').toLowerCase();
          break;
        }
        out += s.slice(i, end + 1).toLowerCase();
        i = end + 1;
      } else {
        // Find the next brace or end
        const next = s.indexOf('{', i);
        const seg = (next === -1) ? s.slice(i) : s.slice(i, next);
        out += seg.replace(/[\s\-,]+/g, '').toLowerCase();
        i = (next === -1) ? s.length : next;
      }
    }
    return out;
  }

  // Look up a CACTVS query name for a given input. Returns the mapped
  // name if found; otherwise returns null. Callers can treat null as
  // "not in the table, fall back to bare CACTVS lookup."
  function lookupName(userInput) {
    const key = _normalizeKey(userInput);
    return NAME_MAP[key] || null;
  }

  // ── Local cache lookup (R7-2) ────────────────────────────────────────────
  // The build script (scripts/build-3d-cache.js) pre-fetches SDF files for
  // every unique CACTVS name and writes them to js/3d-cache/<filename>.sdf.
  // It also writes js/3d-cache/manifest.js which assigns
  // window.JSMOL_CACHE_MANIFEST = { "<cactvs-name>": "<filename>", ... }.
  //
  // When the adapter needs to load a molecule, it checks this manifest
  // first. If the molecule is cached, JSmol loads the local file (fast,
  // works offline). If not, the adapter falls back to live CACTVS lookup.
  const CACHE_BASE_PATH = 'js/3d-cache/';

  // Returns the local file path for a CACTVS name if cached, else null.
  function _cachedFilePath(cactvsName) {
    if (typeof window === 'undefined') return null;
    const manifest = window.JSMOL_CACHE_MANIFEST;
    if (!manifest || typeof manifest !== 'object') return null;
    const filename = manifest[cactvsName];
    if (!filename) return null;
    return CACHE_BASE_PATH + filename;
  }

  // Returns true if the given CACTVS name has a locally cached SDF.
  function hasCachedSdf(cactvsName) {
    return _cachedFilePath(cactvsName) !== null;
  }

  // ── JSmol applet tracking ────────────────────────────────────────────────
  // We create one JSmol applet per container (main tab + rings tab each get
  // their own). Applets are created lazily the first time the user clicks
  // "View in 3D", then reused for subsequent loads.
  const _applets = {};

  // Check if JSmol library is loaded (the Jmol global is set by JSmol.min).
  function isJsmolAvailable() {
    return (typeof Jmol !== 'undefined') &&
           (typeof Jmol.getApplet === 'function');
  }

  // Check if jQuery is loaded (required by JSmol).
  function isJqueryAvailable() {
    return (typeof jQuery !== 'undefined');
  }

  // Create or return the existing JSmol applet for a given container id.
  // The container MUST exist in the DOM before this is called.
  function _getOrCreateApplet(containerId) {
    if (_applets[containerId]) return _applets[containerId];
    if (!isJsmolAvailable()) return null;

    // Minimal JSmol info object. "use: HTML5" uses the JS-only renderer
    // (no Java plugin needed). j2sPath points to the vendored assets.
    const info = {
      width:  700,
      height: 500,
      color:  '#ffffff',
      use:    'HTML5',
      j2sPath: 'js/JSmol/j2s',
      script:  'background white; set antialiasDisplay true; ' +
               'set showHydrogens true; set showUnitcell false;',
      serverURL: 'https://chemapps.stolaf.edu/jmol/jsmol/php/jsmol.php',
      disableInitialConsole: true,
      disableJ2SLoadMonitor: true
    };

    const applet = Jmol.getApplet('jmol_' + containerId, info);
    _applets[containerId] = applet;

    // JSmol puts its HTML inside the container via its own mechanism —
    // we need to inject it manually because we're not using Jmol.getAppletHtml.
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = Jmol.getAppletHtml(applet);
    }

    return applet;
  }

  // Issue a load command to the given applet with the resolved query string.
  // CACTVS handles the 3D-structure lookup; JSmol just renders the result.
  function _loadIntoApplet(applet, cactvsQuery, useCached, localPath) {
    if (!applet) return;
    // When loading a local SDF file, we quote the path directly. When
    // loading from CACTVS, we prefix with $ which tells JSmol to call out
    // to the CACTVS service for structure-by-name lookup.
    const source = useCached
      ? '"' + localPath + '"'
      : '"$' + cactvsQuery + '"';
    const script =
      'load ' + source + '; ' +
      'select all; spacefill 23%; wireframe 0.15; ' +
      'color cpk; zoom 80; rotate best;';
    Jmol.script(applet, script);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  // show(userInput, containerId, statusElId, structure)
  //   userInput:   the raw string the user entered (e.g., "phenol", "C6H5OH")
  //   containerId: DOM id of the div that should host the JSmol applet
  //   statusElId:  DOM id of a status text span (optional; used for errors)
  //   structure:   the parsed structure object (optional; used to detect
  //                ionic compounds and skip 3D in that case)
  function show(userInput, containerId, statusElId, structure) {
    const statusEl = statusElId ? document.getElementById(statusElId) : null;
    const setStatus = (html) => {
      if (!statusEl) return;
      // Use innerHTML so we can inject the spinner element
      statusEl.innerHTML = html || '';
    };
    const spinnerHtml =
      '<span class="jsmol-spinner" style="display:inline-block; width:12px; ' +
      'height:12px; border:2px solid var(--border, #444); border-top-color:var(--accent, #4a9eff); ' +
      'border-radius:50%; animation:jsmol-spin 0.9s linear infinite; ' +
      'vertical-align:middle; margin-right:8px;"></span>';

    // Guard: ionic compounds don't have well-defined "molecules" in 3D —
    // they're crystal lattices. Skip.
    if (structure && structure.isIonic) {
      setStatus('3D view isn\'t meaningful for ionic compounds (they form lattices, not discrete molecules).');
      return;
    }

    // Guard: JSmol library not vendored yet
    if (!isJqueryAvailable()) {
      setStatus('3D viewer needs jQuery — see docs/jsmol-setup.html for setup.');
      return;
    }
    if (!isJsmolAvailable()) {
      setStatus('3D viewer library (JSmol) isn\'t installed yet — see docs/jsmol-setup.html.');
      return;
    }

    // Resolve: try name table first, fall back to raw input
    const mappedName = lookupName(userInput);
    const cactvsQuery = mappedName || userInput;

    // R7-3: polyatomic ions sometimes render weirdly from CACTVS (bonds
    // may be missing or the charge may not display). Flag this upfront
    // so students understand the 3D view might not be as clean as for
    // a neutral molecule.
    const isPolyatomicIon = !!(structure && structure.isIon);
    const ionNote = isPolyatomicIon
      ? ' (note: 3D polyatomic ions sometimes render with incomplete bonding)'
      : '';

    // R7-2: prefer the local SDF cache when available.
    const localPath = _cachedFilePath(cactvsQuery);
    const useCached = localPath !== null;

    // Initial status with spinner
    if (useCached) {
      setStatus(spinnerHtml + 'Loading cached 3D model for "' + _escapeHtml(cactvsQuery) + '"…' + ionNote);
    } else if (mappedName) {
      setStatus(spinnerHtml + 'Loading 3D model for "' + _escapeHtml(mappedName) + '" from CACTVS…' + ionNote);
    } else {
      setStatus(spinnerHtml + 'Looking up "' + _escapeHtml(userInput) + '" via CACTVS (may fail for unusual inputs)…' + ionNote);
    }

    // Create or reuse applet, then load
    try {
      const applet = _getOrCreateApplet(containerId);
      if (!applet) {
        setStatus('Could not create 3D viewer — check browser console.');
        return;
      }
      _loadIntoApplet(applet, cactvsQuery, useCached, localPath);

      // R7-3: verify the load actually produced atoms. JSmol's `evaluate()`
      // returns the atom count of the loaded model; 0 (or a script error)
      // means the load failed. We check after a delay because JSmol is
      // async — even local file loads take a moment.
      //
      // If a cached load fails (stale manifest, missing file), fall back
      // to live CACTVS. If the live CACTVS load also fails, show a final
      // error message.
      _verifyLoadSucceeded(applet, useCached ? 1500 : 4000).then((atomCount) => {
        if (atomCount > 0) {
          // Success. Clear status.
          setStatus('');
        } else if (useCached) {
          // Cache miss (stale manifest or 404 on the SDF file). Retry
          // with live CACTVS as a graceful fallback.
          setStatus(spinnerHtml + 'Cached file didn\'t load; retrying via CACTVS…' + ionNote);
          _loadIntoApplet(applet, cactvsQuery, false, null);
          _verifyLoadSucceeded(applet, 4000).then((retryAtomCount) => {
            if (retryAtomCount > 0) {
              setStatus('');
            } else {
              setStatus('3D model could not be loaded for "' +
                _escapeHtml(cactvsQuery) + '" — CACTVS may not have this structure.');
            }
          });
        } else {
          // Live CACTVS load failed outright
          setStatus('3D model could not be loaded for "' +
            _escapeHtml(cactvsQuery) + '" — CACTVS may not have this structure.');
        }
      });
    } catch (e) {
      setStatus('3D viewer error: ' + _escapeHtml(e.message || String(e)));
    }
  }

  // R7-3: poll the applet until a load finishes (or time out). JSmol's
  // evaluate() call is synchronous against the applet's current model
  // state, so we poll every 150ms until atoms appear or the timeout hits.
  //
  // Returns a promise that resolves to the atom count (0 = load failed).
  function _verifyLoadSucceeded(applet, timeoutMs) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const pollInterval = 150;
      const tick = () => {
        let atomCount = 0;
        try {
          // {*}.length in JSmol syntax = number of atoms in the selected set
          const result = Jmol.evaluateVar(applet, '{*}.length');
          atomCount = parseInt(result, 10) || 0;
        } catch (e) {
          atomCount = 0;
        }
        if (atomCount > 0) {
          resolve(atomCount);
          return;
        }
        if (Date.now() - startTime >= timeoutMs) {
          resolve(0);
          return;
        }
        setTimeout(tick, pollInterval);
      };
      // Give JSmol a moment before the first check
      setTimeout(tick, 300);
    });
  }

  // Safe HTML escape for status messages that include user input.
  function _escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Hide the 3D viewer. Doesn't destroy the applet — a subsequent show()
  // will reuse it.
  function hide(containerId) {
    // Nothing to do for JSmol; just hiding the wrapper in the DOM is enough.
    // Exposed here in case we need to pause animations or clear state later.
  }

  // Return true if the given userInput is recognized in the name table.
  // Used by the UI to decide whether to enable the "View in 3D" button.
  // Ad-hoc inputs still get the button (per A4: attempt bare CACTVS lookup).
  function hasKnownName(userInput) {
    return lookupName(userInput) !== null;
  }

  return {
    show,
    hide,
    lookupName,
    hasKnownName,
    hasCachedSdf,      // R7-2: check if a CACTVS name has a local cache hit
    isJsmolAvailable,
    isJqueryAvailable,
    _normalizeKey,     // exported for tests
    _cachedFilePath,   // exported for tests
    NAME_MAP           // exported for tests
  };
})();

// Expose for Node-based unit tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = JSMOL;
}
