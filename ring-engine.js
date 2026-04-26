// ring-engine.js
// ─────────────────────────────────────────────────────────────────────────────
// Converts a parsed ring spec (from ring-formula-parser.js) into a Lewis
// structure object compatible with the existing renderer and downstream
// engines (VSEPR, polarity, IMF, resonance).
//
// Input shape (from parseRingFormula):
//   {
//     ok, size, atomSymbols, ringBonds,
//     hCountsPerAtom, isAromatic, isSaturated,
//     displayName, notification, raw, normalizedFormula
//   }
//
// Output shape:
//   {
//     ok:                 true,
//     atoms:              [...],          // ring atoms + H atoms
//     bonds:              [...],          // ring bonds + C-H bonds
//     overallCharge:      0,
//     isIon:              false,
//     isRing:             true,           // signal for downstream
//     isAromatic:         Boolean,
//     isChain:            false,
//     nasb:               null,
//     hybridization:      { [atomIdx]: 'sp3'|'sp2'|'sp' },
//     centralAtomChoice:  { symbol, reason },
//     validationNotes:    [...],
//     octetMetOnAllAtoms: Boolean,
//     ringMeta: {
//       size, displayName, isAromatic, isSaturated,
//       ringAtomIndices: [Number, ...],   // indices of main-ring atoms in atoms[]
//       normalizedFormula, notification
//     }
//   }
// ─────────────────────────────────────────────────────────────────────────────

// Layout constants: polygon side length, H offset from ring atom.
const RING_BOND_LENGTH = 100;        // side length of the ring polygon
const RING_H_OFFSET    = 75;         // H distance from its ring atom (radial outward)
const RING_SUBSTITUENT_OFFSET = 95;  // Anchor atom distance (slightly farther than H)
const SUB_BOND_LENGTH  = 85;         // Bond length between substituent atoms

// R6d-2: Haworth-specific vertical offset for substituents and H's going
// straight up or down from the ring atoms.
const HAWORTH_VERTICAL_OFFSET = 60;

// Target valence per ring-atom symbol. C=4, N=3, O=2, S=2 (HS convention).
// Used by the valence-consistency check in buildRingStructure.
const RING_ATOM_VALENCE = { C: 4, N: 3, O: 2, S: 2 };

