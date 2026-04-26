// lewis-vsepr.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 top-level controller.
// Wires sidebar events, runs the formula parser, and displays a parse-check
// stub on the canvas so we can verify input handling before chemistry logic
// is added in Phase 2+.
// ─────────────────────────────────────────────────────────────────────────────

const LV_STATE = {
  bondType:     'auto',          // 'auto' | 'covalent' | 'ionic'
  atomColor:    '#1a1a2e',
  bondColor:    '#1a1a2e',
  dotColor:     '#1a1a2e',
  dotSize:      4.5,
  fontSize:     24,
  zoom:         1.0,
  showLonePairs:      true,
  showFormalCharges:  true,
  showIupacName:      true,      // IUPAC-1: show IUPAC name under Lewis canvas
  transparentBg:      false,
  activeTab:          'molecules',   // 'molecules' | 'rings'
  lastParse:          null,
  lastStructure:      null,
  lastIonic:          null,
  lastResonance:      null,
  lastVSEPR:          null,
  lastPolarity:       null,
  lastIMF:            null
};

document.addEventListener('DOMContentLoaded', () => {
  initBondTypeButtons();
  initExampleButtons();
  initGenerateButton();
  initColorSwatches();
  initSliders();
  initToggles();
  initExportButton();
  initCopyBreakdownButton();
  initCopyIupacButtons();
  initTabs();

  // R8 item 8: restore active tab from localStorage (if present).
  // Must run AFTER initTabs() so the tab buttons exist and can be toggled.
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('lv_activeTab');
      if (saved === 'rings' || saved === 'molecules') {
        setActiveTab(saved);
      }
    }
  } catch (_) { /* ignore */ }

  // Initial blank canvas message
  drawPlaceholderOnCanvas();
});

// ── Tab strip ───────────────────────────────────────────────────────────
// Switches between the Molecules & Ions tab (v1.0 functionality) and the
// Ring Structures tab (placeholder until Phase R5). Keeps state in
// LV_STATE.activeTab so other code can branch on it.
function initTabs() {
  const btns = document.querySelectorAll('.tab-btn[data-tab]');
  btns.forEach(b => {
    b.addEventListener('click', () => setActiveTab(b.dataset.tab));
  });
}

function setActiveTab(tabName) {
  if (tabName !== 'molecules' && tabName !== 'rings') return;
  LV_STATE.activeTab = tabName;

  // R8 item 8: remember the user's choice across reloads. Wrapped in
  // try/catch because localStorage can throw in sandboxed contexts or
  // when disk is full.
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('lv_activeTab', tabName);
    }
  } catch (_) { /* ignore */ }

  // Button state + ARIA
  document.querySelectorAll('.tab-btn[data-tab]').forEach(b => {
    const active = b.dataset.tab === tabName;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  // Panel visibility
  const molPanel  = document.getElementById('tab-panel-molecules');
  const ringPanel = document.getElementById('tab-panel-rings');
  if (molPanel)  molPanel.style.display  = (tabName === 'molecules') ? '' : 'none';
  if (ringPanel) ringPanel.style.display = (tabName === 'rings')     ? '' : 'none';

  // Update the sidebar input to reflect the active tab's context.
  // On the Rings tab, the input accepts ring formulas like C6H6 or named
  // compounds like "benzene". Hide the "Compound type" buttons since they
  // don't apply to rings.
  const formulaInput = document.getElementById('formula-input');
  const miniNote     = document.querySelector('.controls-panel .mini-note');
  const compoundTypeLabel = _findCompoundTypeLabel();
  const bondTypeGrids     = _findBondTypeGrids();

  if (tabName === 'rings') {
    if (formulaInput) {
      formulaInput.placeholder = 'e.g. benzene, phenol, p-xylene, pyridine, glucose';
    }
    if (miniNote) {
      miniNote.innerHTML =
        '<strong>Unsubstituted:</strong> <code>C3H6</code>, <code>C4H8</code>, <code>C5H10</code>, ' +
        '<code>C6H12</code>, <code>C5H8</code>, <code>C6H10</code>, <code>C6H6</code>. ' +
        'Names: <code>cyclopropane</code>, <code>cyclobutane</code>, <code>cyclopentane</code>, ' +
        '<code>cyclohexane</code>, <code>cyclopentene</code>, <code>cyclohexene</code>, <code>benzene</code>.<br>' +
        '<strong>Monosubstituted benzenes:</strong> <code>C6H5X</code> or <code>C6H5-X</code> ' +
        '(X = OH, CH3, NH2, COOH, CHO, Cl, Br, F, I, NO2). ' +
        'Names: <code>phenol</code>, <code>toluene</code>, <code>aniline</code>, ' +
        '<code>benzoic acid</code>, <code>benzaldehyde</code>, <code>chlorobenzene</code>, ' +
        '<code>bromobenzene</code>, <code>fluorobenzene</code>, <code>iodobenzene</code>, ' +
        '<code>nitrobenzene</code>.<br>' +
        '<strong>Disubstituted benzenes:</strong> prefix with <code>o-</code>, <code>m-</code>, <code>p-</code> ' +
        'or <code>1,2-</code>, <code>1,3-</code>, <code>1,4-</code> plus the base name. ' +
        'Examples: <code>o-xylene</code>, <code>p-dichlorobenzene</code>, ' +
        '<code>1,4-dinitrobenzene</code>, <code>m-cresol</code>, ' +
        '<code>p-dibromobenzene</code>.<br>' +
        '<strong>Heterocycles:</strong> <code>pyridine</code> (C5H5N), <code>pyrrole</code> (C4H5N), ' +
        '<code>furan</code> (C4H4O), <code>thiophene</code> (C4H4S).<br>' +
        '<strong>Sugars:</strong> <code>glucose</code>, <code>alpha-glucose</code> / <code>α-glucose</code>, ' +
        '<code>beta-glucose</code> / <code>β-glucose</code> (flat Lewis view; Haworth projection coming soon).';
    }
    if (compoundTypeLabel) compoundTypeLabel.style.display = 'none';
    bondTypeGrids.forEach(g => g.style.display = 'none');
  } else {
    if (formulaInput) {
      formulaInput.placeholder = 'e.g. H2O, NH4{+1}, NO3{-1}, Ca(OH)2, Li3N';
    }
    if (miniNote) {
      miniNote.innerHTML =
        'Charge: <code>{+1}</code>, <code>{-1}</code>, <code>^+</code>, <code>2+</code>, <code>+</code>.<br>' +
        'Groups: <code>Ca(OH)2</code>, <code>Mg(NO3)2</code>, <code>Al2(SO4)3</code>.';
    }
    if (compoundTypeLabel) compoundTypeLabel.style.display = '';
    bondTypeGrids.forEach(g => g.style.display = '');
  }
}

// Helpers — find the "Compound type" label and its two button rows.
// These sit immediately above the Generate button in the sidebar.
function _findCompoundTypeLabel() {
  const labels = document.querySelectorAll('.controls-panel label');
  for (const l of labels) {
    if (l.textContent.trim() === 'Compound type') return l;
  }
  return null;
}
function _findBondTypeGrids() {
  // Both `.two-col` rows inside the Substance Input group contain the
  // Auto/Covalent/Ionic buttons. We grab them by querying for the buttons.
  const buttons = document.querySelectorAll('[data-bond-type]');
  const grids = new Set();
  buttons.forEach(btn => {
    const parent = btn.closest('.two-col');
    if (parent) grids.add(parent);
  });
  return [...grids];
}

// ── Bond type radio-style buttons ────────────────────────────────────────
function initBondTypeButtons() {
  const btns = document.querySelectorAll('[data-bond-type]');
  btns.forEach(b => {
    b.addEventListener('click', () => {
      btns.forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      LV_STATE.bondType = b.dataset.bondType;
      // If we already parsed something, re-parse with new override.
      if (LV_STATE.lastParse) runGeneration();
    });
  });
}

// ── Example quick-pick buttons ───────────────────────────────────────────
function initExampleButtons() {
  document.querySelectorAll('.example-btn').forEach(b => {
    b.addEventListener('click', () => {
      // R8 item 10: some examples belong to a specific tab (e.g., benzene
      // goes to the rings tab). If the button has a data-tab attribute,
      // switch to that tab before running.
      const targetTab = b.dataset.tab;
      if (targetTab && (targetTab === 'molecules' || targetTab === 'rings') &&
          targetTab !== LV_STATE.activeTab) {
        setActiveTab(targetTab);
      }
      document.getElementById('formula-input').value = b.dataset.formula;
      runGeneration();
    });
  });
}

// ── Generate button + Enter key ──────────────────────────────────────────
function initGenerateButton() {
  document.getElementById('btn-generate').addEventListener('click', runGeneration);
  document.getElementById('formula-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); runGeneration(); }
  });
}

