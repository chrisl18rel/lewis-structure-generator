// vsepr-engine.js
// ─────────────────────────────────────────────────────────────────────────────
// Classifies molecular geometry from a covalent Lewis structure using the
// full VSEPR table from Chris's teaching notes.
//
// Input:  structure from lewis-engine.js  (best-resonance form preferred)
// Output: {
//   ok:           Boolean,
//   applicable:   Boolean,           // false for diatomics/ionic/single atom
//   axeNotation:  String,            // e.g. 'AX₃E'
//   shape:        String,            // e.g. 'Trigonal Pyramid'
//   bondAngle:    String,            // e.g. '109.5°'
//   totalDomains: Number,
//   bondedAtoms:  Number,            // # atoms bonded to central (NOT bond order)
//   lonePairs:    Number,
//   centralSym:   String,
//   reasoning:    [String],          // step-by-step walk
//   error:        String (on failure)
// }
//
// Core rules (per your notes, image 5):
//   1) Start with the Lewis structure
//   2) Count atoms bonded to central (not bond order — double/triple = 1 domain)
//   3) Count lone pairs on central
//   4) Consult the VSEPR table
//   5) Return shape + bond angle + AXE notation
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// VSEPR TABLE (images 8-9 from class notes) — all 17 rows.
// Keyed by `${bonded}-${lone}` for O(1) lookup.
// ─────────────────────────────────────────────────────────────────────────────
const VSEPR_TABLE = {
  // total = 1
  '1-0':  { axe: 'AX',     shape: 'Linear',               angle: '180°',     total: 1 },
  // total = 2
  '2-0':  { axe: 'AX₂',    shape: 'Linear',               angle: '180°',     total: 2 },
  '1-1':  { axe: 'AXE',    shape: 'Linear',               angle: '180°',     total: 2 },
  // total = 3
  '3-0':  { axe: 'AX₃',    shape: 'Trigonal Planar',      angle: '120°',     total: 3 },
  '2-1':  { axe: 'AX₂E',   shape: 'Bent',                 angle: '120°',     total: 3 },
  '1-2':  { axe: 'AXE₂',   shape: 'Linear',               angle: '180°',     total: 3 },
  // total = 4
  '4-0':  { axe: 'AX₄',    shape: 'Tetrahedral',          angle: '109.5°',   total: 4 },
  '3-1':  { axe: 'AX₃E',   shape: 'Trigonal Pyramid',     angle: '109.5°',   total: 4 },
  '2-2':  { axe: 'AX₂E₂',  shape: 'Bent',                 angle: '109.5°',   total: 4 },
  '1-3':  { axe: 'AXE₃',   shape: 'Linear',               angle: '109.5°',   total: 4 },
  // total = 5
  '5-0':  { axe: 'AX₅',    shape: 'Trigonal Bipyramidal', angle: '90°/120°', total: 5 },
  '4-1':  { axe: 'AX₄E',   shape: 'See Saw',              angle: '90°/120°', total: 5 },
  '3-2':  { axe: 'AX₃E₂',  shape: 'T-Shape',              angle: '90°/120°', total: 5 },
  '2-3':  { axe: 'AX₂E₃',  shape: 'Linear',               angle: '90°/120°', total: 5 },
  // total = 6
  '6-0':  { axe: 'AX₆',    shape: 'Octahedral',           angle: '90°',      total: 6 },
  '5-1':  { axe: 'AX₅E',   shape: 'Square Pyramidal',     angle: '90°',      total: 6 },
  '4-2':  { axe: 'AX₄E₂',  shape: 'Square Planar',        angle: '90°',      total: 6 }
};

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point.
// ─────────────────────────────────────────────────────────────────────────────
function classifyVSEPR(structure) {
  if (!structure || !structure.ok) {
    return { ok:false, applicable:false, error:'No valid structure supplied.' };
  }

  // ── Chain path: per-carbon geometry ─────────────────────────────────
  // For carbon chains, there is no single central atom. Instead, each
  // carbon has its own geometry based on its hybridization (sp³ = tetrahedral,
  // sp² = trigonal planar, sp = linear). Return a `perAtom` array; the
  // summary shape is the hybridization mix, e.g. "sp³–sp²–sp²".
  if (structure.isChain) {
    return classifyVSEPRChain(structure);
  }

  // ── Ring path: per-ring-atom geometry ───────────────────────────────
  // Rings also have no single central atom. Each ring atom gets its own
  // geometry based on hybridization. sp³ for cycloalkanes, sp² for
  // aromatic (benzene) and cycloalkene double-bond carbons.
  if (structure.isRing) {
    return classifyVSEPRRing(structure);
  }

  // ── Special case: single atom (no geometry) ─────────────────────────
  if (structure.atoms.length === 1) {
    return {
      ok: true, applicable: false,
      shape: '—', axeNotation: '—', bondAngle: '—',
      totalDomains: 0, bondedAtoms: 0, lonePairs: 0,
      centralSym: structure.atoms[0].symbol,
      reasoning: ['A single atom has no molecular geometry.']
    };
  }

  // ── Special case: diatomic molecule (always linear) ─────────────────
  // Per notes: any 2-atom molecule is linear regardless of bond order or
  // lone-pair count. There is no "central atom" to count domains on.
  if (structure.atoms.length === 2) {
    return {
      ok: true, applicable: true,
      shape: 'Linear', axeNotation: 'AX', bondAngle: '180°',
      totalDomains: 1, bondedAtoms: 1, lonePairs: 0,
      centralSym: structure.atoms[0].symbol,
      reasoning: [
        'This is a diatomic molecule. All diatomics are linear by definition — ' +
        'there is no central atom to count domains on.',
        'Shape: Linear.  Bond angle: 180°.'
      ]
    };
  }

  // ── Find central atom ───────────────────────────────────────────────
  const centralAtom = structure.atoms.find(a => a.isCentral);
  if (!centralAtom) {
    return { ok:false, applicable:false,
      error:'No central atom flagged on the structure.' };
  }

  // ── Count bonded atoms (one domain per atom — NOT per bond order) ────
  // This is the critical distinction: a C=O double bond still = 1 domain.
  const bondedIndices = new Set();
  for (const b of structure.bonds) {
    if (b.i === centralAtom.index) bondedIndices.add(b.j);
    else if (b.j === centralAtom.index) bondedIndices.add(b.i);
  }
  const bondedAtoms = bondedIndices.size;
  const lonePairs   = centralAtom.lonePairs;
  const totalDomains = bondedAtoms + lonePairs;

  // ── Look up the shape ───────────────────────────────────────────────
  const key   = `${bondedAtoms}-${lonePairs}`;
  const entry = VSEPR_TABLE[key];
  if (!entry) {
    return { ok:false, applicable:false,
      error:`VSEPR lookup failed — no row for ${bondedAtoms} bonded atoms + ${lonePairs} lone pair(s). ` +
            `Total domains = ${totalDomains}.` };
  }

  // ── Build step-by-step reasoning ────────────────────────────────────
  const reasoning = [];
  reasoning.push(`Start with the Lewis structure (shown above).`);
  reasoning.push(
    `The central atom is ${centralAtom.symbol}. ` +
    `It is bonded to ${bondedAtoms} atom${bondedAtoms===1?'':'s'}:` +
    ' ' + describeBondedNeighbors(structure, centralAtom)
  );

  // Bond-order domain-counting caveat (only relevant if any multi-bonds exist)
  const hasMultiBond = structure.bonds.some(
    b => (b.i === centralAtom.index || b.j === centralAtom.index) && b.order > 1
  );
  if (hasMultiBond) {
    reasoning.push(
      'Any atom bonded to the center counts as ONE electron domain, ' +
      'even if the bond is a double or triple bond. Bond order does not change the domain count.'
    );
  }

  reasoning.push(
    `${centralAtom.symbol} has ${lonePairs} lone pair${lonePairs===1?'':'s'}.`
  );
  reasoning.push(
    `Total electron domains = ${bondedAtoms} bonded atom${bondedAtoms===1?'':'s'} + ` +
    `${lonePairs} lone pair${lonePairs===1?'':'s'} = ${totalDomains}.`
  );
  reasoning.push(
    `VSEPR table → AXE notation: ${entry.axe}. ` +
    `Shape: ${entry.shape}.  Bond angle: ${entry.angle}.`
  );

  return {
    ok: true,
    applicable: true,
    axeNotation: entry.axe,
    shape:       entry.shape,
    bondAngle:   entry.angle,
    totalDomains,
    bondedAtoms,
    lonePairs,
    centralSym:  centralAtom.symbol,
    reasoning
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: describe the atoms bonded to the central atom for the reasoning text.
//   e.g. "3 H atoms" for NH3,  "2 O atoms" for CO2,  "1 H and 1 N atom" for HCN
// ─────────────────────────────────────────────────────────────────────────────
function describeBondedNeighbors(structure, centralAtom) {
  const counts = {};
  for (const b of structure.bonds) {
    let otherIdx = null;
    if (b.i === centralAtom.index) otherIdx = b.j;
    else if (b.j === centralAtom.index) otherIdx = b.i;
    if (otherIdx === null) continue;
    const sym = structure.atoms[otherIdx].symbol;
    counts[sym] = (counts[sym] || 0) + 1;
  }
  const parts = Object.keys(counts).map(sym => {
    const n = counts[sym];
    return `${n} ${sym} atom${n===1?'':'s'}`;
  });
  if (parts.length === 0) return '(none)';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
}

// ─────────────────────────────────────────────────────────────────────────────
// Static helper: check whether a given shape is symmetrically distributed
// (used by the polarity engine in Phase 10). Listed here because it belongs
// with the VSEPR table.
// Per your notes (image 13):
//   Symmetrical:     Trigonal Planar, Tetrahedral, Linear (triatomic+),
//                    Trigonal Bipyramidal, Octahedral
//   Non-symmetrical: Bent, Trigonal Pyramid, See Saw, T-Shape, Square Pyramidal
// Square Planar is symmetrical.
// ─────────────────────────────────────────────────────────────────────────────
const SYMMETRIC_SHAPES = new Set([
  'Trigonal Planar',
  'Tetrahedral',
  'Linear',
  'Trigonal Bipyramidal',
  'Octahedral',
  'Square Planar'
]);
function isShapeSymmetric(shapeName) {
  return SYMMETRIC_SHAPES.has(shapeName);
}

// ─────────────────────────────────────────────────────────────────────────────
// VSEPR for carbon chains: report per-carbon geometry.
//
// Each carbon is classified by its own domain count:
//   - sp³ carbon (4 single bonds or 3 single + 0 LP) → Tetrahedral, 109.5°
//   - sp² carbon (1 double bond + 2 others)         → Trigonal Planar, 120°
//   - sp  carbon (1 triple bond + 1 other OR
//                2 double bonds)                     → Linear, 180°
//
// Output shape:
//   {
//     ok: true, applicable: true,
//     isChain: true,
//     perCarbon: [
//       { carbonIdx, bondedAtoms, lonePairs, hybridization, axeNotation,
//         shape, bondAngle, reasoning:[...] }, ...
//     ],
//     summaryHybridization: 'sp³–sp²–sp²–sp³',        // joined with em-dash
//     centralSym: 'C',
//     shape: 'Chain',                                   // placeholder for UI
//     axeNotation: 'chain',
//     bondAngle: 'per carbon',
//     reasoning: [...]                                   // overall reasoning
//   }
// ─────────────────────────────────────────────────────────────────────────────
function classifyVSEPRChain(structure) {
  const perCarbon = [];
  const hybridLabel = {
    sp:  'sp',
    sp2: 'sp²',
    sp3: 'sp³'
  };
  const overallReasoning = [
    `Carbon chains do not have a single central atom. ` +
    `VSEPR is applied per-carbon based on each carbon's hybridization.`
  ];

  for (const a of structure.atoms) {
    if (!a.isChainCarbon) continue;
    // Skip branch/R-group carbons — they don't have a main-chain index and
    // shouldn't appear in the per-carbon summary (only main-chain carbons
    // are tracked in structure.hybridization, which is chainIndex-keyed).
    if (a.chainIndex === null || a.chainIndex === undefined) continue;

    // Count bonded atoms (not bond order) and lone pairs for THIS carbon
    const bondedIndices = new Set();
    for (const b of structure.bonds) {
      if (b.i === a.index) bondedIndices.add(b.j);
      else if (b.j === a.index) bondedIndices.add(b.i);
    }
    const bondedAtoms = bondedIndices.size;
    const lonePairs   = a.lonePairs;
    const key = `${bondedAtoms}-${lonePairs}`;
    const entry = VSEPR_TABLE[key];
    const hyb = structure.hybridization
      ? structure.hybridization[a.chainIndex]
      : (bondedAtoms === 4 ? 'sp3' : bondedAtoms === 3 ? 'sp2' : 'sp');

    // Figure out what's bonded to this carbon (for reasoning line)
    const bondedSymbols = [...bondedIndices].map(idx => structure.atoms[idx].symbol);
    const hCount = bondedSymbols.filter(s => s === 'H').length;
    const cCount = bondedSymbols.filter(s => s === 'C').length;
    const oCount = bondedSymbols.filter(s => s === 'O').length;
    const nCount = bondedSymbols.filter(s => s === 'N').length;
    const otherCount = bondedSymbols.length - hCount - cCount - oCount - nCount;
    const neighborParts = [];
    if (cCount) neighborParts.push(`${cCount} C`);
    if (hCount) neighborParts.push(`${hCount} H`);
    if (oCount) neighborParts.push(`${oCount} O`);
    if (nCount) neighborParts.push(`${nCount} N`);
    if (otherCount) neighborParts.push(`${otherCount} other`);
    const neighbors = neighborParts.join(' + ');

    // Use the atom's own symbol (C, O, N, etc.) rather than hardcoded "Carbon".
    // In chain context we label the position by chainIndex either way.
    const atomSym = a.symbol || 'C';
    const atomLabel = atomSym === 'C' ? 'Carbon' : atomSym === 'O' ? 'Oxygen' : atomSym === 'N' ? 'Nitrogen' : atomSym;

    const reasoning = [
      `${atomLabel} #${a.chainIndex}: bonded to ${bondedAtoms} atom${bondedAtoms===1?'':'s'} (${neighbors}), ` +
      `with ${lonePairs} lone pair${lonePairs===1?'':'s'}.`,
      `Hybridization: ${hybridLabel[hyb]}. ` +
      `Shape: ${entry ? entry.shape : 'unknown'}. Bond angle: ${entry ? entry.angle : '—'}.`
    ];

    perCarbon.push({
      carbonIdx:    a.chainIndex,
      atomSymbol:   atomSym,
      bondedAtoms,
      lonePairs,
      hybridization: hyb,
      hybridLabel:   hybridLabel[hyb],
      axeNotation:   entry ? entry.axe : 'AX?',
      shape:         entry ? entry.shape : 'unknown',
      bondAngle:     entry ? entry.angle : '—',
      reasoning
    });

    overallReasoning.push(
      `${atomSym}${a.chainIndex}: ${hybridLabel[hyb]}, ${entry ? entry.shape : 'unknown'}, ${entry ? entry.angle : '—'}.`
    );
  }

  const summaryHybridization = perCarbon
    .map(p => hybridLabel[p.hybridization])
    .join('–');

  return {
    ok:          true,
    applicable:  true,
    isChain:     true,
    perCarbon,
    summaryHybridization,
    centralSym:  'C',
    shape:       `Chain (${summaryHybridization})`,
    axeNotation: 'chain',
    bondAngle:   'per carbon',
    totalDomains: null,
    bondedAtoms:  null,
    lonePairs:    null,
    reasoning:    overallReasoning
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// VSEPR for cyclic molecules: report per-ring-atom geometry.
//
// Each ring atom is classified by its own domain count:
//   - sp³ ring atom (all single bonds + H's)              → Tetrahedral, 109.5°
//   - sp² ring atom (one double bond in the ring or C=X)  → Trigonal Planar, 120°
//
// Output shape:
//   {
//     ok: true, applicable: true, isRing: true,
//     perAtom: [
//       { ringIdx, atomSymbol, bondedAtoms, lonePairs,
//         hybridization, axeNotation, shape, bondAngle, reasoning:[...] }, ...
//     ],
//     summaryHybridization: 'sp²–sp²–sp²–sp²–sp²–sp²',     // joined with em-dash
//     shape:                'Ring (benzene)',
//     reasoning:            [...]
//   }
// ─────────────────────────────────────────────────────────────────────────────
function classifyVSEPRRing(structure) {
  const perAtom = [];
  const hybridLabel = { sp: 'sp', sp2: 'sp²', sp3: 'sp³' };

  const overallReasoning = [
    `Rings do not have a single central atom. ` +
    `VSEPR is applied per ring atom based on each atom's hybridization.`
  ];

  // Walk only the ring atoms (not H atoms).
  for (const a of structure.atoms) {
    if (!a.isRingAtom) continue;

    const bondedIndices = new Set();
    for (const b of structure.bonds) {
      if (b.i === a.index) bondedIndices.add(b.j);
      else if (b.j === a.index) bondedIndices.add(b.i);
    }
    const bondedAtoms = bondedIndices.size;
    const lonePairs   = a.lonePairs;
    const key = `${bondedAtoms}-${lonePairs}`;
    const entry = VSEPR_TABLE[key];
    const hyb = structure.hybridization[a.index];

    const bondedSymbols = [...bondedIndices].map(idx => structure.atoms[idx].symbol);
    const hCount = bondedSymbols.filter(s => s === 'H').length;
    const cCount = bondedSymbols.filter(s => s === 'C').length;
    const neighborParts = [];
    if (cCount) neighborParts.push(`${cCount} C`);
    if (hCount) neighborParts.push(`${hCount} H`);
    const neighbors = neighborParts.join(' + ');

    const atomSym = a.symbol || 'C';
    const atomLabel = atomSym === 'C' ? 'Carbon' : atomSym;

    const reasoning = [
      `${atomLabel} #${a.ringIndex}: bonded to ${bondedAtoms} atom${bondedAtoms===1?'':'s'} (${neighbors}), ` +
      `with ${lonePairs} lone pair${lonePairs===1?'':'s'}.`,
      `Hybridization: ${hybridLabel[hyb]}. ` +
      `Shape: ${entry ? entry.shape : 'unknown'}. Bond angle: ${entry ? entry.angle : '—'}.`
    ];

    perAtom.push({
      ringIdx:       a.ringIndex,
      atomSymbol:    atomSym,
      bondedAtoms,
      lonePairs,
      hybridization: hyb,
      hybridLabel:   hybridLabel[hyb],
      axeNotation:   entry ? entry.axe : 'AX?',
      shape:         entry ? entry.shape : 'unknown',
      bondAngle:     entry ? entry.angle : '—',
      reasoning
    });

    overallReasoning.push(
      `${atomSym}${a.ringIndex}: ${hybridLabel[hyb]}, ${entry ? entry.shape : 'unknown'}, ${entry ? entry.angle : '—'}.`
    );
  }

  const summaryHybridization = perAtom
    .map(p => hybridLabel[p.hybridization])
    .join('–');

  const ringName = (structure.ringMeta && structure.ringMeta.displayName) || 'ring';

  return {
    ok:          true,
    applicable:  true,
    isRing:      true,
    perAtom,
    // Also populate perCarbon for code paths that expect it (chain breakdown renderer).
    perCarbon:   perAtom.map(p => ({
      carbonIdx:     p.ringIdx,
      atomSymbol:    p.atomSymbol,
      bondedAtoms:   p.bondedAtoms,
      lonePairs:     p.lonePairs,
      hybridization: p.hybridization,
      hybridLabel:   p.hybridLabel,
      axeNotation:   p.axeNotation,
      shape:         p.shape,
      bondAngle:     p.bondAngle,
      reasoning:     p.reasoning
    })),
    summaryHybridization,
    centralSym:   'C',
    shape:        `Ring (${ringName})`,
    axeNotation:  'ring',
    bondAngle:    'per atom',
    totalDomains: null,
    bondedAtoms:  null,
    lonePairs:    null,
    reasoning:    overallReasoning
  };
}