function buildRingStructure(ringSpec) {
  if (!ringSpec || !ringSpec.ok) {
    return { ok: false, error: 'Invalid ring spec input.' };
  }
  const { size, atomSymbols, ringBonds, hCountsPerAtom,
          isAromatic, isSaturated, displayName,
          normalizedFormula, notification,
          isHeterocycle, aromaticityNote,
          isSugar, sugarMeta } = ringSpec;

  // R6d-2: sugars can render in Haworth projection instead of the flat
  // polygon layout. The spec carries `view: 'haworth'` or `view: 'flat'`.
  // If not set, default to 'flat' for back-compat.
  const sugarView = isSugar ? (ringSpec.view || 'flat') : null;
  const isHaworth = sugarView === 'haworth';

  // Heteroatom symbols present in the ring (anything that isn't C).
  // Used downstream by polarity/IMF/breakdown engines.
  const heteroAtomSymbols = (atomSymbols || []).filter(s => s !== 'C');

  const atoms = [];
  const bonds = [];
  const validationNotes = [];
  const ringAtomIndices = [];

  // Per-atom lone pairs (defaults to 0 for C; heteroatoms N/O/S carry
  // their own lone pair counts, supplied via ringSpec.lonePairsPerAtom
  // when present — see R6c heterocycles).
  const lonePairsPerAtom = ringSpec.lonePairsPerAtom ||
    new Array(size).fill(0);

  // ── Ring atom placement ────────────────────────────────────────────────
  // Standard polygon (R5/R6a/R6b/R6c and flat sugar) OR hand-placed
  // Haworth projection (R6d-2 sugars).
  if (isHaworth) {
    // Haworth coordinate layout for glucose pyranose (6-member ring).
    // Engine convention: position 0 = ring O (back-right), then C1-C5
    // going clockwise (looking from above).
    //
    // These coordinates (in engine units where 100 = standard bond length)
    // sketch the classic tilted-hexagon Haworth:
    //   - Back edge (O to C5): higher on screen (smaller y)
    //   - Front edge (C2 to C3): lower (larger y)
    //   - Right side (O, C1, C2): x values positive
    //   - Left side (C3, C4, C5): x values negative
    //
    // Pre-computed for 6-member glucose ring.
    const HAWORTH_POSITIONS_6 = [
      { x:  110, y: -45 },   // 0 — ring O (back-right upper)
      { x:  160, y:  30 },   // 1 — C1 (anomeric, front-right)
      { x:  105, y:  90 },   // 2 — C2 (front-right-lower)
      { x:  -45, y:  90 },   // 3 — C3 (front-left-lower)
      { x: -100, y:  30 },   // 4 — C4 (front-left)
      { x:  -50, y: -45 }    // 5 — C5 (back-left upper)
    ];
    const positions = HAWORTH_POSITIONS_6;
    if (positions.length !== size) {
      return { ok: false, error: `Haworth layout not defined for ring size ${size}.` };
    }

    for (let i = 0; i < size; i++) {
      const atomIdx = atoms.length;
      atoms.push({
        symbol:       atomSymbols[i],
        x:            positions[i].x,
        y:            positions[i].y,
        lonePairs:    lonePairsPerAtom[i] || 0,
        formalCharge: 0,
        isCentral:    false,
        isRingAtom:   true,
        ringIndex:    i,
        index:        atomIdx
      });
      ringAtomIndices.push(atomIdx);
    }
  } else {
    // Standard polygon layout
    const R = RING_BOND_LENGTH / (2 * Math.sin(Math.PI / size));
    const angleStep = (2 * Math.PI) / size;
    const rotationOffset = size % 2 === 0 ? -Math.PI / 2 + angleStep / 2 : -Math.PI / 2;

    for (let i = 0; i < size; i++) {
      const theta = rotationOffset + i * angleStep;
      const x = R * Math.cos(theta);
      const y = R * Math.sin(theta);
      const atomIdx = atoms.length;
      atoms.push({
        symbol:       atomSymbols[i],
        x, y,
        lonePairs:    lonePairsPerAtom[i] || 0,
        formalCharge: 0,
        isCentral:    false,
        isRingAtom:   true,
        ringIndex:    i,
        index:        atomIdx,
        // Store the radial direction for H placement (used below for non-Haworth)
        _radialX:     Math.cos(theta),
        _radialY:     Math.sin(theta)
      });
      ringAtomIndices.push(atomIdx);
    }
  }

  // ── Emit ring bonds ────────────────────────────────────────────────────
  for (const b of ringBonds) {
    bonds.push({
      i: ringAtomIndices[b.i],
      j: ringAtomIndices[b.j],
      order: b.order
    });
  }

  // ── Validate per-atom valence ──────────────────────────────────────────
  // Valence depends on the atom's symbol. Carbon = 4, nitrogen = 3,
  // oxygen = 2, sulfur = 2 (Lewis conventions for HS chemistry).
  // Ring bonds (incident to this atom) + H count + substituent attachment
  // order must equal the atom's normal valence.
  const substituentsByPos = {};
  for (const sub of (ringSpec.substituents || [])) {
    substituentsByPos[sub.pos] = sub;
  }
  for (let i = 0; i < size; i++) {
    let ringBondSum = 0;
    for (const b of ringBonds) {
      if (b.i === i || b.j === i) ringBondSum += b.order;
    }
    const subAttachOrder = substituentsByPos[i] ? 1 : 0;
    const total = ringBondSum + hCountsPerAtom[i] + subAttachOrder;
    const sym = atomSymbols[i];
    const expected = RING_ATOM_VALENCE[sym] !== undefined ? RING_ATOM_VALENCE[sym] : 4;
    if (total !== expected) {
      return {
        ok: false,
        error: `Ring atom ${i} (${sym}) has valence ${total} ` +
               `(ring bonds ${ringBondSum} + H ${hCountsPerAtom[i]} + subs ${subAttachOrder}); expected ${expected}.`
      };
    }
  }

  // ── Compute hybridization ──────────────────────────────────────────────
  // sp² for atoms with any double bond (benzene, cycloalkene's vinyl carbons)
  // sp³ otherwise (cycloalkanes, single-bonded atoms in cycloalkenes)
  const hybridization = {};
  for (let i = 0; i < size; i++) {
    let maxOrder = 1;
    for (const b of ringBonds) {
      if ((b.i === i || b.j === i) && b.order > maxOrder) maxOrder = b.order;
    }
    hybridization[ringAtomIndices[i]] =
      maxOrder === 3 ? 'sp' :
      maxOrder === 2 ? 'sp2' :
      'sp3';
  }

  // ── Emit hydrogens on each ring atom ───────────────────────────────────
  if (isHaworth) {
    // Haworth: each ring C has 1 H placed directly opposite its substituent.
    // The substituent direction (up/down) is determined by stereochemistry;
    // the H goes on the opposite vertical side. Ring O has no H.
    // Stereochemistry for β-D-glucose Haworth (default):
    //   C1: OH up   → H down
    //   C2: OH down → H up
    //   C3: OH up   → H down
    //   C4: OH down → H up
    //   C5: CH2OH up → H down
    // α-D-glucose differs only at C1: OH down → H up.
    const stereo = _glucoseStereoMap(sugarMeta && sugarMeta.variant);
    for (let i = 0; i < size; i++) {
      const ringAtom = atoms[ringAtomIndices[i]];
      const nH = hCountsPerAtom[i];
      if (nH === 0) continue;
      // For Haworth, expect nH===1 for all C positions. If more, fall
      // back to a simple vertical column.
      const hDir = stereo[i] ? stereo[i].hDir : 0;  // -1 = up, +1 = down, 0 = none (skip)
      if (nH === 1 && hDir !== 0) {
        _addH(atoms, bonds, ringAtom.index,
              ringAtom.x,
              ringAtom.y + hDir * HAWORTH_VERTICAL_OFFSET);
      } else {
        // Unexpected case — place H directly below as fallback
        for (let k = 0; k < nH; k++) {
          _addH(atoms, bonds, ringAtom.index,
                ringAtom.x + (k - (nH - 1) / 2) * 25,
                ringAtom.y + HAWORTH_VERTICAL_OFFSET);
        }
      }
    }
  } else {
    // Standard polygon: H's are radially outward
    for (let i = 0; i < size; i++) {
      const ringAtom = atoms[ringAtomIndices[i]];
      const nH = hCountsPerAtom[i];
      if (nH === 0) continue;

      // Radial outward direction (from ring center to this atom).
      const rx = ringAtom._radialX;
      const ry = ringAtom._radialY;
      // Tangential direction (perpendicular to radial): used when there are 2 H's
      // on a single sp³ ring atom (cyclohexane-style).
      const tx = -ry;
      const ty =  rx;

      if (nH === 1) {
        _addH(atoms, bonds, ringAtom.index,
              ringAtom.x + rx * RING_H_OFFSET,
              ringAtom.y + ry * RING_H_OFFSET);
      } else if (nH === 2) {
        const splay = 0.45;
        _addH(atoms, bonds, ringAtom.index,
              ringAtom.x + (rx + tx * splay) * RING_H_OFFSET,
              ringAtom.y + (ry + ty * splay) * RING_H_OFFSET);
        _addH(atoms, bonds, ringAtom.index,
              ringAtom.x + (rx - tx * splay) * RING_H_OFFSET,
              ringAtom.y + (ry - ty * splay) * RING_H_OFFSET);
      } else {
        for (let k = 0; k < nH; k++) {
          const offsetAngle = (k - (nH - 1) / 2) * 0.4;
          const ax = rx * Math.cos(offsetAngle) - ry * Math.sin(offsetAngle);
          const ay = rx * Math.sin(offsetAngle) + ry * Math.cos(offsetAngle);
          _addH(atoms, bonds, ringAtom.index,
                ringAtom.x + ax * RING_H_OFFSET,
                ringAtom.y + ay * RING_H_OFFSET);
        }
      }
    }
  }

  // ── Emit substituents ──────────────────────────────────────────────────
  // Each substituent is a small molecular fragment attached to a ring atom.
  // Non-Haworth: fragment extends radially outward (R6a scope).
  // Haworth: fragment extends vertically UP or DOWN based on stereochemistry.
  const substituents = ringSpec.substituents || [];
  const substituentMetaList = [];
  for (const sub of substituents) {
    const ringAtomIdx = ringAtomIndices[sub.pos];
    const ringAtom = atoms[ringAtomIdx];

    let anchorX, anchorY, rx, ry;
    if (isHaworth) {
      // Haworth: substituent goes straight up (-y direction, stereo.subDir = -1)
      // or straight down (+y direction, stereo.subDir = +1).
      const stereo = _glucoseStereoMap(sugarMeta && sugarMeta.variant);
      const subDir = (stereo[sub.pos] && stereo[sub.pos].subDir) || 1;  // default down
      rx = 0;
      ry = subDir;   // +1 for down, -1 for up (positive y = down on canvas)
      anchorX = ringAtom.x;
      anchorY = ringAtom.y + subDir * HAWORTH_VERTICAL_OFFSET;
    } else {
      // Flat / non-sugar: substituent extends radially outward
      rx = ringAtom._radialX;
      ry = ringAtom._radialY;
      anchorX = ringAtom.x + rx * RING_SUBSTITUENT_OFFSET;
      anchorY = ringAtom.y + ry * RING_SUBSTITUENT_OFFSET;
    }

    const emitResult = _emitSubstituent(atoms, bonds, ringAtomIdx,
      sub.kind, anchorX, anchorY, rx, ry, validationNotes);
    if (!emitResult.ok) {
      return { ok: false, error: emitResult.error };
    }
    substituentMetaList.push({
      ringPos:     sub.pos,
      kind:        sub.kind,
      atomIndices: emitResult.atomIndices,
      label:       emitResult.label
    });
    // Propagate hybridization for substituent atoms
    for (const [aIdx, hyb] of Object.entries(emitResult.hybridization || {})) {
      hybridization[aIdx] = hyb;
    }
  }

  // Clean up the internal _radialX/_radialY fields (they served their purpose)
  for (const a of atoms) {
    delete a._radialX;
    delete a._radialY;
  }

  // ── Octet / duet validation ────────────────────────────────────────────
  let allMet = true;
  for (const a of atoms) {
    let bondElectrons = 0;
    for (const b of bonds) {
      if (b.i === a.index || b.j === a.index) bondElectrons += 2 * b.order;
    }
    const target = a.symbol === 'H' ? 2 : 8;
    if (bondElectrons + a.lonePairs * 2 !== target) {
      allMet = false;
      validationNotes.push(
        `${a.symbol} (atom #${a.index}) has ${bondElectrons + a.lonePairs * 2} e⁻, expected ${target}.`
      );
    }
  }
  if (allMet && validationNotes.length === 0) {
    validationNotes.push('All octets (C) and duets (H) satisfied.');
  }

  return {
    ok:                 true,
    atoms,
    bonds,
    overallCharge:      0,
    isIon:              false,
    isRing:             true,
    isAromatic:         !!isAromatic,
    isChain:            false,
    nasb:               null,
    hybridization,
    centralAtomChoice: {
      symbol: heteroAtomSymbols[0] || 'C',
      reason: isSugar
        ? `${displayName}: a 6-membered saturated ring (pyranose) with an oxygen at one position ` +
          `and hydroxyl groups on the carbons. Ring atoms shown as a flat hexagon; substituents ` +
          `point radially outward.`
        : isHeterocycle
        ? `Aromatic heterocycle (${displayName}): ${size}-membered ring containing ` +
          `${heteroAtomSymbols.join(', ')} alongside carbons, with delocalized π electrons. ` +
          `Shown in Kekulé form.`
        : isAromatic
        ? `Aromatic ring (${displayName}): ${size} carbons in a hexagon with delocalized π electrons. ` +
          `Shown in Kekulé form with alternating single/double bonds.`
        : `${displayName}: ${size}-carbon ${isSaturated ? 'saturated' : 'unsaturated'} ring. ` +
          `Ring atoms laid out as a regular polygon with hydrogens pointing outward.`
    },
    validationNotes,
    octetMetOnAllAtoms: allMet,
    ringMeta: {
      size, displayName, isAromatic, isSaturated,
      ringAtomIndices,
      normalizedFormula,
      notification,
      substituents: substituentMetaList,   // R6a — empty array for unsubstituted rings
      isHeterocycle: !!isHeterocycle,      // R6c
      heteroAtomSymbols,                    // R6c — e.g. ['N'] for pyridine
      aromaticityNote: aromaticityNote || null,  // R6c
      isSugar: !!isSugar,                   // R6d
      sugarMeta: sugarMeta || null,         // R6d — anomeric info, variant
      sugarView: sugarView || null          // R6d-2 — 'haworth' or 'flat'
    }
  };
}