// ── Color swatches → open HSB picker ─────────────────────────────────────
function initColorSwatches() {
  const atomBtn = document.getElementById('atom-color-btn');
  const bondBtn = document.getElementById('bond-color-btn');
  const dotBtn  = document.getElementById('dot-color-btn');

  // Initial swatch colors reflect state
  atomBtn.style.background = LV_STATE.atomColor;
  bondBtn.style.background = LV_STATE.bondColor;
  dotBtn.style.background  = LV_STATE.dotColor;

  atomBtn.addEventListener('click', () => {
    openColorPicker(atomBtn, LV_STATE.atomColor, hex => {
      LV_STATE.atomColor = hex; redrawCurrent();
    });
  });
  bondBtn.addEventListener('click', () => {
    openColorPicker(bondBtn, LV_STATE.bondColor, hex => {
      LV_STATE.bondColor = hex; redrawCurrent();
    });
  });
  dotBtn.addEventListener('click', () => {
    openColorPicker(dotBtn, LV_STATE.dotColor, hex => {
      LV_STATE.dotColor = hex; redrawCurrent();
    });
  });
}

// ── Sliders ──────────────────────────────────────────────────────────────
function initSliders() {
  bindSliderWithInput('dot-size-range',  'dot-size-num',  () => {
    LV_STATE.dotSize = numVal('dot-size-num', 4.5); redrawCurrent();
  });
  bindSliderWithInput('font-size-range', 'font-size-num', () => {
    LV_STATE.fontSize = numVal('font-size-num', 24); redrawCurrent();
  });
  bindSliderWithInput('zoom-range', 'zoom-num', () => {
    LV_STATE.zoom = numVal('zoom-num', 1); redrawCurrent();
  });
}

// ── Toggles ──────────────────────────────────────────────────────────────
function initToggles() {
  document.getElementById('toggle-lone-pairs').addEventListener('change', e => {
    LV_STATE.showLonePairs = e.target.checked; redrawCurrent();
  });
  document.getElementById('toggle-formal-charges').addEventListener('change', e => {
    LV_STATE.showFormalCharges = e.target.checked; redrawCurrent();
  });
  const iupacToggle = document.getElementById('toggle-iupac-name');
  if (iupacToggle) {
    iupacToggle.addEventListener('change', e => {
      LV_STATE.showIupacName = e.target.checked;
      _updateIupacDisplay();
    });
  }
  document.getElementById('toggle-transparent-bg').addEventListener('change', e => {
    LV_STATE.transparentBg = e.target.checked;
    updateBgClass('lewis-canvas-wrap', LV_STATE.transparentBg);
    updateBgClass('vsepr-canvas-wrap', LV_STATE.transparentBg);
  });

  // Breakdown section toggles — control visibility
  ['lewis','vsepr','imf','polarity'].forEach(key => {
    const el = document.getElementById(`toggle-show-${key}-breakdown`);
    if (!el) return;
    el.addEventListener('change', () => updateBreakdownVisibility());
  });
}

function updateBreakdownVisibility() {
  const map = {
    'lewis':    'breakdown-lewis',
    'vsepr':    'breakdown-vsepr',
    'imf':      'breakdown-imf',
    'polarity': 'breakdown-polarity'
  };
  Object.keys(map).forEach(key => {
    const sec = document.getElementById(map[key]);
    if (!sec) return;
    const toggle = document.getElementById(`toggle-show-${key}-breakdown`);
    const wantShow = toggle ? toggle.checked : true;
    // Only show if there's content AND the toggle is on
    const hasContent = sec.innerHTML.trim().length > 0;
    sec.style.display = (wantShow && hasContent) ? '' : 'none';
  });

  // Resonance section follows the Lewis toggle (no separate toggle).
  const resSec = document.getElementById('breakdown-resonance');
  if (resSec) {
    const lewisToggle = document.getElementById('toggle-show-lewis-breakdown');
    const wantShow    = lewisToggle ? lewisToggle.checked : true;
    const hasContent  = resSec.innerHTML.trim().length > 0;
    resSec.style.display = (wantShow && hasContent) ? '' : 'none';
  }
}

// ── Export PNG stub ──────────────────────────────────────────────────────
// ── Export PNG ───────────────────────────────────────────────────────────
// Stitches the Lewis canvas on top of the VSEPR canvas (when applicable) so a
// single PNG captures both drawings. When only the Lewis canvas has content
// (ionic compounds, single atoms, error state), exports that alone.
function initExportButton() {
  document.getElementById('btn-export-png').addEventListener('click', () => {
    try {
      const exportData = _gatherExportCanvases();
      if (!exportData || !exportData.lewisCanvas) {
        showToast('Nothing to export — generate a structure first.', true);
        return;
      }
      const png = _composeExportPng(exportData);
      const a = document.createElement('a');
      a.download = _exportFilename() + '.png';
      a.href = png;
      a.click();
    } catch (err) {
      showToast('Export failed: ' + err.message, true);
    }
  });
}

