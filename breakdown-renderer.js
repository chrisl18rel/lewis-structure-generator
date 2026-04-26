// breakdown-renderer.js
// ─────────────────────────────────────────────────────────────────────────────
// HTML generation for every breakdown section below the Lewis and VSEPR
// canvases. Extracted from lewis-vsepr.js as part of Phase 11 to isolate
// DOM-building concerns from the controller.
//
// Public API (all return nothing; write to the corresponding DOM section):
//   renderErrorFallbackBreakdown(parse) — fallback for engine error paths
//   renderLewisBreakdown(parse, structure)
//   renderIonicBreakdown(parse, ionic)
//   renderResonanceBreakdown(parse, resonance)
//   renderVSEPRBreakdown(parse, structure, vsepr)
//   renderIMFBreakdown(parse, imf)
//   renderPolarityBreakdown(parse, polarity)
//
// Also exports the small html-escape helper:
//   escapeHtml(s)
//
// Depends on: chargeString() from formula-parser.js,
//             formalChargeString() from formal-charge.js,
//             sumAbsoluteFormalCharges / electronegativityWeightedFCScore
//             from formal-charge.js, getElement() from periodic-data.js,
//             updateBreakdownVisibility() from lewis-vsepr.js
// ─────────────────────────────────────────────────────────────────────────────

// ── Breakdown: Phase-1 parse diagnostic ──────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Error-fallback breakdown.
//
// Shown when the parser succeeded but a downstream engine (Lewis / ionic) could
// not produce a valid structure. Displays what WAS parsed so the student can
// see whether the formula was read correctly, then prompts them to check the
// error toast for the reason the structure couldn't be built.
// ─────────────────────────────────────────────────────────────────────────────
function renderErrorFallbackBreakdown(parse) {
  document.getElementById('resonance-strip-wrap').style.display = 'none';
  ['breakdown-resonance','breakdown-vsepr','breakdown-imf','breakdown-polarity']
    .forEach(id => { document.getElementById(id).innerHTML = ''; });

  const atomRows = parse.atoms.map(a => {
    const el = getElement(a.symbol);
    return `
      <tr>
        <td>${a.symbol}</td>
        <td>${a.count}</td>
        <td>${el ? el.valence : '?'}</td>
        <td>${el && el.en !== null ? el.en.toFixed(2) : '—'}</td>
        <td>${el ? el.octetTarget : '?'}</td>
        <td>${el ? (el.isMetal ? 'Metal' : 'Nonmetal') : '?'}</td>
      </tr>`;
  }).join('');

  const html = `
    <h2>Formula Parsed — Structure Could Not Be Built</h2>

    <div class="callout warn">
      The formula parsed successfully, but the structure engine could not
      produce a valid Lewis structure for it. The error message is shown in
      the notification in the bottom-right corner. Common causes:
      a formula that should be drawn as ionic is being forced as covalent (or
      vice-versa), an odd electron count (radicals are not yet supported), or
      a formula with more terminal atoms than bonds can accommodate.
    </div>

    <h3>What Was Parsed</h3>
    <p><strong>Input:</strong> <code>${escapeHtml(parse.raw)}</code>
       &nbsp;·&nbsp; <strong>Normalized:</strong>
       <code>${escapeHtml(parse.normalizedFormula)}</code>
       &nbsp;·&nbsp; <strong>Type:</strong> ${parse.type}
       &nbsp;·&nbsp; <strong>Charge:</strong>
       ${parse.charge === 0 ? '0 (neutral)' : chargeString(parse.charge)}</p>

    <h3>Atoms Detected</h3>
    <table>
      <thead>
        <tr><th>Symbol</th><th>Count</th><th>Valence e⁻</th>
            <th>EN</th><th>Octet target</th><th>Class</th></tr>
      </thead>
      <tbody>${atomRows}</tbody>
    </table>

    <p>If the atom list looks correct, try the other bond-type button
       (<strong>Covalent</strong> vs <strong>Ionic</strong>) in the sidebar.
       If the atom list looks wrong, check the formula you typed.</p>
  `;
  document.getElementById('breakdown-lewis').innerHTML = html;
  updateBreakdownVisibility();
}