// R6d-2: Glucose Haworth stereochemistry map.
// Maps ring position (0-5) → { subDir, hDir } where:
//   subDir: direction for the functional group substituent (-1 = up, +1 = down)
//   hDir:   direction for the ring H (opposite of subDir)
//
// β-D-glucose Haworth convention:
//   C1: -OH up   → subDir: -1, H down (+1)
//   C2: -OH down → subDir: +1, H up   (-1)
//   C3: -OH up   → subDir: -1, H down (+1)
//   C4: -OH down → subDir: +1, H up   (-1)
//   C5: -CH2OH up → subDir: -1, H down (+1)
// α-D-glucose differs ONLY at C1: -OH down, H up.
// Ring O (position 0) has no substituent; entry is included for index safety.
function _glucoseStereoMap(variant) {
  const isAlpha = variant === 'alpha';
  return {
    0: { subDir: 0, hDir: 0 },                             // O — no sub or H
    1: isAlpha
       ? { subDir: +1, hDir: -1 }                          // α-C1: -OH down, H up
       : { subDir: -1, hDir: +1 },                         // β-C1: -OH up, H down
    2: { subDir: +1, hDir: -1 },                           // C2: -OH down, H up
    3: { subDir: -1, hDir: +1 },                           // C3: -OH up, H down
    4: { subDir: +1, hDir: -1 },                           // C4: -OH down, H up
    5: { subDir: -1, hDir: +1 }                            // C5: -CH2OH up, H down
  };
}