// R8 item 2/4/7: gather all canvases that belong in the export for the
// currently-active tab. Returns an object with the main Lewis canvas, the
// VSEPR canvas (if visible), the resonance strip (if visible), and an
// optional IUPAC name string.
function _gatherExportCanvases() {
  const isRings = (LV_STATE.activeTab === 'rings');
  const lewisId   = isRings ? 'ring-lewis-canvas'        : 'lewis-canvas';
  const vseprId   = 'vsepr-canvas';   // main tab VSEPR canvas (ring tab doesn't have a separate one)
  const vseprOuterId = 'vsepr-canvas-wrap-outer';
  const resStripId   = isRings ? 'ring-resonance-strip'  : 'resonance-strip';
  const resWrapId    = isRings ? 'ring-resonance-strip-wrap' : 'resonance-strip-wrap';
  const iupacId      = isRings ? 'ring-iupac-name'       : 'main-iupac-name';

  const lewisCanvas = document.getElementById(lewisId);
  if (!lewisCanvas) return null;

  const vseprCanvas = isRings ? null : document.getElementById(vseprId);
  const vseprOuter  = document.getElementById(vseprOuterId);
  const vseprVisible = !isRings && vseprOuter && vseprOuter.style.display !== 'none' && vseprCanvas;

  const resStripWrap = document.getElementById(resWrapId);
  const resStrip     = document.getElementById(resStripId);
  const resStripVisible = resStripWrap && resStripWrap.style.display !== 'none' && resStrip;

  // Collect individual resonance canvases from the strip
  const resCanvases = [];
  if (resStripVisible) {
    const canvases = resStrip.querySelectorAll ? resStrip.querySelectorAll('canvas') : [];
    for (const cv of canvases) resCanvases.push(cv);
  }

  // IUPAC name (if visible and toggle on)
  const iupacEl = document.getElementById(iupacId);
  let iupacText = '';
  if (iupacEl && iupacEl.style.display !== 'none' && LV_STATE.showIupacName) {
    // Strip the "IUPAC:" label span and get just the name
    const strongEl = iupacEl.querySelector ? iupacEl.querySelector('strong') : null;
    if (strongEl) iupacText = (strongEl.textContent || '').trim();
  }

  return {
    lewisCanvas,
    vseprCanvas: vseprVisible ? vseprCanvas : null,
    resCanvases,
    iupacText
  };
}

// Compose an export PNG from the gathered canvases. Layout (top to bottom):
//   1. IUPAC name banner (optional)
//   2. Lewis canvas
//   3. Resonance strip canvases (side by side)
//   4. VSEPR canvas
function _composeExportPng(data) {
  const gap = 16;
  const iupacH = data.iupacText ? 34 : 0;
  const iupacPadY = data.iupacText ? 6 : 0;

  // Resonance layout: each strip canvas side-by-side with small gaps
  const resGap = 12;
  const resW   = data.resCanvases.reduce((sum, cv, i) => sum + cv.width + (i > 0 ? resGap : 0), 0);
  const resH   = data.resCanvases.length
    ? Math.max(...data.resCanvases.map(cv => cv.height))
    : 0;

  const width = Math.max(
    data.lewisCanvas.width,
    data.vseprCanvas ? data.vseprCanvas.width : 0,
    resW
  );
  let height = iupacH + (iupacH ? gap : 0) + data.lewisCanvas.height;
  if (data.resCanvases.length) height += gap + resH;
  if (data.vseprCanvas)        height += gap + data.vseprCanvas.height;

  const out = document.createElement('canvas');
  out.width  = width;
  out.height = height;
  const ctx  = out.getContext('2d');

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  let y = 0;

  // IUPAC name
  if (data.iupacText) {
    ctx.fillStyle = '#333';
    ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('IUPAC: ' + data.iupacText, width / 2, iupacPadY + iupacH / 2);
    y += iupacH + gap;
  }

  // Lewis
  ctx.drawImage(data.lewisCanvas, (width - data.lewisCanvas.width) / 2, y);
  y += data.lewisCanvas.height;

  // Resonance strip
  if (data.resCanvases.length) {
    y += gap;
    let rx = (width - resW) / 2;
    for (const rcv of data.resCanvases) {
      ctx.drawImage(rcv, rx, y);
      rx += rcv.width + resGap;
    }
    y += resH;
  }

  // VSEPR
  if (data.vseprCanvas) {
    y += gap;
    ctx.drawImage(data.vseprCanvas, (width - data.vseprCanvas.width) / 2, y);
  }

  return out.toDataURL('image/png');
}

// Filename for PNG export: use the normalizedFormula if available, else the
// raw input, else a generic fallback.
function _exportFilename() {
  const parse = LV_STATE.lastParse;
  const raw = LV_STATE.lastRawInput || '';
  return (parse && parse.normalizedFormula)
    ? parse.normalizedFormula
    : (raw || 'lewis-structure');
}

// ── Copy Breakdown ───────────────────────────────────────────────────────
// Copies the plain-text contents of every visible breakdown section to the
// clipboard. Useful for pasting into worksheets or lab reports.
function initCopyBreakdownButton() {
  const btn = document.getElementById('btn-copy-breakdown');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const isRings = (LV_STATE.activeTab === 'rings');
    // Which DOM IDs hold the breakdowns for the active tab?
    const sections = isRings
      ? ['ring-breakdown-lewis', 'ring-breakdown-resonance',
         'ring-breakdown-vsepr', 'ring-breakdown-imf', 'ring-breakdown-polarity']
      : ['breakdown-lewis', 'breakdown-resonance',
         'breakdown-vsepr', 'breakdown-imf', 'breakdown-polarity'];

    const blocks = [];
    for (const id of sections) {
      const el = document.getElementById(id);
      if (!el) continue;
      // Respect the toggle state — only copy what the user has chosen to see
      if (el.style.display === 'none') continue;
      const txt = extractBreakdownText(el);
      if (txt) blocks.push(txt);
    }

    if (blocks.length === 0) {
      showToast('Nothing to copy — generate a structure first.', true);
      return;
    }

    // Build header: raw input + formula + IUPAC name if known
    const formula = LV_STATE.lastParse?.normalizedFormula
                 || LV_STATE.lastParse?.raw
                 || '';
    const rawInput = LV_STATE.lastRawInput || '';
    const iupacId = isRings ? 'ring-iupac-name' : 'main-iupac-name';
    const iupacEl = document.getElementById(iupacId);
    let iupacText = '';
    if (iupacEl && iupacEl.style.display !== 'none') {
      const strongEl = iupacEl.querySelector ? iupacEl.querySelector('strong') : null;
      if (strongEl) iupacText = (strongEl.textContent || '').trim();
    }

    const headerLines = [];
    if (rawInput)  headerLines.push('Input:   ' + rawInput);
    if (formula && formula !== rawInput) headerLines.push('Formula: ' + formula);
    if (iupacText) headerLines.push('IUPAC:   ' + iupacText);
    // R8 item 5: mention 3D availability if the molecule is 3D-eligible
    const structure = LV_STATE.lastStructure;
    if (structure && !structure.isIonic && typeof JSMOL !== 'undefined') {
      const mappedName = JSMOL.lookupName(rawInput);
      if (mappedName) {
        headerLines.push('3D view: available (click "View in 3D" in the app)');
      }
    }
    const header = headerLines.length ? headerLines.join('\n') + '\n\n' : '';
    const text   = header + blocks.join('\n\n');

    try {
      await navigator.clipboard.writeText(text);
      showToast(`Copied breakdown (${blocks.length} section${blocks.length===1?'':'s'})`);
    } catch (err) {
      // Fallback: hidden textarea
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast(`Copied breakdown (${blocks.length} section${blocks.length===1?'':'s'})`);
      } catch (e2) {
        showToast('Copy failed: ' + (err.message || 'clipboard access denied'), true);
      }
    }
  });
}