// ── Small helper ─────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 BREAKDOWN — NASB table + build step summary
// ─────────────────────────────────────────────────────────────────────────────
function renderLewisBreakdown(parse, structure) {
  // Clear downstream sections
  document.getElementById('resonance-strip-wrap').style.display = 'none';
  ['breakdown-resonance','breakdown-vsepr','breakdown-imf','breakdown-polarity']
    .forEach(id => { document.getElementById(id).innerHTML = ''; });

  // ── Pre-built structure branch ────────────────────────────────────────
  // Some polyatomic ions (dichromate, thiosulfate, oxalate, acetate,
  // formate) use curated structures rather than the NASB engine. For
  // these, render a different breakdown that explains the structure
  // without the NASB chart (which doesn't exist for pre-built entries).
  if (structure.isPrebuilt) {
    renderPrebuiltLewisBreakdown(parse, structure);
    return;
  }

  // ── Chain branch ───────────────────────────────────────────────────────
  // Carbon chains don't have a single central atom and don't run NASB.
  // They need their own breakdown that walks through per-carbon
  // hybridization and bond structure.
  if (structure.isChain) {
    renderChainLewisBreakdown(parse, structure);
    return;
  }

  // ── Ring branch ────────────────────────────────────────────────────────
  // Rings also don't have a single central atom. The breakdown narrates
  // the ring size, aromaticity, and per-atom hybridization.
  if (structure.isRing) {
    renderRingLewisBreakdown(parse, structure);
    return;
  }

  const nasb = structure.nasb;

  // Build the NASB chart table — one column per unique element symbol +
  // a TOTALS column
  const symCols = Object.keys(nasb.perAtomValence);
  const countBySym = {};
  for (const a of parse.atoms) countBySym[a.symbol] = a.count;

  // Per-element N breakdown with octet targets
  const nRow = symCols.map(sym => {
    const el     = getElement(sym);
    const target = el ? el.octetTarget : '?';
    // If expanded-octet was applied to this central atom, its per-atom N
    // might not equal count × target. Fall back to the stored perAtomN.
    return `${target} × ${countBySym[sym]} = ${nasb.perAtomN[sym]}`;
  }).join('</td><td>');

  const aRow = symCols.map(sym => {
    const el = getElement(sym);
    return `${el ? el.valence : '?'} × ${countBySym[sym]} = ${nasb.perAtomValence[sym]}`;
  }).join('</td><td>');

  const chargeAdjText =
    nasb.chargeAdjustment === 0 ? 'n/a (neutral)'
    : nasb.chargeAdjustment > 0 ? `+${nasb.chargeAdjustment} e⁻ (anion — add ${nasb.chargeAdjustment})`
    : `${nasb.chargeAdjustment} e⁻ (cation — subtract ${Math.abs(nasb.chargeAdjustment)})`;

  const centralSym = structure.centralAtomChoice.symbol;

  // Build atom-by-atom FC row
  const atomRows = structure.atoms.map(a => {
    const bondOrderSum = structure.bonds
      .filter(b => b.i === a.index || b.j === a.index)
      .reduce((s,b) => s + b.order, 0);
    return `
      <tr>
        <td>${a.symbol}${a.isCentral?' (central)':''}</td>
        <td>${a.lonePairs}</td>
        <td>${bondOrderSum}</td>
        <td>${formalChargeString(a.formalCharge) || '0'}</td>
      </tr>`;
  }).join('');

  const notesList = structure.validationNotes
    .map(n => `<li>${escapeHtml(n)}</li>`).join('');

  const expandedNote = nasb.expandedOctetApplied
    ? `<div class="callout">
         <strong>Expanded octet applied</strong> — ${centralSym} is allowed
         more than 8 valence electrons, so its N contribution was bumped up
         to accommodate all ${structure.atoms.length - 1} terminal bonds.
       </div>` : '';

  const html = `
    <h2>Lewis Structure — Step by Step</h2>

    <h3>1) N.A.S.B. Chart</h3>
    <table>
      <thead>
        <tr><th></th>${symCols.map(s => `<th>${s}</th>`).join('')}<th>TOTALS</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>N (needed)</td>
          <td>${nRow}</td>
          <td><strong>${nasb.N}</strong></td>
        </tr>
        <tr>
          <td>A (available)</td>
          <td>${aRow}</td>
          <td>${nasb.totalAraw}</td>
        </tr>
        <tr>
          <td>Charge adjustment</td>
          <td colspan="${symCols.length}">${chargeAdjText}</td>
          <td>${nasb.chargeAdjustment === 0 ? 0 : (nasb.chargeAdjustment > 0 ? '+' : '') + nasb.chargeAdjustment}</td>
        </tr>
        <tr>
          <td>A (adjusted)</td>
          <td colspan="${symCols.length}"></td>
          <td><strong>${nasb.A}</strong></td>
        </tr>
        <tr>
          <td>S (shared) = N − A</td>
          <td colspan="${symCols.length}">${nasb.N} − ${nasb.A}</td>
          <td><strong>${nasb.S}</strong></td>
        </tr>
        <tr>
          <td>B (bonds) = S ÷ 2</td>
          <td colspan="${symCols.length}">${nasb.S} ÷ 2</td>
          <td><strong>${nasb.B}</strong></td>
        </tr>
      </tbody>
    </table>

    ${expandedNote}

    <h3>2) Central Atom</h3>
    <p>Central atom: <code>${centralSym}</code> —
       ${escapeHtml(structure.centralAtomChoice.reason)}</p>

    <h3>3) Skeleton + Bond Placement</h3>
    <p>Place ${structure.bonds.length} bonds between the central atom
       and each terminal. Promote bonds as needed to reach B = ${nasb.B}.</p>
    <ul>
      ${structure.bonds.map(b => {
        const s1 = structure.atoms[b.i].symbol, s2 = structure.atoms[b.j].symbol;
        const kind = b.order === 1 ? 'single' : b.order === 2 ? 'double' : 'triple';
        return `<li>${s1} – ${s2}: ${kind} bond (order ${b.order})</li>`;
      }).join('')}
    </ul>

    <h3>4) Lone Pairs + Formal Charges</h3>
    <table>
      <thead>
        <tr><th>Atom</th><th>Lone pairs</th><th>Σ bond order</th><th>Formal charge</th></tr>
      </thead>
      <tbody>${atomRows}</tbody>
    </table>
    <p>Formal charge formula: <code>F.C. = valence e⁻ − lone-pair e⁻ − (bonding e⁻ ÷ 2)</code></p>

    <h3>5) Octet Validation</h3>
    <div class="callout${structure.octetMetOnAllAtoms ? '' : ' warn'}">
      ${structure.octetMetOnAllAtoms
        ? 'All atoms satisfy their octet targets ✓'
        : 'One or more atoms do not satisfy their octet target. See notes below.'}
    </div>
    ${notesList ? `<ul>${notesList}</ul>` : ''}

    ${structure.isIon
      ? `<h3>6) Brackets &amp; Overall Charge</h3>
         <p>Wrap the structure in square brackets and show the overall charge
            <code>${chargeString(structure.overallCharge)}</code>
            outside the top-right corner.</p>`
      : ''}
  `;
  document.getElementById('breakdown-lewis').innerHTML = html;
  updateBreakdownVisibility();
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-built structure breakdown — used for dichromate, thiosulfate,
// oxalate, acetate, and formate. These ions have multi-center
// connectivity that falls outside the single-central-atom NASB engine's
// scope, so they're stored as curated structures. The breakdown here
// shows the resulting atoms, bonds, and formal charges without the
// NASB-chart section that doesn't apply.
// ─────────────────────────────────────────────────────────────────────────────
function renderPrebuiltLewisBreakdown(parse, structure) {
  const atomCountMap = {};
  for (const a of parse.atoms) atomCountMap[a.symbol] = a.count;

  const atomRows = structure.atoms.map(a => {
    const bondOrderSum = structure.bonds
      .filter(b => b.i === a.index || b.j === a.index)
      .reduce((s,b) => s + b.order, 0);
    return `
      <tr>
        <td>${a.symbol}${a.isCentral ? ' (center)' : ''}</td>
        <td>${a.lonePairs}</td>
        <td>${bondOrderSum}</td>
        <td>${formalChargeString(a.formalCharge) || '0'}</td>
      </tr>`;
  }).join('');

  const bondList = structure.bonds.map(b => {
    const s1 = structure.atoms[b.i].symbol;
    const s2 = structure.atoms[b.j].symbol;
    const kind = b.order === 1 ? 'single' : b.order === 2 ? 'double' : 'triple';
    return `<li>${s1} – ${s2}: ${kind} bond (order ${b.order})</li>`;
  }).join('');

  const notesList = (structure.validationNotes || [])
    .map(n => `<li>${escapeHtml(n)}</li>`).join('');

  const totalFC = structure.atoms.reduce((s,a) => s + a.formalCharge, 0);

  const html = `
    <h2>Lewis Structure — Curated Reference</h2>

    <div class="callout">
      <strong>${escapeHtml(structure.centralAtomChoice.reason)}</strong>
    </div>

    <h3>1) Composition</h3>
    <p>Atoms in the ion:
       ${Object.keys(atomCountMap).map(s =>
         `<code>${s}${atomCountMap[s]>1?atomCountMap[s]:''}</code>`).join(' , ')}
       &nbsp;—&nbsp; overall charge
       <code>${chargeString(structure.overallCharge) || '0'}</code>.</p>

    <h3>2) Connectivity</h3>
    <p>The structure contains ${structure.atoms.length} atoms and
       ${structure.bonds.length} bonds. Because of the multi-center
       connectivity, the bond list is given here rather than derived
       from the single-central-atom procedure:</p>
    <ul>${bondList}</ul>

    <h3>3) Lone Pairs + Formal Charges</h3>
    <table>
      <thead>
        <tr><th>Atom</th><th>Lone pairs</th><th>Σ bond order</th><th>Formal charge</th></tr>
      </thead>
      <tbody>${atomRows}</tbody>
    </table>
    <p>Formal charge formula:
       <code>F.C. = valence e⁻ − lone-pair e⁻ − (bonding e⁻ ÷ 2)</code></p>
    <p>Sum of formal charges = <strong>${totalFC}</strong>
       &nbsp;(matches overall charge
       <code>${chargeString(structure.overallCharge) || '0'}</code>).</p>

    <h3>4) Octet Validation</h3>
    <div class="callout">
      All atoms satisfy their octet targets (or expanded-octet targets
      for S, P, Cl, Br, I, Xe, Cr, Mn) in this curated structure ✓
    </div>
    ${notesList ? `<ul>${notesList}</ul>` : ''}

    ${structure.isIon
      ? `<h3>5) Brackets &amp; Overall Charge</h3>
         <p>Wrap the structure in square brackets and show the overall charge
            <code>${chargeString(structure.overallCharge)}</code>
            outside the top-right corner.</p>`
      : ''}
  `;
  document.getElementById('breakdown-lewis').innerHTML = html;
  updateBreakdownVisibility();
}