// Helper: add a single hydrogen bonded to a given parent ring atom.
function _addH(atoms, bonds, parentAtomIdx, x, y) {
  const hIdx = atoms.length;
  atoms.push({
    symbol:       'H',
    x, y,
    lonePairs:    0,
    formalCharge: 0,
    isCentral:    false,
    isRingAtom:   false,
    index:        hIdx
  });
  bonds.push({ i: parentAtomIdx, j: hIdx, order: 1 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: generate the alternate Kekulé form of an aromatic ring by shifting
// double bond positions. Only produces an alternate for 6-member aromatics
// with alternating (3 doubles + 3 singles) patterns — benzene, pyridine.
//
// 5-member heteroaromatics (pyrrole, furan, thiophene) have only 2 doubles
// + 3 singles; flipping would produce a structurally invalid pattern, so
// no alternate is generated.
//
// Returns null for non-aromatic input or for rings that don't have the
// clean alternating pattern.
// ─────────────────────────────────────────────────────────────────────────────
function buildAlternateKekuleStructure(structure) {
  if (!structure || !structure.isAromatic || !structure.isRing) return null;
  if (!structure.ringMeta) return null;

  // Only 6-member aromatics with exactly 3 double bonds in the ring have
  // a valid alternate Kekulé form. 5-member heteroaromatics don't.
  const ringAtomSet = new Set(structure.ringMeta.ringAtomIndices);
  const ringBondCount = structure.bonds.filter(b =>
    ringAtomSet.has(b.i) && ringAtomSet.has(b.j)).length;
  const ringDoubleCount = structure.bonds.filter(b =>
    ringAtomSet.has(b.i) && ringAtomSet.has(b.j) && b.order === 2).length;

  if (ringBondCount !== 6 || ringDoubleCount !== 3) return null;

  // Deep clone the structure, then flip each ring bond's order between
  // single and double.
  const atoms = structure.atoms.map(a => ({ ...a }));
  const bonds = structure.bonds.map(b => ({ ...b }));

  for (const b of bonds) {
    if (ringAtomSet.has(b.i) && ringAtomSet.has(b.j)) {
      b.order = b.order === 2 ? 1 : (b.order === 1 ? 2 : b.order);
    }
  }

  return {
    ...structure,
    atoms,
    bonds
  };
}

// Expose
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildRingStructure, buildAlternateKekuleStructure };
}

// ─────────────────────────────────────────────────────────────────────────────
// Emit a substituent fragment attached to a ring atom. Creates atoms+bonds
// for the substituent's internal structure extending radially outward.
//
// Parameters:
//   atoms, bonds         — structure arrays to append to
//   ringAtomIdx          — index of the ring atom this substituent attaches to
//   kind                 — substituent type: 'hydroxyl', 'methyl', 'amine', etc.
//   anchorX, anchorY     — coordinates of the substituent's first atom
//   rx, ry               — radial unit vector (pointing outward from ring)
//   validationNotes      — array to append notes to
//
// Returns:
//   { ok: true, atomIndices: [...], label: String, hybridization: {...} }
//   { ok: false, error: String }
// ─────────────────────────────────────────────────────────────────────────────
function _emitSubstituent(atoms, bonds, ringAtomIdx, kind, anchorX, anchorY, rx, ry, validationNotes) {
  // Tangential unit vector (perpendicular to radial)
  const tx = -ry;
  const ty =  rx;

  switch (kind) {
    case 'hydroxyl':
      return _emitHydroxyl(atoms, bonds, ringAtomIdx, anchorX, anchorY, rx, ry, tx, ty);
    case 'methyl':
      return _emitMethyl(atoms, bonds, ringAtomIdx, anchorX, anchorY, rx, ry, tx, ty);
    case 'amine':
      return _emitAmine(atoms, bonds, ringAtomIdx, anchorX, anchorY, rx, ry, tx, ty);
    case 'carboxyl':
      return _emitCarboxyl(atoms, bonds, ringAtomIdx, anchorX, anchorY, rx, ry, tx, ty);
    case 'aldehyde':
      return _emitAldehyde(atoms, bonds, ringAtomIdx, anchorX, anchorY, rx, ry, tx, ty);
    case 'chloro':
      return _emitHalogen(atoms, bonds, ringAtomIdx, 'Cl', anchorX, anchorY);
    case 'bromo':
      return _emitHalogen(atoms, bonds, ringAtomIdx, 'Br', anchorX, anchorY);
    case 'fluoro':
      return _emitHalogen(atoms, bonds, ringAtomIdx, 'F', anchorX, anchorY);
    case 'iodo':
      return _emitHalogen(atoms, bonds, ringAtomIdx, 'I', anchorX, anchorY);
    case 'nitro':
      return _emitNitro(atoms, bonds, ringAtomIdx, anchorX, anchorY, rx, ry, tx, ty);
    case 'hydroxymethyl':
      return _emitHydroxymethyl(atoms, bonds, ringAtomIdx, anchorX, anchorY, rx, ry, tx, ty);
    default:
      return { ok: false, error: `Unknown substituent kind: ${kind}` };
  }
}

// -OH: O (2 LP, single bond to ring) + H (attached to O).
// Non-Haworth: H is splayed to the side away from the ring (tangent direction).
// Haworth (detected by rx≈0, vertical substituent direction): H goes directly
// to the side of the O — clean textbook look, no awkward splay.
function _emitHydroxyl(atoms, bonds, ringAtomIdx, ax, ay, rx, ry, tx, ty) {
  const oIdx = atoms.length;
  atoms.push({
    symbol: 'O', x: ax, y: ay,
    lonePairs: 2, formalCharge: 0,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: oIdx
  });
  bonds.push({ i: ringAtomIdx, j: oIdx, order: 1 });

  const isHaworthStyle = Math.abs(rx) < 0.01;
  let hx, hy;
  if (isHaworthStyle) {
    // Haworth: place H horizontally to the right of O (readable, compact).
    hx = ax + SUB_BOND_LENGTH * 0.75;
    hy = ay;
  } else {
    // Radial: splay H to the side (tangent direction) and further outward
    hx = ax + (rx * 0.6 + tx * 0.7) * SUB_BOND_LENGTH;
    hy = ay + (ry * 0.6 + ty * 0.7) * SUB_BOND_LENGTH;
  }

  const hIdx = atoms.length;
  atoms.push({
    symbol: 'H',
    x: hx, y: hy,
    lonePairs: 0, formalCharge: 0,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: hIdx
  });
  bonds.push({ i: oIdx, j: hIdx, order: 1 });

  return {
    ok: true,
    atomIndices: [oIdx, hIdx],
    label: '-OH',
    hybridization: { [oIdx]: 'sp3' }
  };
}

// -CH3: C (sp3) + 3 H's
function _emitMethyl(atoms, bonds, ringAtomIdx, ax, ay, rx, ry, tx, ty) {
  const cIdx = atoms.length;
  atoms.push({
    symbol: 'C', x: ax, y: ay,
    lonePairs: 0, formalCharge: 0,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: cIdx
  });
  bonds.push({ i: ringAtomIdx, j: cIdx, order: 1 });

  // 3 H's arranged around the C (tetrahedral projection)
  // One H pointing "straight up" radially, two splayed to either side
  const splay = 0.8;
  const deepen = 0.5;
  const hPositions = [
    { x: ax + rx * SUB_BOND_LENGTH,                           y: ay + ry * SUB_BOND_LENGTH },
    { x: ax + (rx * deepen + tx * splay) * SUB_BOND_LENGTH,   y: ay + (ry * deepen + ty * splay) * SUB_BOND_LENGTH },
    { x: ax + (rx * deepen - tx * splay) * SUB_BOND_LENGTH,   y: ay + (ry * deepen - ty * splay) * SUB_BOND_LENGTH }
  ];
  const hIndices = [];
  for (const p of hPositions) {
    const hIdx = atoms.length;
    atoms.push({
      symbol: 'H', x: p.x, y: p.y,
      lonePairs: 0, formalCharge: 0,
      isCentral: false, isRingAtom: false, isSubstituentAtom: true,
      index: hIdx
    });
    bonds.push({ i: cIdx, j: hIdx, order: 1 });
    hIndices.push(hIdx);
  }

  return {
    ok: true,
    atomIndices: [cIdx, ...hIndices],
    label: '-CH3',
    hybridization: { [cIdx]: 'sp3' }
  };
}

// -NH2: N (1 LP) + 2 H's splayed
function _emitAmine(atoms, bonds, ringAtomIdx, ax, ay, rx, ry, tx, ty) {
  const nIdx = atoms.length;
  atoms.push({
    symbol: 'N', x: ax, y: ay,
    lonePairs: 1, formalCharge: 0,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: nIdx
  });
  bonds.push({ i: ringAtomIdx, j: nIdx, order: 1 });

  const splay = 0.7, deepen = 0.5;
  const hPositions = [
    { x: ax + (rx * deepen + tx * splay) * SUB_BOND_LENGTH, y: ay + (ry * deepen + ty * splay) * SUB_BOND_LENGTH },
    { x: ax + (rx * deepen - tx * splay) * SUB_BOND_LENGTH, y: ay + (ry * deepen - ty * splay) * SUB_BOND_LENGTH }
  ];
  const hIndices = [];
  for (const p of hPositions) {
    const hIdx = atoms.length;
    atoms.push({
      symbol: 'H', x: p.x, y: p.y,
      lonePairs: 0, formalCharge: 0,
      isCentral: false, isRingAtom: false, isSubstituentAtom: true,
      index: hIdx
    });
    bonds.push({ i: nIdx, j: hIdx, order: 1 });
    hIndices.push(hIdx);
  }

  return {
    ok: true,
    atomIndices: [nIdx, ...hIndices],
    label: '-NH2',
    hybridization: { [nIdx]: 'sp3' }
  };
}

// -COOH: C (sp2) with =O (double-bonded, 2 LP) on one side, -OH (single-bonded) on the other
function _emitCarboxyl(atoms, bonds, ringAtomIdx, ax, ay, rx, ry, tx, ty) {
  const cIdx = atoms.length;
  atoms.push({
    symbol: 'C', x: ax, y: ay,
    lonePairs: 0, formalCharge: 0,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: cIdx
  });
  bonds.push({ i: ringAtomIdx, j: cIdx, order: 1 });

  // =O to one side (tangent + outward)
  const oDoubleIdx = atoms.length;
  atoms.push({
    symbol: 'O',
    x: ax + (rx * 0.4 + tx * 0.9) * SUB_BOND_LENGTH,
    y: ay + (ry * 0.4 + ty * 0.9) * SUB_BOND_LENGTH,
    lonePairs: 2, formalCharge: 0,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: oDoubleIdx
  });
  bonds.push({ i: cIdx, j: oDoubleIdx, order: 2 });

  // -O (single bond) on the other side, then H attached to it
  const oSingleIdx = atoms.length;
  atoms.push({
    symbol: 'O',
    x: ax + (rx * 0.4 - tx * 0.9) * SUB_BOND_LENGTH,
    y: ay + (ry * 0.4 - ty * 0.9) * SUB_BOND_LENGTH,
    lonePairs: 2, formalCharge: 0,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: oSingleIdx
  });
  bonds.push({ i: cIdx, j: oSingleIdx, order: 1 });

  // H on the single-bonded O, extended radially outward
  const hIdx = atoms.length;
  const oxSingle = atoms[oSingleIdx];
  atoms.push({
    symbol: 'H',
    x: oxSingle.x + rx * SUB_BOND_LENGTH * 0.8,
    y: oxSingle.y + ry * SUB_BOND_LENGTH * 0.8,
    lonePairs: 0, formalCharge: 0,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: hIdx
  });
  bonds.push({ i: oSingleIdx, j: hIdx, order: 1 });

  return {
    ok: true,
    atomIndices: [cIdx, oDoubleIdx, oSingleIdx, hIdx],
    label: '-COOH',
    hybridization: { [cIdx]: 'sp2', [oSingleIdx]: 'sp3', [oDoubleIdx]: 'sp2' }
  };
}

// -CHO: C (sp2) with =O (double-bonded, 2 LP) and 1 H
function _emitAldehyde(atoms, bonds, ringAtomIdx, ax, ay, rx, ry, tx, ty) {
  const cIdx = atoms.length;
  atoms.push({
    symbol: 'C', x: ax, y: ay,
    lonePairs: 0, formalCharge: 0,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: cIdx
  });
  bonds.push({ i: ringAtomIdx, j: cIdx, order: 1 });

  // =O to one side (tangent + outward)
  const oIdx = atoms.length;
  atoms.push({
    symbol: 'O',
    x: ax + (rx * 0.4 + tx * 0.9) * SUB_BOND_LENGTH,
    y: ay + (ry * 0.4 + ty * 0.9) * SUB_BOND_LENGTH,
    lonePairs: 2, formalCharge: 0,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: oIdx
  });
  bonds.push({ i: cIdx, j: oIdx, order: 2 });

  // H on the other side
  const hIdx = atoms.length;
  atoms.push({
    symbol: 'H',
    x: ax + (rx * 0.4 - tx * 0.9) * SUB_BOND_LENGTH,
    y: ay + (ry * 0.4 - ty * 0.9) * SUB_BOND_LENGTH,
    lonePairs: 0, formalCharge: 0,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: hIdx
  });
  bonds.push({ i: cIdx, j: hIdx, order: 1 });

  return {
    ok: true,
    atomIndices: [cIdx, oIdx, hIdx],
    label: '-CHO',
    hybridization: { [cIdx]: 'sp2', [oIdx]: 'sp2' }
  };
}

// Halogen (-Cl, -Br, -F, -I): single atom with 3 LP
function _emitHalogen(atoms, bonds, ringAtomIdx, sym, ax, ay) {
  const xIdx = atoms.length;
  atoms.push({
    symbol: sym, x: ax, y: ay,
    lonePairs: 3, formalCharge: 0,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: xIdx
  });
  bonds.push({ i: ringAtomIdx, j: xIdx, order: 1 });

  return {
    ok: true,
    atomIndices: [xIdx],
    label: `-${sym}`,
    hybridization: {}   // halogens don't need hybridization tracking for VSEPR
  };
}

// -NO2: N (FC +1) with =O (one O double-bonded, FC 0, 2 LP) and -O (other O
// single-bonded, FC -1, 3 LP). N has no lone pairs (used both pairs in bonds).
function _emitNitro(atoms, bonds, ringAtomIdx, ax, ay, rx, ry, tx, ty) {
  const nIdx = atoms.length;
  atoms.push({
    symbol: 'N', x: ax, y: ay,
    lonePairs: 0, formalCharge: 1,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: nIdx
  });
  bonds.push({ i: ringAtomIdx, j: nIdx, order: 1 });

  // =O (double-bonded)
  const oDoubleIdx = atoms.length;
  atoms.push({
    symbol: 'O',
    x: ax + (rx * 0.5 + tx * 0.85) * SUB_BOND_LENGTH,
    y: ay + (ry * 0.5 + ty * 0.85) * SUB_BOND_LENGTH,
    lonePairs: 2, formalCharge: 0,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: oDoubleIdx
  });
  bonds.push({ i: nIdx, j: oDoubleIdx, order: 2 });

  // -O (single-bonded, FC -1)
  const oSingleIdx = atoms.length;
  atoms.push({
    symbol: 'O',
    x: ax + (rx * 0.5 - tx * 0.85) * SUB_BOND_LENGTH,
    y: ay + (ry * 0.5 - ty * 0.85) * SUB_BOND_LENGTH,
    lonePairs: 3, formalCharge: -1,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: oSingleIdx
  });
  bonds.push({ i: nIdx, j: oSingleIdx, order: 1 });

  return {
    ok: true,
    atomIndices: [nIdx, oDoubleIdx, oSingleIdx],
    label: '-NO2',
    hybridization: { [nIdx]: 'sp2', [oDoubleIdx]: 'sp2', [oSingleIdx]: 'sp3' }
  };
}

// -CH2OH (hydroxymethyl, R6d): the C5 primary alcohol in sugars.
// Structure: a sp3 C bonded to the ring, with 2 H's and 1 -OH group.
// Non-Haworth: C extends radially outward, OH further outward, H's splayed.
// Haworth (rx≈0): clean vertical stack — C above/below C5, O above/below C,
// OH's H to the side. Two H's on the CH2 splay left/right horizontally.
function _emitHydroxymethyl(atoms, bonds, ringAtomIdx, ax, ay, rx, ry, tx, ty) {
  const isHaworthStyle = Math.abs(rx) < 0.01;

  // The sp3 carbon
  const cIdx = atoms.length;
  atoms.push({
    symbol: 'C', x: ax, y: ay,
    lonePairs: 0, formalCharge: 0,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: cIdx
  });
  bonds.push({ i: ringAtomIdx, j: cIdx, order: 1 });

  // The -OH oxygen, extending further from the C
  const oIdx = atoms.length;
  const oDist = SUB_BOND_LENGTH;
  const oX = ax + rx * oDist;
  const oY = ay + ry * oDist;
  atoms.push({
    symbol: 'O',
    x: oX, y: oY,
    lonePairs: 2, formalCharge: 0,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: oIdx
  });
  bonds.push({ i: cIdx, j: oIdx, order: 1 });

  // The -OH hydrogen
  let hOHx, hOHy;
  if (isHaworthStyle) {
    // Haworth: H of OH goes horizontally to the right of the O
    hOHx = oX + SUB_BOND_LENGTH * 0.75;
    hOHy = oY;
  } else {
    // Radial: extend further outward with slight tangent offset
    hOHx = ax + rx * (oDist + SUB_BOND_LENGTH * 0.6) + tx * SUB_BOND_LENGTH * 0.5;
    hOHy = ay + ry * (oDist + SUB_BOND_LENGTH * 0.6) + ty * SUB_BOND_LENGTH * 0.5;
  }
  const hOHIdx = atoms.length;
  atoms.push({
    symbol: 'H',
    x: hOHx, y: hOHy,
    lonePairs: 0, formalCharge: 0,
    isCentral: false, isRingAtom: false, isSubstituentAtom: true,
    index: hOHIdx
  });
  bonds.push({ i: oIdx, j: hOHIdx, order: 1 });

  // Two H's on the C. For Haworth, splay horizontally (left/right).
  // For radial case, use the original tangent splay.
  const splay = isHaworthStyle ? 0.65 : 0.85;
  const hPositions = [
    { x: ax + tx * splay * SUB_BOND_LENGTH,  y: ay + ty * splay * SUB_BOND_LENGTH  },
    { x: ax - tx * splay * SUB_BOND_LENGTH,  y: ay - ty * splay * SUB_BOND_LENGTH  }
  ];
  const hIndices = [];
  for (const p of hPositions) {
    const hIdx = atoms.length;
    atoms.push({
      symbol: 'H', x: p.x, y: p.y,
      lonePairs: 0, formalCharge: 0,
      isCentral: false, isRingAtom: false, isSubstituentAtom: true,
      index: hIdx
    });
    bonds.push({ i: cIdx, j: hIdx, order: 1 });
    hIndices.push(hIdx);
  }

  return {
    ok: true,
    atomIndices: [cIdx, oIdx, hOHIdx, ...hIndices],
    label: '-CH2OH',
    hybridization: { [cIdx]: 'sp3', [oIdx]: 'sp3' }
  };
}