// Converts a breakdown section's DOM into readable plain text.
// Preserves headings and list structure; strips all markup.
function extractBreakdownText(sectionEl) {
  const lines = [];
  const walk = (node, listDepth = 0) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.replace(/\s+/g, ' ').trim();
      if (t) lines[lines.length - 1] = (lines[lines.length - 1] || '') + t;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();

    const startBlock = () => lines.push('');
    const isBlock = /^(h[1-6]|p|li|tr|div|section)$/.test(tag);

    if (tag === 'h2') { startBlock(); lines.push('=== ' + node.textContent.trim().toUpperCase() + ' ==='); lines.push(''); return; }
    if (tag === 'h3') { startBlock(); lines.push('— ' + node.textContent.trim() + ' —'); lines.push(''); return; }

    if (tag === 'ul' || tag === 'ol') {
      const children = [...node.children].filter(c => c.tagName === 'LI');
      children.forEach((li, i) => {
        const prefix = tag === 'ol' ? `${i + 1}. ` : '• ';
        lines.push(prefix);
        walk(li, listDepth + 1);
      });
      lines.push('');
      return;
    }

    if (tag === 'table') {
      const rows = node.querySelectorAll('tr');
      rows.forEach(row => {
        const cells = [...row.querySelectorAll('th,td')]
          .map(c => c.textContent.trim().replace(/\s+/g, ' '));
        if (cells.length) lines.push('  ' + cells.join('  |  '));
      });
      lines.push('');
      return;
    }

    if (isBlock) startBlock();
    for (const child of node.childNodes) walk(child, listDepth);
    if (isBlock) startBlock();
  };

  walk(sectionEl);

  // Collapse multiple blank lines into one
  const out = [];
  for (const line of lines) {
    if (line === '' && out[out.length - 1] === '') continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

// ── Main pipeline ────────────────────────────────────────────────────────
function runGeneration() {
  const raw = strVal('formula-input');
  if (!raw) { showToast('Enter a formula first.', true); return; }

  // ── Rings-tab dispatch ──────────────────────────────────────────────
  // When the user is on the Rings tab, the input is interpreted as a
  // cyclic compound. The ring pipeline has its own parser, engine, and
  // renderers. Main-tab behavior below is unchanged.
  if (LV_STATE.activeTab === 'rings') {
    runRingGeneration(raw);
    return;
  }

  // IUPAC-1: track input for downstream IUPAC display lookup
  LV_STATE.lastRawInput = raw;

  const parsed = parseFormula(raw, LV_STATE.bondType);
  if (!parsed.ok) {
    // IUPAC-1: if the parser failed and the input looks like an IUPAC name,
    // try resolving it to a formula via CACTVS. This is async — we fire the
    // request, then either re-run runGeneration with the formula or show the
    // original parse error.
    if (typeof IUPAC !== 'undefined' && IUPAC.looksLikeIupacName(raw)) {
      showToast('Looking up "' + raw + '" as an IUPAC name…', false);
      IUPAC.resolveNameToFormula(raw).then((result) => {
        if (result.ok && result.formula) {
          // Repopulate the input with the formula and re-run
          const formulaInput = document.getElementById('formula-input');
          if (formulaInput) formulaInput.value = result.formula;
          showToast('Resolved "' + raw + '" → ' + result.formula, false);
          // Preserve the original IUPAC input for display lookup
          const iupacName = raw;
          runGeneration();
          // After runGeneration completes, override the IUPAC display with
          // the user's original input (which we know resolves to this formula)
          LV_STATE.lastRawInput = iupacName;
          _updateIupacDisplay('main', iupacName, LV_STATE.lastStructure);
        } else {
          showToast(parsed.error + ' (and IUPAC lookup: ' +
            (result.error || 'no match') + ')', true);
          _update3DButton('main', raw, null);
          _updateIupacDisplay('main', raw, null);
        }
      });
      return;
    }
    showToast(parsed.error, true);
    _update3DButton('main', raw, null);
    _updateIupacDisplay('main', raw, null);
    return;
  }
  LV_STATE.lastParse = parsed;

  // Phase 3: covalent path. Phase 4: ionic path.
  if (parsed.type === 'covalent') {
    // If the parser identified this as a carbon chain (condensed structural
    // formula OR stoichiometric hydrocarbon), delegate to the chain engine.
    // The chain engine emits a structure compatible with the existing
    // renderer/downstream engines, but with isChain=true as a signal.
    const structure = parsed.isChainInput
      ? buildChainStructure(parsed.chainDescriptor)
      : buildLewisStructure(parsed);
    if (!structure.ok) {
      showToast(structure.error, true);
      LV_STATE.lastStructure = null;
      LV_STATE.lastIonic     = null;
      LV_STATE.lastResonance = null;
      LV_STATE.lastVSEPR     = null;
      LV_STATE.lastPolarity  = null;
      LV_STATE.lastIMF       = null;
      drawParseStub(parsed);
      hideVSEPRCanvas();
      renderErrorFallbackBreakdown(parsed);
      _update3DButton('main', raw, null);
      return;
    }
    // Phase 5: explore resonance. `resonance.structures[0]` is the original
    // structure, which we use as the primary render. Additional structures
    // render into the resonance strip.
    const resonance = generateResonanceStructures(structure);

    // The "primary" structure we display on the main canvas is the first BEST
    // structure when there's resonance; otherwise it's the original build.
    const primary = resonance.hasResonance
      ? resonance.structures[resonance.bestIndices[0]]
      : structure;

    LV_STATE.lastStructure = primary;
    LV_STATE.lastResonance = resonance;
    LV_STATE.lastIonic     = null;

    // Phase 7: classify molecular geometry from the best structure
    const vsepr = classifyVSEPR(primary);
    LV_STATE.lastVSEPR = vsepr;

    // Phase 10: walk the polarity flowchart
    const polarity = classifyPolarity(primary, vsepr);
    LV_STATE.lastPolarity = polarity;

    // Phase 9: classify intermolecular forces using polarity result
    const imf = classifyIMF(parsed, primary, polarity);
    LV_STATE.lastIMF = imf;

    drawCovalentStructure(parsed, primary);
    renderResonanceStrip(parsed, resonance);
    drawVSEPRGeometry(parsed, primary, vsepr);
    renderLewisBreakdown(parsed, primary);
    renderResonanceBreakdown(parsed, resonance);
    renderVSEPRBreakdown(parsed, primary, vsepr);
    renderIMFBreakdown(parsed, imf);
    renderPolarityBreakdown(parsed, polarity);
    _update3DButton('main', raw, primary);
    _updateIupacDisplay('main', raw, primary);
    return;
  }

  if (parsed.type === 'ionic') {
    const ionic = buildIonicStructure(parsed);
    if (!ionic.ok) {
      showToast(ionic.error, true);
      LV_STATE.lastStructure = null;
      LV_STATE.lastIonic     = null;
      LV_STATE.lastResonance = null;
      LV_STATE.lastVSEPR     = null;
      LV_STATE.lastPolarity  = null;
      LV_STATE.lastIMF       = null;
      drawParseStub(parsed);
      hideVSEPRCanvas();
      renderErrorFallbackBreakdown(parsed);
      return;
    }
    LV_STATE.lastIonic     = ionic;
    LV_STATE.lastStructure = null;
    LV_STATE.lastResonance = null;
    LV_STATE.lastVSEPR     = null;
    LV_STATE.lastPolarity  = null;
    // Ionic compounds DO get an IMF result (applicable:false with the
    // "doesn't apply" note), which the ionic breakdown shows inline.
    LV_STATE.lastIMF       = classifyIMF(parsed, null, null);
    drawIonicCompound(parsed, ionic);
    hideVSEPRCanvas();
    renderIonicBreakdown(parsed, ionic);
    // R7-1: 3D view disabled for ionic compounds
    _update3DButton('main', raw, { isIonic: true });
    // IUPAC-1: IUPAC names don't really apply to ionic lattices; clear display
    _updateIupacDisplay('main', raw, { isIonic: true });
    return;
  }
}

function hideVSEPRCanvas() {
  const wrap = document.getElementById('vsepr-canvas-wrap-outer');
  if (wrap) wrap.style.display = 'none';
}

function redrawCurrent() {
  if (!LV_STATE.lastParse) { drawPlaceholderOnCanvas(); return; }
  if (LV_STATE.lastStructure) {
    drawCovalentStructure(LV_STATE.lastParse, LV_STATE.lastStructure);
    if (LV_STATE.lastResonance) renderResonanceStrip(LV_STATE.lastParse, LV_STATE.lastResonance);
    if (LV_STATE.lastVSEPR) drawVSEPRGeometry(LV_STATE.lastParse, LV_STATE.lastStructure, LV_STATE.lastVSEPR);
    else hideVSEPRCanvas();
  } else if (LV_STATE.lastIonic) {
    drawIonicCompound(LV_STATE.lastParse, LV_STATE.lastIonic);
    hideVSEPRCanvas();
  } else {
    drawParseStub(LV_STATE.lastParse);
    hideVSEPRCanvas();
  }
}

// ── Canvas: blank placeholder ────────────────────────────────────────────
function drawPlaceholderOnCanvas() {
  const canvas = document.getElementById('lewis-canvas');
  const ctx    = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);

  ctx.fillStyle = '#8a9ab8';
  ctx.font      = '15px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    'Enter a formula in the sidebar (e.g. H2O, NH4{+1}, NO3{-1}, Li3N)',
    canvas.width/2, canvas.height/2 - 10
  );
  ctx.font      = '12px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = '#6a7a98';
  ctx.fillText(
    'or click one of the quick examples to get started.',
    canvas.width/2, canvas.height/2 + 14
  );
}