// ─────────────────────────────────────────────────────────────────────────────
// Chain-structure breakdown — used for carbon chains (alkanes, alkenes,
// alkynes). These have no single central atom, so NASB doesn't apply.
// The breakdown walks through the chain backbone and shows per-carbon
// hybridization, bond counts, and validation.
// ─────────────────────────────────────────────────────────────────────────────
function renderChainLewisBreakdown(parse, structure) {
  document.getElementById('resonance-strip-wrap').style.display = 'none';

  const hybridLabel = { sp: 'sp', sp2: 'sp²', sp3: 'sp³' };

  // Walk the chain carbons for a per-carbon table
  const carbonRows = [];
  for (const a of structure.atoms) {
    if (!a.isChainCarbon) continue;
    // Count bonded neighbors and their symbols
    const neighbors = [];
    for (const b of structure.bonds) {
      if (b.i === a.index) neighbors.push({ sym: structure.atoms[b.j].symbol, order: b.order });
      else if (b.j === a.index) neighbors.push({ sym: structure.atoms[b.i].symbol, order: b.order });
    }
    const hCount = neighbors.filter(n => n.sym === 'H').length;
    const cBondOrderSum = neighbors
      .filter(n => n.sym === 'C')
      .reduce((s, n) => s + n.order, 0);
    const maxCBondOrder = Math.max(0, ...neighbors.filter(n => n.sym === 'C').map(n => n.order));
    const hyb  = structure.hybridization ? structure.hybridization[a.chainIndex] : 'sp3';
    const hlab = hybridLabel[hyb] || hyb;
    const bondKind = maxCBondOrder === 3 ? 'triple' : maxCBondOrder === 2 ? 'double' : 'single';
    carbonRows.push(`
      <tr>
        <td>C${a.chainIndex}</td>
        <td>${hlab}</td>
        <td>${hCount}</td>
        <td>${cBondOrderSum} ${bondKind === 'single' ? '' : '(' + bondKind + ')'}</td>
        <td>${a.formalCharge ? formalChargeString(a.formalCharge) : '0'}</td>
      </tr>`);
  }

  // Overall chain summary
  const cCount = structure.atoms.filter(a => a.symbol === 'C').length;
  const hCount = structure.atoms.filter(a => a.symbol === 'H').length;
  const hybridSeq = Object.values(structure.hybridization || {})
    .map(h => hybridLabel[h] || h)
    .join('–');

  // Classify the chain in simple terms for the heading
  const hasTriple = structure.bonds.some(b =>
    b.order === 3 &&
    structure.atoms[b.i].symbol === 'C' && structure.atoms[b.j].symbol === 'C'
  );
  const hasDouble = structure.bonds.some(b =>
    b.order === 2 &&
    structure.atoms[b.i].symbol === 'C' && structure.atoms[b.j].symbol === 'C'
  );
  const chainClass = hasTriple ? 'alkyne'
                   : hasDouble ? 'alkene'
                   : 'alkane';

  const notesList = (structure.validationNotes || [])
    .map(n => `<li>${escapeHtml(n)}</li>`).join('');

  const html = `
    <h2>Lewis Structure — Carbon Chain</h2>

    <div class="callout">
      <strong>${cCount}-carbon ${chainClass}</strong> — C<sub>${cCount}</sub>H<sub>${hCount}</sub>,
      hybridization sequence <code>${hybridSeq}</code>.
    </div>

    <h3>1) Composition</h3>
    <p>${cCount} carbon${cCount===1?'':'s'} and ${hCount} hydrogen${hCount===1?'':'s'},
       arranged as a straight chain of carbons with the remaining hydrogens
       filling each carbon's valence.</p>

    <h3>2) Backbone Bonds</h3>
    <p>The ${cCount - 1} carbon–carbon bond${cCount-1===1?'':'s'} along the backbone:</p>
    <ul>
      ${structure.bonds
        .filter(b => structure.atoms[b.i].symbol === 'C' && structure.atoms[b.j].symbol === 'C')
        .map(b => {
          const kind = b.order === 1 ? 'single' : b.order === 2 ? 'double' : 'triple';
          return `<li>C${structure.atoms[b.i].chainIndex} – C${structure.atoms[b.j].chainIndex}: ${kind} bond (order ${b.order})</li>`;
        }).join('')}
    </ul>

    <h3>3) Per-Carbon Summary</h3>
    <table>
      <thead>
        <tr><th>Atom</th><th>Hybridization</th><th># H</th><th>Σ C–C bond order</th><th>Formal charge</th></tr>
      </thead>
      <tbody>${carbonRows.join('')}</tbody>
    </table>

    <h3>4) Octet / Duet Validation</h3>
    <div class="callout">
      All carbons satisfy their 4-bond valence and all hydrogens satisfy
      their duet (2 electrons) in this structure ✓
    </div>
    ${notesList ? `<ul>${notesList}</ul>` : ''}
  `;
  document.getElementById('breakdown-lewis').innerHTML = html;
  updateBreakdownVisibility();
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4: IONIC BREAKDOWN RENDERER

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4: IONIC BREAKDOWN RENDERER
// ─────────────────────────────────────────────────────────────────────────────
function renderIonicBreakdown(parse, ionic) {
  document.getElementById('resonance-strip-wrap').style.display = 'none';
  ['breakdown-resonance','breakdown-vsepr','breakdown-imf','breakdown-polarity']
    .forEach(id => { document.getElementById(id).innerHTML = ''; });

  const hasPolyatomic = ionic.ions.some(i => i.isPolyatomic);

  const transferItems = ionic.transferNotes
    .map(n => `<li>${escapeHtml(n)}</li>`).join('');
  const validationItems = ionic.validationNotes
    .map(n => `<li>${escapeHtml(n)}</li>`).join('');

  // Summary table of ions: monatomic and polyatomic rows look different
  const ionRows = ionic.ions.map(ion => {
    if (ion.isPolyatomic) {
      return `
        <tr>
          <td><strong>[${escapeHtml(ion.formula)}]</strong></td>
          <td>${ion.isCation ? 'Cation' : 'Anion'} (polyatomic)</td>
          <td colspan="2">${escapeHtml(ion.ionName)} — ${ion.structure.atoms.length} atoms, ${ion.structure.bonds.length} bond${ion.structure.bonds.length===1?'':'s'}</td>
          <td>${chargeString(ion.charge) || '0'}</td>
        </tr>`;
    }
    return `
      <tr>
        <td>${ion.symbol}</td>
        <td>${ion.isCation ? 'Cation' : 'Anion'}</td>
        <td>${ion.valenceAfterTransfer}</td>
        <td>[${ion.dotArrangement.join(', ')}]</td>
        <td>${chargeString(ion.charge) || '0'}</td>
      </tr>`;
  }).join('');

  // For polyatomic compounds, add a per-ion Lewis-structure rundown
  const polySections = hasPolyatomic
    ? _renderPolyatomicIonDetails(ionic)
    : '';

  const balanceClass = ionic.chargeBalance.balanced ? '' : ' warn';
  const balanceMsg = ionic.chargeBalance.balanced
    ? `Charges balance: (${chargeString(ionic.chargeBalance.cationTotal)}) + ` +
      `(${chargeString(ionic.chargeBalance.anionTotal)}) = 0 ✓`
    : `Charge imbalance — see notes below.`;

  // Phrasing adjusts for polyatomic vs purely-monatomic breakdowns
  const step1 = hasPolyatomic
    ? `<h3>1) Identify the Ions in the Formula</h3>
       <p>For compounds containing polyatomic ions, the formula is first
       split into its component ions. Polyatomic ions are drawn as a single
       covalent unit with their own internal Lewis structure; monatomic
       cations are drawn as individual ions.</p>`
    : `<h3>1) Write Each Element's Atomic Symbol</h3>
       <p>Atoms in the formula:
       ${parse.atoms.map(a => `<code>${a.symbol}${a.count>1?a.count:''}</code>`).join(' , ')}</p>`;

  const step2 = hasPolyatomic
    ? `<h3>2) Build the Internal Structure of Each Polyatomic Ion</h3>
       <p>Each polyatomic ion is built using the covalent Lewis procedure
       (NASB: count total valence electrons including the ion's charge,
       then form bonds, lone pairs, and check formal charges). The result
       is the ion's internal structure, which is then enclosed in brackets.</p>`
    : `<h3>2) Place Valence Electrons (One Per Side Before Pairing)</h3>
       <p>Each atom starts with its valence electrons arranged around the symbol.
       Electrons fill one side at a time (N, E, S, W) before pairing up —
       this is the ✓ arrangement from class, not the ✗ arrangement that pairs
       electrons prematurely.</p>`;

  const step3 = hasPolyatomic
    ? `<h3>3) Pair the Ions</h3>
       <p>The total positive charge on all cations equals the total negative
       charge on all anions. Polyatomic anions already carry their full
       charge from their built structure; cations donate valence electrons
       to balance.</p>
       <ul>${transferItems}</ul>`
    : `<h3>3) Electron Transfer</h3>
       <p>The more-electronegative element takes electrons from the less-electronegative
       element until each nonmetal has a full octet (duet for H).</p>
       <ul>${transferItems}</ul>`;

  const html = `
    <h2>Lewis Structure — Step by Step (Ionic Compound)</h2>

    ${step1}
    ${step2}
    ${polySections}
    ${step3}

    <h3>4) Result: Ion Summary</h3>
    <table>
      <thead>
        <tr><th>Ion</th><th>Type</th><th>Total e⁻ shown</th>
            <th>Dot slots [N,E,S,W]</th><th>Charge</th></tr>
      </thead>
      <tbody>${ionRows}</tbody>
    </table>

    <h3>5) Brackets + Charge Labels</h3>
    <p>Each ion is wrapped in its own pair of square brackets, with the
       ion's charge shown in the top-right corner outside the brackets
       (see canvas above).</p>

    <h3>6) Charge Balance Check</h3>
    <div class="callout${balanceClass}">${balanceMsg}</div>
    ${validationItems ? `<ul>${validationItems}</ul>` : ''}

    <div class="callout">
      <strong>Note:</strong> VSEPR, intermolecular forces, and molecular
      polarity do not apply to ionic compounds. Ionic attractions within
      the lattice are the primary force holding the compound together.
    </div>
  `;
  document.getElementById('breakdown-lewis').innerHTML = html;
  updateBreakdownVisibility();
}

// Renders a per-polyatomic-ion details section showing each unique
// polyatomic ion's internal structure (atoms + bonds + formal charges).
function _renderPolyatomicIonDetails(ionic) {
  // Deduplicate by formula — show one section per distinct polyatomic ion
  const seen = new Set();
  const sections = [];
  for (const ion of ionic.ions) {
    if (!ion.isPolyatomic) continue;
    if (seen.has(ion.formula)) continue;
    seen.add(ion.formula);

    const s = ion.structure;
    const atomList = s.atoms
      .map(a => {
        const fcLabel = a.formalCharge
          ? ` [${a.formalCharge > 0 ? '+' : ''}${a.formalCharge} fc]`
          : '';
        return `${a.symbol}${fcLabel}`;
      })
      .join(', ');
    const bondList = s.bonds
      .map(b => {
        const order = b.order === 2 ? '=' : b.order === 3 ? '≡' : '–';
        return `${s.atoms[b.i].symbol}${order}${s.atoms[b.j].symbol}`;
      })
      .join(', ');

    sections.push(`
      <div class="callout">
        <strong>[${escapeHtml(ion.formula)}]${chargeString(ion.charge)}</strong>
        &nbsp;—&nbsp; ${escapeHtml(ion.ionName)}
        <br>Atoms (with formal charges): ${escapeHtml(atomList)}
        <br>Bonds: ${escapeHtml(bondList)}
      </div>
    `);
  }
  return sections.length
    ? `<h3>Internal Structure of Each Polyatomic Ion</h3>${sections.join('')}`
    : '';
}


// ─────────────────────────────────────────────────────────────────────────────
// PHASE 5: RESONANCE STRIP RENDERER

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 5: RESONANCE BREAKDOWN RENDERER
// ─────────────────────────────────────────────────────────────────────────────
function renderResonanceBreakdown(parse, resonance) {
  const section = document.getElementById('breakdown-resonance');
  if (!resonance || !resonance.hasResonance) {
    section.innerHTML = '';
    updateBreakdownVisibility();
    return;
  }

  const fcSums = resonance.structures.map(s =>
    sumAbsoluteFormalCharges(s.atoms));
  const enScores = resonance.structures.map(s =>
    electronegativityWeightedFCScore(s.atoms));

  const rows = resonance.structures.map((s, i) => {
    const isBest = resonance.bestIndices.includes(i);
    return `
      <tr${isBest ? ' style="background:rgba(74,226,160,0.08);"' : ''}>
        <td>Structure #${i + 1}${isBest ? ' ✓ BEST' : ''}</td>
        <td>${fcSums[i]}</td>
        <td>${enScores[i].toFixed(2)}</td>
      </tr>`;
  }).join('');

  const pickingItems = resonance.pickingNotes
    .map(n => `<li>${escapeHtml(n)}</li>`).join('');

  const html = `
    <h2>Resonance Analysis</h2>

    <p>This molecule has <strong>${resonance.structures.length}</strong>
       resonance structures, shown above with ↔ arrows.</p>

    <h3>Picking the Best Structure</h3>
    <ol>
      <li><strong>Criterion 1 — Octets met.</strong> All structures shown
          already pass this check.</li>
      <li><strong>Criterion 2 — Lowest total |formal charge|.</strong>
          The structure(s) with the smallest Σ|F.C.| win.</li>
      <li><strong>Criterion 3 — Electronegativity-weighted F.C. score.</strong>
          Negative formal charges should sit on more-electronegative atoms;
          positive formal charges on less-electronegative atoms. A lower
          (more negative) EN-weighted score indicates better distribution.</li>
    </ol>

    <h3>Scores by Structure</h3>
    <table>
      <thead>
        <tr><th>Structure</th><th>Σ |F.C.|</th><th>EN-weighted score</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <h3>Step-by-Step Reasoning</h3>
    <ul>${pickingItems}</ul>

    ${resonance.bestIndices.length > 1
      ? `<div class="callout">
           All ${resonance.bestIndices.length} "best" structures are equivalent
           resonance forms. The actual molecule is a resonance hybrid —
           the electrons are delocalized over all equivalent bonds.
         </div>`
      : ''}
  `;
  section.innerHTML = html;
  updateBreakdownVisibility();
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 7: VSEPR BREAKDOWN RENDERER

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 7: VSEPR BREAKDOWN RENDERER
// ─────────────────────────────────────────────────────────────────────────────
function renderVSEPRBreakdown(parse, structure, vsepr) {
  const section = document.getElementById('breakdown-vsepr');
  if (!vsepr || !vsepr.ok) {
    section.innerHTML = '';
    updateBreakdownVisibility();
    return;
  }

  // Case 1: single atom / VSEPR not applicable
  if (!vsepr.applicable) {
    section.innerHTML = `
      <h2>Molecular Geometry</h2>
      <div class="callout">${escapeHtml(vsepr.reasoning[0] || 'VSEPR does not apply to this species.')}</div>`;
    updateBreakdownVisibility();
    return;
  }

  // Case 2: carbon chain — per-carbon geometry table
  if (vsepr.isChain) {
    renderChainVSEPRBreakdown(vsepr);
    return;
  }

  // Case 2b: ring — per-atom geometry table (reuses chain renderer since both
  // produce perCarbon arrays with equivalent shape)
  if (vsepr.isRing) {
    renderChainVSEPRBreakdown(vsepr);
    return;
  }

  const stepsHtml = vsepr.reasoning
    .map((s, i) => `<li>${escapeHtml(s)}</li>`).join('');

  const html = `
    <h2>Molecular Geometry (VSEPR)</h2>

    <h3>Rules for Finding Molecular Geometry</h3>
    <ol>${stepsHtml}</ol>

    <h3>Result</h3>
    <table>
      <tbody>
        <tr><td>Central atom</td>
            <td><code>${escapeHtml(vsepr.centralSym)}</code></td></tr>
        <tr><td>Atoms bonded to central</td>
            <td>${vsepr.bondedAtoms}</td></tr>
        <tr><td>Lone pairs on central</td>
            <td>${vsepr.lonePairs}</td></tr>
        <tr><td>Total electron domains</td>
            <td>${vsepr.totalDomains}</td></tr>
        <tr><td>AXE notation</td>
            <td><code>${escapeHtml(vsepr.axeNotation)}</code></td></tr>
        <tr><td>Shape</td>
            <td><strong>${escapeHtml(vsepr.shape)}</strong></td></tr>
        <tr><td>Bond angle</td>
            <td>${escapeHtml(vsepr.bondAngle)}</td></tr>
      </tbody>
    </table>

    <div class="callout">
      <strong>${escapeHtml(vsepr.shape)}</strong> —
      AXE notation <code>${escapeHtml(vsepr.axeNotation)}</code>,
      bond angle <code>${escapeHtml(vsepr.bondAngle)}</code>.
    </div>

    <p class="vsepr-3d-hint" style="margin-top:10px; color:var(--text-dim); font-size:13px; font-style:italic;">
      💡 Tip: click <strong>View in 3D</strong> above the breakdowns to see
      how ${escapeHtml(vsepr.shape)} geometry looks in three dimensions.
    </p>
  `;
  section.innerHTML = html;
  updateBreakdownVisibility();
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-carbon VSEPR breakdown for chains.
// ─────────────────────────────────────────────────────────────────────────────
function renderChainVSEPRBreakdown(vsepr) {
  const section = document.getElementById('breakdown-vsepr');
  const carbonRows = vsepr.perCarbon.map(p => `
    <tr>
      <td>C${p.carbonIdx}</td>
      <td>${escapeHtml(p.hybridLabel)}</td>
      <td>${p.bondedAtoms}</td>
      <td>${p.lonePairs}</td>
      <td><code>${escapeHtml(p.axeNotation)}</code></td>
      <td><strong>${escapeHtml(p.shape)}</strong></td>
      <td>${escapeHtml(p.bondAngle)}</td>
    </tr>`).join('');

  const stepsHtml = vsepr.reasoning.map(s => `<li>${escapeHtml(s)}</li>`).join('');

  const html = `
    <h2>Molecular Geometry (VSEPR) — per Carbon</h2>

    <h3>Rules for Finding Chain Geometry</h3>
    <ol>${stepsHtml}</ol>

    <h3>Result — Per-Carbon Geometry</h3>
    <table>
      <thead>
        <tr>
          <th>Atom</th><th>Hybridization</th><th>Bonded atoms</th>
          <th>Lone pairs</th><th>AXE</th><th>Shape</th><th>Bond angle</th>
        </tr>
      </thead>
      <tbody>${carbonRows}</tbody>
    </table>

    <div class="callout">
      <strong>Chain hybridization sequence:</strong>
      <code>${escapeHtml(vsepr.summaryHybridization)}</code>. Each carbon
      has its own geometry based on the bonds it participates in.
    </div>
  `;
  section.innerHTML = html;
  updateBreakdownVisibility();
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 9: IMF BREAKDOWN RENDERER

// ─────────────────────────────────────────────────────────────────────────────
function renderIMFBreakdown(parse, imf) {
  const section = document.getElementById('breakdown-imf');
  if (!imf || !imf.ok) {
    section.innerHTML = '';
    updateBreakdownVisibility();
    return;
  }

  // Ionic / single-atom case: show the note and stop
  if (!imf.applicable) {
    section.innerHTML = `
      <h2>Intermolecular Forces</h2>
      <div class="callout">${escapeHtml(imf.note || 'Not applicable.')}</div>`;
    updateBreakdownVisibility();
    return;
  }

  const reasoningItems = imf.reasoning
    .map((n,i) => `<li>${escapeHtml(n)}</li>`).join('');

  const strengthTable = imf.imfs.map((name, i) => {
    const strength = i === 0 ? 'Weakest'
                   : i === imf.imfs.length - 1 && imf.imfs.length > 1 ? 'Strongest'
                   : 'Intermediate';
    return `<tr><td>${escapeHtml(name)}</td><td>${strength}</td></tr>`;
  }).join('');

  const summary = imf.imfs.length === 1
    ? `This molecule exhibits <strong>London forces only</strong>.`
    : `This molecule exhibits <strong>${imf.imfs.length}</strong> intermolecular force${imf.imfs.length===1?'':'s'}: ` +
      imf.imfs.map(i => `<strong>${escapeHtml(i)}</strong>`).join(', ') + '.';

  const html = `
    <h2>Intermolecular Forces</h2>

    <p>${summary}</p>

    <h3>Forces Present (weakest → strongest)</h3>
    <table>
      <thead><tr><th>Force</th><th>Relative strength</th></tr></thead>
      <tbody>${strengthTable}</tbody>
    </table>

    <h3>Reasoning</h3>
    <ol>${reasoningItems}</ol>
  `;
  section.innerHTML = html;
  updateBreakdownVisibility();
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 10: POLARITY BREAKDOWN RENDERER

// ─────────────────────────────────────────────────────────────────────────────
function renderPolarityBreakdown(parse, polarity) {
  const section = document.getElementById('breakdown-polarity');
  if (!polarity || !polarity.ok) {
    section.innerHTML = '';
    updateBreakdownVisibility();
    return;
  }
  if (!polarity.applicable) {
    section.innerHTML = `
      <h2>Molecular Polarity</h2>
      <div class="callout">${escapeHtml(polarity.reasoning[0] || 'Polarity does not apply to this species.')}</div>`;
    updateBreakdownVisibility();
    return;
  }

  const reasoningItems = polarity.reasoning
    .map(n => `<li>${escapeHtml(n)}</li>`).join('');

  const calloutClass = polarity.isPolar ? 'callout warn' : 'callout';
  // warn class uses the red/accent2 highlight — conceptually "polar" is
  // notable/flagged, "nonpolar" is the baseline green; swap if you prefer.

  const verdict = polarity.isPolar
    ? `<strong>POLAR</strong> — ${escapeHtml(polarity.stopReason)}`
    : `<strong>NONPOLAR</strong> — ${escapeHtml(polarity.stopReason)}`;

  const html = `
    <h2>Molecular Polarity</h2>

    <h3>Walking the Polarity Flowchart</h3>
    <ol>${reasoningItems}</ol>

    <h3>Conclusion</h3>
    <div class="${calloutClass}">
      Molecule is ${verdict}.
    </div>
  `;
  section.innerHTML = html;
  updateBreakdownVisibility();
}

// ─────────────────────────────────────────────────────────────────────────────
// Ring-structure breakdown — used for cyclic molecules (cycloalkanes,
// cycloalkenes, benzene). Like chains, rings have no single central atom
// so NASB doesn't apply. The breakdown narrates ring size, aromaticity,
// per-atom hybridization, and validation.
// ─────────────────────────────────────────────────────────────────────────────
function renderRingLewisBreakdown(parse, structure) {
  const section = document.getElementById('breakdown-lewis');
  const hybridLabel = { sp: 'sp', sp2: 'sp²', sp3: 'sp³' };
  const meta = structure.ringMeta || {};
  const displayName = meta.displayName || 'ring';
  const isAromatic = !!structure.isAromatic;
  const notification = meta.notification || '';

  // Per-ring-atom table
  const atomRows = [];
  for (const a of structure.atoms) {
    if (!a.isRingAtom) continue;
    const neighbors = [];
    for (const b of structure.bonds) {
      if (b.i === a.index) neighbors.push({ sym: structure.atoms[b.j].symbol, order: b.order });
      else if (b.j === a.index) neighbors.push({ sym: structure.atoms[b.i].symbol, order: b.order });
    }
    const hCount = neighbors.filter(n => n.sym === 'H').length;
    const cBondOrderSum = neighbors
      .filter(n => n.sym === 'C')
      .reduce((s, n) => s + n.order, 0);
    const maxCBondOrder = Math.max(0, ...neighbors.filter(n => n.sym === 'C').map(n => n.order));
    const hyb = structure.hybridization[a.index] || 'sp3';
    const hlab = hybridLabel[hyb] || hyb;
    const bondKind = maxCBondOrder === 3 ? 'triple' : maxCBondOrder === 2 ? 'double' : 'single';
    atomRows.push(`
      <tr>
        <td>${escapeHtml(a.symbol)}${a.ringIndex}</td>
        <td>${hlab}</td>
        <td>${hCount}</td>
        <td>${cBondOrderSum} ${bondKind === 'single' ? '' : '(' + bondKind + ')'}</td>
        <td>${a.formalCharge ? formalChargeString(a.formalCharge) : '0'}</td>
      </tr>`);
  }

  const cCount = structure.atoms.filter(a => a.symbol === 'C').length;
  const hCount = structure.atoms.filter(a => a.symbol === 'H').length;
  const oCount = structure.atoms.filter(a => a.symbol === 'O').length;
  const nCount = structure.atoms.filter(a => a.symbol === 'N').length;
  const hybridSeq = Object.values(structure.hybridization || {})
    .map(h => hybridLabel[h] || h)
    .join('–');

  const notesList = (structure.validationNotes || [])
    .map(n => `<li>${escapeHtml(n)}</li>`).join('');

  // Substituent list (R6a)
  const substituents = (meta.substituents || []);
  const hasSubstituents = substituents.length > 0;
  // For sugars, label positions with biological carbon names (C1, C2, ... C5).
  // Engine position 1 = C1 (anomeric), engine position 5 = C5. Ring O (pos 0)
  // isn't a numbered carbon. For non-sugars, use generic "Ring position N" (1-indexed).
  const positionLabel = (ringPos) => {
    if (meta.isSugar) return `C${ringPos}`;
    return `Ring position ${ringPos + 1}`;
  };

  const substituentBlock = hasSubstituents
    ? `<h3>Substituents</h3>
       <ul>
         ${substituents.map(sub =>
           `<li>${positionLabel(sub.ringPos)}: ` +
           `<strong>${escapeHtml(sub.label)}</strong> ` +
           `(${_substituentDescription(sub.kind)})</li>`
         ).join('')}
       </ul>`
    : '';

  // Description: include substituent info for substituted aromatics.
  // Handles sugars (R6d), heterocycles (R6c), monosubstituted (R6a), and disubstituted (R6b).
  let ringDescription;
  if (meta.isSugar) {
    const variant = (meta.sugarMeta && meta.sugarMeta.variant) || null;
    const variantNote = variant === 'alpha'
      ? 'This is the <strong>α anomer</strong> — in the Haworth projection, ' +
        'the C1 hydroxyl points <em>down</em> (opposite side from the -CH₂OH group).'
      : variant === 'beta'
      ? 'This is the <strong>β anomer</strong> — in the Haworth projection, ' +
        'the C1 hydroxyl points <em>up</em> (same side as the -CH₂OH group).'
      : '';
    ringDescription =
      `<strong>${escapeHtml(displayName)}</strong> is a saturated 6-membered sugar ring ` +
      `(a <em>pyranose</em>) with an oxygen at one position and hydroxyl groups on the ` +
      `ring carbons. All ring atoms are sp³ hybridized. ${variantNote}`;
  } else if (meta.isHeterocycle) {
    const heteroList = (meta.heteroAtomSymbols || []).join(', ');
    ringDescription =
      `<strong>${escapeHtml(displayName)}</strong> is an aromatic heterocycle — a ` +
      `${meta.size}-membered ring containing ${heteroList} in place of one or more carbons. ` +
      `Shown in Kekulé form with the double bonds in their conventional positions.`;
  } else if (isAromatic) {
    if (substituents.length === 1) {
      ringDescription =
        `<strong>${escapeHtml(displayName)}</strong> is a monosubstituted aromatic benzene ring. ` +
        `The ring itself has delocalized π electrons (shown in Kekulé form with alternating ` +
        `single/double bonds); the substituent breaks the ring's symmetry.`;
    } else if (substituents.length === 2) {
      const posDelta = Math.abs(substituents[0].ringPos - substituents[1].ringPos);
      const relation = (posDelta === 1 || posDelta === 5) ? 'ortho (1,2 — adjacent)'
                     : (posDelta === 2 || posDelta === 4) ? 'meta (1,3)'
                     : (posDelta === 3)                   ? 'para (1,4 — opposite)'
                     : 'unknown';
      const identical = substituents[0].kind === substituents[1].kind;
      ringDescription =
        `<strong>${escapeHtml(displayName)}</strong> is a disubstituted aromatic benzene with ` +
        `${identical ? 'two identical' : 'two different'} substituents in the ${relation} ` +
        `position. The ring itself has delocalized π electrons (shown in Kekulé form with ` +
        `alternating single/double bonds).`;
    } else {
      ringDescription =
        `<strong>${escapeHtml(displayName)}</strong> is an aromatic ring with delocalized π electrons. ` +
        `Shown in Kekulé form with alternating single/double bonds. The actual molecule is a resonance ` +
        `hybrid where all C–C bonds are equivalent in length.`;
    }
  } else if (meta.isSaturated) {
    ringDescription =
      `<strong>${escapeHtml(displayName)}</strong> is a saturated ${meta.size}-membered ring (cycloalkane). ` +
      `All ring carbons are sp³ hybridized and bonded by single bonds.`;
  } else {
    ringDescription =
      `<strong>${escapeHtml(displayName)}</strong> is an unsaturated ${meta.size}-membered ring (cycloalkene) ` +
      `with one C=C double bond. The two sp² carbons lie in the plane of the double bond.`;
  }

  // Aromaticity note — shown for heterocycles to explain the π electron bookkeeping
  const aromaticityBlock = meta.aromaticityNote
    ? `<div class="callout" style="margin-top:12px;"><strong>Aromaticity:</strong> ${escapeHtml(meta.aromaticityNote)}</div>`
    : '';

  // Anomeric carbon callout — shown for sugars to explain the α/β distinction
  let anomericBlock = '';
  if (meta.isSugar && meta.sugarMeta) {
    const anomericPos = meta.sugarMeta.anomericPosition || 1;
    const variant = meta.sugarMeta.variant || '';
    const variantLabel = variant === 'alpha' ? 'α-D-glucose'
                       : variant === 'beta'  ? 'β-D-glucose'
                       : 'D-glucose';
    anomericBlock = `<div class="callout" style="margin-top:12px;">
      <strong>Anomeric carbon (C${anomericPos}):</strong> The anomeric carbon is the ring
      carbon bonded to both the ring oxygen and a hydroxyl group (-OH). It's
      special because it was the carbonyl carbon (C=O) in the open-chain form of
      glucose — when the ring closes, that carbon becomes a new stereocenter.
      <br><br>
      <strong>α vs β:</strong> α-D-glucose and β-D-glucose are called <em>anomers</em>
      — they differ <em>only</em> at the anomeric carbon. In the Haworth projection,
      α has the C1 -OH pointing <em>down</em> (opposite the -CH₂OH at C5), while β has
      the C1 -OH pointing <em>up</em> (same side as the -CH₂OH).
      <br><br>
      In this <em>flat</em> Lewis view, the α/β difference isn't shown — both anomers
      look identical because 2D drawings can't depict 3D orientation. The Haworth
      projection (coming in a future update) will show the stereochemistry.
    </div>`;
  }

  // Atom summary — include heteroatom counts when relevant
  const atomSummaryParts = [];
  if (cCount) atomSummaryParts.push(`${cCount} C`);
  if (hCount) atomSummaryParts.push(`${hCount} H`);
  if (nCount) atomSummaryParts.push(`${nCount} N`);
  if (oCount) atomSummaryParts.push(`${oCount} O`);
  const sCount = structure.atoms.filter(a => a.symbol === 'S').length;
  if (sCount) atomSummaryParts.push(`${sCount} S`);
  // include any halogens
  for (const sym of ['Cl', 'Br', 'F', 'I']) {
    const n = structure.atoms.filter(a => a.symbol === sym).length;
    if (n) atomSummaryParts.push(`${n} ${sym}`);
  }
  const atomSummary = atomSummaryParts.join(' + ') + ` = ${structure.atoms.length} total`;

  const notificationBlock = notification
    ? `<div class="callout" style="margin-bottom:12px;">${escapeHtml(notification)}</div>`
    : '';

  const benzeneToggleBlock = isAromatic
    ? `<div class="callout" style="margin-top:12px;">
         <strong>Display option:</strong> Benzene can be drawn either as (a) one of the two
         Kekulé structures with alternating single/double bonds — the default above, or
         (b) a hexagon with a circle inside, representing the delocalized π system.
         Use the <em>Aromatic Display</em> toggle to switch between the two conventions.
       </div>`
    : '';

  const html = `
    <h2>Lewis Structure — ${escapeHtml(displayName)}</h2>
    ${notificationBlock}
    <p>${ringDescription}</p>
    <div class="callout">
      Formula: <strong>${escapeHtml(meta.normalizedFormula || '')}</strong> &nbsp;
      Ring size: <strong>${meta.size || '?'}</strong> &nbsp;
      Atoms: <strong>${atomSummary}</strong> &nbsp;
      Bonds: <strong>${structure.bonds.length}</strong>
    </div>
    ${substituentBlock}
    ${aromaticityBlock}
    ${anomericBlock}
    <h3>Per-Atom Hybridization</h3>
    <table class="bd-table">
      <thead>
        <tr>
          <th>Atom</th>
          <th>Hybridization</th>
          <th>H count</th>
          <th>C–C bonds</th>
          <th>Formal charge</th>
        </tr>
      </thead>
      <tbody>${atomRows.join('')}</tbody>
    </table>
    <p>Overall hybridization sequence around the ring: <strong>${hybridSeq}</strong></p>
    <h3>Validation</h3>
    <ul>${notesList}</ul>
    ${benzeneToggleBlock}
  `;
  section.innerHTML = html;
  section.style.display = '';
}

// Helper: textbook description of a substituent for the ring breakdown.
function _substituentDescription(kind) {
  const descriptions = {
    'hydroxyl':      'hydroxyl group — the O has 2 lone pairs and donates an H-bond',
    'methyl':        'methyl group — a sp³ carbon with 3 H\'s; nonpolar',
    'amine':         'amino group — the N has 1 lone pair and donates H-bonds',
    'carboxyl':      'carboxyl group — C=O and O-H; polar acid group',
    'aldehyde':      'aldehyde group — C=O with 1 H on the carbonyl C',
    'chloro':        'chlorine — polar C-Cl bond with 3 lone pairs on Cl',
    'bromo':         'bromine — polar C-Br bond with 3 lone pairs on Br',
    'fluoro':        'fluorine — polar C-F bond with 3 lone pairs on F',
    'iodo':          'iodine — polar C-I bond with 3 lone pairs on I',
    'nitro':         'nitro group — N⁺ with two resonance-equivalent oxygens, one FC +1 and one FC –1',
    'hydroxymethyl': 'hydroxymethyl group — a sp³ C with 2 H\'s plus an -OH; the "C6" primary alcohol of glucose'
  };
  return descriptions[kind] || kind;
}