// ── Canvas: error-fallback render (shows the parsed formula when the
//    structure engine couldn't build a valid Lewis/ionic structure) ─────
function drawParseStub(parse) {
  const canvas = document.getElementById('lewis-canvas');
  const ctx    = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // Draw formula centered, using atom color & font size
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = LV_STATE.atomColor;

  const zoom = LV_STATE.zoom;
  const main = LV_STATE.fontSize * zoom * 1.6;   // big formula
  const sub  = LV_STATE.fontSize * zoom * 0.85;  // subscript / label

  ctx.font = `600 ${main}px "Segoe UI", system-ui, sans-serif`;

  // Build display formula with actual subscripts / charge
  const parts = [];
  for (const a of parse.atoms) {
    parts.push({ text: a.symbol,        sub: false });
    if (a.count > 1) parts.push({ text: String(a.count), sub: true });
  }
  if (parse.charge !== 0) {
    parts.push({ text: chargeString(parse.charge), sub: 'sup' });
  }

  // Measure + draw
  ctx.save();
  const measureFont = s => { ctx.font = s ? `400 ${sub}px "Segoe UI"` : `600 ${main}px "Segoe UI"`; };
  let totalW = 0;
  parts.forEach(p => {
    measureFont(p.sub);
    totalW += ctx.measureText(p.text).width + 2;
  });
  let x = canvas.width/2 - totalW/2;
  const yBase = canvas.height/2 - 20;
  parts.forEach(p => {
    measureFont(p.sub);
    const w = ctx.measureText(p.text).width;
    if (p.sub === true)       ctx.fillText(p.text, x + w/2, yBase + main*0.25);
    else if (p.sub === 'sup') ctx.fillText(p.text, x + w/2, yBase - main*0.30);
    else                      ctx.fillText(p.text, x + w/2, yBase);
    x += w + 2;
  });
  ctx.restore();

  // Type label under formula
  ctx.font         = `500 13px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle    = '#4a90e2';
  ctx.fillText(
    `Parsed as: ${parse.type.toUpperCase()} ` +
    (parse.charge ? `(overall charge ${chargeString(parse.charge)})` : '(neutral)'),
    canvas.width/2, canvas.height/2 + 40
  );
  ctx.fillStyle = '#8a9ab8';
  ctx.font      = '12px "Segoe UI"';
  ctx.fillText(
    'Structure could not be built — see the error message below.',
    canvas.width/2, canvas.height/2 + 62
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// PHASE 5: RESONANCE STRIP RENDERER
// ─────────────────────────────────────────────────────────────────────────────
// Draws every resonance structure in a horizontal row with ↔ arrows between
// them. The BEST structure(s) get a green "BEST STRUCTURE" label. When there
// is no resonance, the strip is hidden.
// ─────────────────────────────────────────────────────────────────────────────
function renderResonanceStrip(parse, resonance) {
  const wrap  = document.getElementById('resonance-strip-wrap');
  const strip = document.getElementById('resonance-strip');

  if (!resonance || !resonance.hasResonance) {
    wrap.style.display = 'none';
    strip.innerHTML = '';
    return;
  }

  wrap.style.display = '';
  strip.innerHTML = '';

  // Per-card canvas size — small but legible
  const zoom     = LV_STATE.zoom;
  const cardW    = Math.round(260 * Math.min(zoom, 1.2));
  const cardH    = Math.round(170 * Math.min(zoom, 1.2));

  resonance.structures.forEach((st, i) => {
    if (i > 0) {
      const arrow = document.createElement('span');
      arrow.className   = 'resonance-arrow';
      arrow.textContent = '↔';
      strip.appendChild(arrow);
    }

    const card = document.createElement('div');
    card.className = 'resonance-card' + (resonance.bestIndices.includes(i) ? ' best' : '');

    const cv = document.createElement('canvas');
    cv.width = cardW;
    cv.height = cardH;
    card.appendChild(cv);

    const label = document.createElement('span');
    label.className = 'resonance-card-label';
    label.textContent = resonance.bestIndices.includes(i)
      ? 'Best Structure'
      : `Structure #${i + 1}`;
    card.appendChild(label);

    strip.appendChild(card);

    // Draw the structure on the card using the renderer's small-card helper
    drawResonanceCard(parse, st, cv, { zoomMul: 0.55 });
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// Ring-tab pipeline. Parses the input as a ring formula, builds the ring
// structure, runs VSEPR/polarity/IMF, and renders into the ring-tab-specific
// DOM elements (ring-lewis-canvas, ring-vsepr-canvas, ring-breakdown-*, etc).
//
// Flow mirrors the main covalent path but uses ring-specific parser and
// engine. All renderers detect isRing and handle it correctly.
// ─────────────────────────────────────────────────────────────────────────────
function runRingGeneration(raw) {
  // IUPAC-1: track input for downstream IUPAC display lookup
  LV_STATE.lastRawInput = raw;

  // R6d-2: reset the sugar view to Haworth whenever the user enters a
  // new input. The toggle only persists while working with a single sugar.
  if (LV_STATE.lastRingInput !== raw) {
    LV_STATE.sugarView = 'haworth';
    LV_STATE.lastRingInput = raw;
  }
  // For sugars, pass the current toggle state (haworth vs flat) to
  // the parser. Non-sugar inputs ignore this option.
  const opts = { sugarView: LV_STATE.sugarView || 'haworth' };
  const spec = parseRingFormula(raw, opts);
  if (!spec.ok) {
    // IUPAC-1: if ring parser failed and input looks like an IUPAC name,
    // try CACTVS resolution. Pattern mirrors main tab fallback above.
    if (typeof IUPAC !== 'undefined' && IUPAC.looksLikeIupacName(raw)) {
      showToast('Looking up "' + raw + '" as an IUPAC name…', false);
      IUPAC.resolveNameToFormula(raw).then((result) => {
        if (result.ok && result.formula) {
          const formulaInput = document.getElementById('formula-input');
          if (formulaInput) formulaInput.value = result.formula;
          showToast('Resolved "' + raw + '" → ' + result.formula, false);
          const iupacName = raw;
          runRingGeneration(result.formula);
          LV_STATE.lastRawInput = iupacName;
          _updateIupacDisplay('ring', iupacName, LV_STATE.lastStructure);
        } else {
          showToast(spec.error + ' (and IUPAC lookup: ' +
            (result.error || 'no match') + ')', true);
          _update3DButton('ring', raw, null);
          _updateIupacDisplay('ring', raw, null);
        }
      });
      return;
    }
    showToast(spec.error, true);
    _update3DButton('ring', raw, null);
    _updateIupacDisplay('ring', raw, null);
    return;
  }

  const structure = buildRingStructure(spec);
  if (!structure.ok) {
    showToast(structure.error, true);
    _update3DButton('ring', raw, null);
    _updateIupacDisplay('ring', raw, null);
    return;
  }

  // Synthetic parse-like object for downstream engines that expect one
  // (e.g. IMF's ionic check, breakdown renderers).
  const fakeParse = {
    ok:           true,
    type:         'covalent',
    raw,
    charge:       0,
    atoms:        [],
    isChainInput: false,
    isRingInput:  true,
    ringSpec:     spec
  };

  LV_STATE.lastParse     = fakeParse;
  LV_STATE.lastStructure = structure;
  LV_STATE.lastIonic     = null;

  // Resonance (benzene gets 2 Kekulé forms; other rings get none)
  const resonance = generateResonanceStructures(structure);
  LV_STATE.lastResonance = resonance;

  // VSEPR per-ring-atom
  const vsepr = classifyVSEPR(structure);
  LV_STATE.lastVSEPR = vsepr;

  // Polarity
  const polarity = classifyPolarity(structure, vsepr);
  LV_STATE.lastPolarity = polarity;

  // IMF
  const imf = classifyIMF(fakeParse, structure, polarity);
  LV_STATE.lastIMF = imf;

  // ── Render into ring-tab DOM ────────────────────────────────────────
  _renderRingLewisCanvas(fakeParse, structure);
  _renderRingResonanceStrip(fakeParse, resonance);
  _renderRingVSEPRCanvas(fakeParse, structure, vsepr);
  _renderRingBreakdowns(fakeParse, structure, resonance, vsepr, polarity, imf);

  // Show aromatic-display toggle only for benzene; wire it up
  _updateAromaticToggle(structure);

  // R6d-2: Show sugar-view toggle only for sugars; wire it up
  _updateSugarToggle(structure, raw);

  // R7-1: Show/wire "View in 3D" button
  _update3DButton('ring', raw, structure);

  // IUPAC-1: Show IUPAC name under the ring Lewis canvas
  _updateIupacDisplay('ring', raw, structure);

  // Notification toast
  if (spec.notification) {
    showToast(spec.notification, false);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ring-tab rendering helpers. These swap DOM IDs so the ring tab's canvases
// and breakdown sections get the output (main tab's DOM is left untouched).
// ─────────────────────────────────────────────────────────────────────────────
function _renderRingLewisCanvas(parse, structure) {
  const canvas = document.getElementById('ring-lewis-canvas');
  if (!canvas) return;

  // R6d-2: dynamic canvas size for Haworth projections. Haworth drawings
  // extend vertically above and below the ring (with substituents going
  // both up and down), so they need extra vertical space. We restore the
  // default dimensions for any non-Haworth render.
  const meta = structure.ringMeta || {};
  if (meta.isSugar && meta.sugarView === 'haworth') {
    canvas.width = 700;
    canvas.height = 520;
  } else {
    canvas.width = 700;
    canvas.height = 380;
  }

  // If aromatic and user selected circle-display, draw circle-in-hexagon
  // instead of the Kekulé structure.
  if (structure.isAromatic && LV_STATE.aromaticDisplay === 'circle') {
    _drawCircleBenzene(canvas, structure);
    return;
  }
  drawCovalentStructure(parse, structure, canvas);
}

function _renderRingResonanceStrip(parse, resonance) {
  const wrap  = document.getElementById('ring-resonance-strip-wrap');
  const strip = document.getElementById('ring-resonance-strip');
  if (!strip || !wrap) return;

  strip.innerHTML = '';
  if (!resonance || !resonance.hasResonance) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';

  const cardW = 260, cardH = 170;
  resonance.structures.forEach((st, i) => {
    const card = document.createElement('div');
    card.className = 'resonance-card' + (resonance.bestIndices.includes(i) ? ' best' : '');
    const cv = document.createElement('canvas');
    cv.width = cardW;
    cv.height = cardH;
    card.appendChild(cv);
    const label = document.createElement('span');
    label.className = 'resonance-card-label';
    label.textContent = `Kekulé Structure ${i + 1}`;
    card.appendChild(label);
    strip.appendChild(card);
    drawResonanceCard(parse, st, cv, { zoomMul: 0.55 });
  });
}

function _renderRingVSEPRCanvas(parse, structure, vsepr) {
  const wrap   = document.getElementById('ring-vsepr-canvas-wrap-outer');
  const canvas = document.getElementById('ring-vsepr-canvas');
  if (!canvas || !wrap) return;

  if (!vsepr || !vsepr.applicable) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  drawVSEPRGeometry(parse, structure, vsepr, canvas);
}

// Render all 5 breakdown sections into ring-tab-specific IDs. The breakdown
// renderer functions write to hardcoded IDs (breakdown-lewis, etc.), so we
// temporarily swap the DOM element IDs to point to the ring-tab versions,
// then restore them.
function _renderRingBreakdowns(parse, structure, resonance, vsepr, polarity, imf) {
  const idPairs = [
    ['breakdown-lewis',     'ring-breakdown-lewis'],
    ['breakdown-resonance', 'ring-breakdown-resonance'],
    ['breakdown-vsepr',     'ring-breakdown-vsepr'],
    ['breakdown-imf',       'ring-breakdown-imf'],
    ['breakdown-polarity',  'ring-breakdown-polarity']
  ];

  // Also swap resonance-strip-wrap since renderLewisBreakdown hides it
  const stripPair = ['resonance-strip-wrap', 'ring-resonance-strip-wrap'];

  // Swap IDs: ring sections temporarily take the main-tab IDs so the
  // breakdown renderer's getElementById calls land on them.
  const swaps = idPairs.slice();
  swaps.push(stripPair);
  const saved = [];
  for (const [mainId, ringId] of swaps) {
    const mainEl = document.getElementById(mainId);
    const ringEl = document.getElementById(ringId);
    if (mainEl && ringEl) {
      saved.push({ mainEl, ringEl, origMain: mainId, origRing: ringId });
      mainEl.id = `${mainId}--suspended`;
      ringEl.id = mainId;
    }
  }

  try {
    renderLewisBreakdown(parse, structure);
    renderResonanceBreakdown(parse, resonance);
    renderVSEPRBreakdown(parse, structure, vsepr);
    renderIMFBreakdown(parse, imf);
    renderPolarityBreakdown(parse, polarity);
  } finally {
    // Restore original IDs
    for (const rec of saved) {
      rec.mainEl.id = rec.origMain;
      rec.ringEl.id = rec.origRing;
    }
  }
}

// Show the aromatic toggle only when structure is aromatic; wire the buttons.
function _updateAromaticToggle(structure) {
  const wrap       = document.getElementById('ring-aromatic-toggle-wrap');
  const btnKekule  = document.getElementById('btn-aromatic-kekule');
  const btnCircle  = document.getElementById('btn-aromatic-circle');
  if (!wrap) return;

  if (!structure.isAromatic) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';

  // Default to Kekulé if not set
  if (!LV_STATE.aromaticDisplay) LV_STATE.aromaticDisplay = 'kekule';
  if (btnKekule) btnKekule.classList.toggle('active', LV_STATE.aromaticDisplay === 'kekule');
  if (btnCircle) btnCircle.classList.toggle('active', LV_STATE.aromaticDisplay === 'circle');

  // Guard against re-wiring on every generation: attach listeners once.
  if (btnKekule && !btnKekule._wired) {
    btnKekule._wired = true;
    btnKekule.addEventListener('click', () => {
      LV_STATE.aromaticDisplay = 'kekule';
      btnKekule.classList.add('active');
      if (btnCircle) btnCircle.classList.remove('active');
      if (LV_STATE.lastStructure) {
        _renderRingLewisCanvas(LV_STATE.lastParse, LV_STATE.lastStructure);
      }
    });
  }
  if (btnCircle && !btnCircle._wired) {
    btnCircle._wired = true;
    btnCircle.addEventListener('click', () => {
      LV_STATE.aromaticDisplay = 'circle';
      btnCircle.classList.add('active');
      if (btnKekule) btnKekule.classList.remove('active');
      if (LV_STATE.lastStructure) {
        _renderRingLewisCanvas(LV_STATE.lastParse, LV_STATE.lastStructure);
      }
    });
  }
}

// R6d-2: show and wire the sugar-view toggle (Haworth ↔ Flat Lewis).
// Only visible when the current structure is a sugar. Clicking a button
// sets LV_STATE.sugarView and re-runs the full ring generation so the
// parser → engine → render pipeline reflects the new view.
function _updateSugarToggle(structure, rawInput) {
  const wrap        = document.getElementById('ring-sugar-toggle-wrap');
  const btnHaworth  = document.getElementById('btn-sugar-haworth');
  const btnFlat     = document.getElementById('btn-sugar-flat');
  if (!wrap) return;

  const meta = structure.ringMeta || {};
  if (!meta.isSugar) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';

  // Default view for sugars is Haworth
  if (!LV_STATE.sugarView) LV_STATE.sugarView = 'haworth';
  if (btnHaworth) btnHaworth.classList.toggle('active', LV_STATE.sugarView === 'haworth');
  if (btnFlat)    btnFlat.classList.toggle('active', LV_STATE.sugarView === 'flat');

  // Wire once; subsequent calls only update the active class above.
  if (btnHaworth && !btnHaworth._wired) {
    btnHaworth._wired = true;
    btnHaworth.addEventListener('click', () => {
      if (LV_STATE.sugarView === 'haworth') return;
      LV_STATE.sugarView = 'haworth';
      runRingGeneration(LV_STATE.lastRingInput || rawInput);
    });
  }
  if (btnFlat && !btnFlat._wired) {
    btnFlat._wired = true;
    btnFlat.addEventListener('click', () => {
      if (LV_STATE.sugarView === 'flat') return;
      LV_STATE.sugarView = 'flat';
      runRingGeneration(LV_STATE.lastRingInput || rawInput);
    });
  }
}

// R7-1: show/hide and wire the "View in 3D" button for a given tab
// (context is 'main' or 'ring'). Called after every generation.
//
//   - structure is null/undefined → hide the button (no molecule to show)
//   - structure.isIonic → show button disabled with a note (ionic compounds
//     aren't discrete molecules, so 3D doesn't apply)
//   - otherwise → show the button enabled. Clicking it reveals the 3D
//     viewer wrap and asks JSMOL to load the molecule.
//
// The 3D viewer wrap is hidden on every new generation — user must click
// the button again to re-open it for the new molecule. This prevents
// stale 3D views from persisting when the input changes.
function _update3DButton(context, rawInput, structure) {
  const btnId    = (context === 'main') ? 'btn-main-3d'     : 'btn-ring-3d';
  const wrapId   = (context === 'main') ? 'main-3d-wrap'    : 'ring-3d-wrap';
  const statusId = (context === 'main') ? 'main-3d-status'  : 'ring-3d-status';
  const viewerId = (context === 'main') ? 'main-3d-viewer'  : 'ring-3d-viewer';

  const btn    = document.getElementById(btnId);
  const wrap   = document.getElementById(wrapId);
  const status = document.getElementById(statusId);
  if (!btn || !wrap) return;

  // Always hide the 3D wrap on a new generation; user must click to re-open.
  // Reset button text to "View in 3D" so the next click opens (not toggles).
  wrap.style.display = 'none';
  if (status) status.innerHTML = '';
  btn.textContent = 'View in 3D';

  // No structure (parse/build error) → hide the button entirely
  if (!structure) {
    btn.style.display = 'none';
    return;
  }

  btn.style.display = '';

  // Ionic compounds: button visible but disabled with a note
  if (structure.isIonic) {
    btn.disabled = true;
    btn.textContent = 'View in 3D (not available for ionic compounds)';
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
    return;
  }

  // JSmol library not vendored yet: button visible but disabled
  if (typeof JSMOL === 'undefined' || !JSMOL.isJsmolAvailable()) {
    btn.disabled = true;
    btn.textContent = 'View in 3D (library not installed yet)';
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
    btn.title = 'JSmol library not loaded. See docs/jsmol-setup.md.';
    return;
  }

  // Normal case: enable the button
  btn.disabled = false;
  btn.textContent = 'View in 3D';
  btn.style.opacity = '1';
  btn.style.cursor = 'pointer';
  btn.title = '';

  // R7-3: the button toggles between "View in 3D" (opens the viewer)
  // and "Hide 3D" (collapses it). State is tracked by the wrap's
  // display property — shown = '', hidden = 'none'.
  const newHandler = () => {
    const isHidden = (wrap.style.display === 'none');
    if (isHidden) {
      wrap.style.display = '';
      btn.textContent = 'Hide 3D';
      JSMOL.show(rawInput, viewerId, statusId, structure);
    } else {
      wrap.style.display = 'none';
      btn.textContent = 'View in 3D';
      // Clear status when hiding
      const statusEl = document.getElementById(statusId);
      if (statusEl) statusEl.innerHTML = '';
    }
  };
  if (btn._current3DHandler) {
    btn.removeEventListener('click', btn._current3DHandler);
  }
  btn._current3DHandler = newHandler;
  btn.addEventListener('click', newHandler);
}

// IUPAC-1: populate the "IUPAC name" display under the Lewis canvas.
// Uses the current user input (LV_STATE.lastRawInput) and the IUPAC
// adapter to resolve the name. If the name isn't cached, kicks off an
// async CACTVS lookup and populates the display when it arrives.
//
// Context is 'main' or 'ring', mirroring _update3DButton.
function _updateIupacDisplay(context, rawInput, structure) {
  const ctx = context || (LV_STATE.activeTab === 'rings' ? 'ring' : 'main');
  const elId  = (ctx === 'main') ? 'main-iupac-name'      : 'ring-iupac-name';
  const btnId = (ctx === 'main') ? 'btn-copy-main-iupac'  : 'btn-copy-ring-iupac';
  const el = document.getElementById(elId);
  const btn = document.getElementById(btnId);
  if (!el) return;

  // Helper: show/hide the Copy IUPAC button in lockstep with the display,
  // AND only when a real name is rendered (not "looking up…" or "not available")
  const setBtnVisible = (visible) => { if (btn) btn.style.display = visible ? '' : 'none'; };

  // Hidden by toggle → clear and hide
  if (!LV_STATE.showIupacName) {
    el.textContent = '';
    el.style.display = 'none';
    setBtnVisible(false);
    return;
  }

  // No structure → hide
  if (!structure) {
    el.textContent = '';
    el.style.display = 'none';
    setBtnVisible(false);
    return;
  }

  // Ionic compounds: IUPAC system doesn't really apply the same way; skip
  if (structure.isIonic) {
    el.textContent = '';
    el.style.display = 'none';
    setBtnVisible(false);
    return;
  }

  // Use the raw input as the lookup key (fall back to state if not passed)
  const input = rawInput || LV_STATE.lastRawInput;
  if (!input) {
    el.style.display = 'none';
    setBtnVisible(false);
    return;
  }

  // Try the sync (cached) lookup first
  const iupac = (typeof IUPAC !== 'undefined') ? IUPAC.getIupacName(input) : null;
  if (iupac) {
    el.innerHTML = '<span style="color:var(--text-dim);">IUPAC:</span> <strong>' +
      _escapeHtml(iupac) + '</strong>';
    el.style.display = '';
    setBtnVisible(true);
    return;
  }

  // No cache hit — fire async lookup. Hide Copy button while loading.
  el.innerHTML = '<span style="color:var(--text-dim);">IUPAC: looking up…</span>';
  el.style.display = '';
  setBtnVisible(false);
  if (typeof IUPAC === 'undefined') return;

  IUPAC.getIupacNameAsync(input).then((name) => {
    // Only update if the user hasn't moved to a different molecule
    if (LV_STATE.lastRawInput !== input) return;
    if (name) {
      el.innerHTML = '<span style="color:var(--text-dim);">IUPAC:</span> <strong>' +
        _escapeHtml(name) + '</strong>';
      setBtnVisible(true);
    } else {
      el.innerHTML = '<span style="color:var(--text-dim);">IUPAC name not available</span>';
      setBtnVisible(false);
    }
  }).catch(() => {
    el.innerHTML = '<span style="color:var(--text-dim);">IUPAC lookup failed</span>';
    setBtnVisible(false);
  });
}

// R8 item 6: wire both "Copy IUPAC name" buttons. One-click copy to clipboard.
function initCopyIupacButtons() {
  const wire = (btnId, elId, label) => {
    const btn = document.getElementById(btnId);
    const el  = document.getElementById(elId);
    if (!btn || !el) return;
    btn.addEventListener('click', async () => {
      const strongEl = el.querySelector ? el.querySelector('strong') : null;
      const name = strongEl ? (strongEl.textContent || '').trim() : '';
      if (!name) { showToast('No IUPAC name to copy.', true); return; }
      try {
        await navigator.clipboard.writeText(name);
        showToast('Copied IUPAC name');
      } catch (err) {
        try {
          const ta = document.createElement('textarea');
          ta.value = name;
          ta.style.position = 'fixed';
          ta.style.opacity  = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          showToast('Copied IUPAC name');
        } catch (e2) {
          showToast('Copy failed: ' + (err.message || 'clipboard access denied'), true);
        }
      }
    });
  };
  wire('btn-copy-main-iupac', 'main-iupac-name');
  wire('btn-copy-ring-iupac', 'ring-iupac-name');
}

// Small HTML escape for IUPAC display text (the name itself can contain
// special characters like brackets and primes that shouldn't render as HTML).
function _escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Draw benzene as a hexagon with a circle inside (delocalized-π representation).
// Only called when structure.isAromatic is true.
function _drawCircleBenzene(canvas, structure) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Re-use existing render env to keep consistent zoom/colors
  const env = computeRenderEnv(canvas, structure);

  // Draw every C-H bond normally (single bonds), and every C-C ring bond as a
  // single bond (no doubles in circle mode). Temporarily clone the structure
  // with all ring bonds set to order 1.
  const ringAtomSet = new Set(structure.ringMeta.ringAtomIndices);
  const singledStructure = {
    ...structure,
    bonds: structure.bonds.map(b => ({
      ...b,
      order: (ringAtomSet.has(b.i) && ringAtomSet.has(b.j)) ? 1 : b.order
    }))
  };

  drawBonds(ctx, singledStructure, env);
  drawAtomsWithLonePairs(ctx, singledStructure, env);

  // Overlay a circle inside the hexagon. Compute centroid of ring atoms, then
  // draw a circle with ~55% of the average ring-center-to-atom distance.
  let cx = 0, cy = 0;
  const ringAtoms = structure.atoms.filter(a => a.isRingAtom);
  for (const a of ringAtoms) {
    const p = env.toPx(a);
    cx += p.x; cy += p.y;
  }
  cx /= ringAtoms.length;
  cy /= ringAtoms.length;

  let avgR = 0;
  for (const a of ringAtoms) {
    const p = env.toPx(a);
    avgR += Math.hypot(p.x - cx, p.y - cy);
  }
  avgR /= ringAtoms.length;
  const innerR = avgR * 0.55;

  ctx.save();
  ctx.strokeStyle = LV_STATE.bondColor || '#ffffff';
  ctx.lineWidth = Math.max(2, env.bondLenPx * 0.05);
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.restore();
}
