// ring-formula-parser.js
// ─────────────────────────────────────────────────────────────────────────────
// Parses user input for the Rings tab.
//
// Accepts two formats:
//   1. Stoichiometric: "C6H6" (benzene), "C6H12" (cyclohexane), "C5H10"
//      (cyclopentane), "C3H6" (cyclopropane — NOT propene here), etc.
//   2. Named compounds (case-insensitive): "benzene", "cyclohexane",
//      "cyclopentene", etc.
//
// Returns a ring spec:
//   {
//     ok:            true,
//     size:          Number (3–6),               // ring atom count
//     atomSymbols:   [String, ...],              // ring atom symbols ('C' typically)
//     ringBonds:     [{ i, j, order }, ...],     // closed-loop bond list (N bonds for N atoms)
//     hCountsPerAtom: [Number, ...],             // H atoms attached to each ring atom
//     isAromatic:    Boolean,                    // true for benzene
//     displayName:   String,                     // 'cyclohexane', 'benzene', etc.
//     isSaturated:   Boolean,                    // true for cycloalkanes
//     notification:  String | null,              // user-facing note on how we interpreted the input
//     raw:           String,                     // original input
//     normalizedFormula: String                  // 'C6H12' etc.
//   }
//
// On failure:
//   { ok: false, error: String }
// ─────────────────────────────────────────────────────────────────────────────

// Named compound → molecular formula lookup (case-insensitive).
// R5: unsubstituted rings.
// R6a: added monosubstituted aromatics. These resolve to a ring+substituent
// pair rather than a stoichiometric formula (since C6H5X is ambiguous
// stoichiometrically).
const RING_NAMED_COMPOUNDS = {
  // R5 — unsubstituted rings
  'cyclopropane': 'C3H6',
  'cyclobutane':  'C4H8',
  'cyclopentane': 'C5H10',
  'cyclohexane':  'C6H12',
  'cyclopentene': 'C5H8',
  'cyclohexene':  'C6H10',
  'benzene':      'C6H6'
};

// R6a — named monosubstituted aromatics. Each entry resolves to a
// substituted benzene with a single substituent at ring position 0.
// The substituent kind maps to a template (defined below).
// Key is the normalized (lowercase, whitespace-stripped) name.
const RING_NAMED_SUBSTITUTED = {
  'phenol':        { base: 'benzene', substituents: [{ pos: 0, kind: 'hydroxyl' }]  },
  'toluene':       { base: 'benzene', substituents: [{ pos: 0, kind: 'methyl'   }]  },
  'methylbenzene': { base: 'benzene', substituents: [{ pos: 0, kind: 'methyl'   }]  },
  'aniline':       { base: 'benzene', substituents: [{ pos: 0, kind: 'amine'    }]  },
  'aminobenzene':  { base: 'benzene', substituents: [{ pos: 0, kind: 'amine'    }]  },
  'benzoicacid':   { base: 'benzene', substituents: [{ pos: 0, kind: 'carboxyl' }]  },
  'benzaldehyde':  { base: 'benzene', substituents: [{ pos: 0, kind: 'aldehyde' }]  },
  'chlorobenzene': { base: 'benzene', substituents: [{ pos: 0, kind: 'chloro'   }]  },
  'bromobenzene':  { base: 'benzene', substituents: [{ pos: 0, kind: 'bromo'    }]  },
  'fluorobenzene': { base: 'benzene', substituents: [{ pos: 0, kind: 'fluoro'   }]  },
  'iodobenzene':   { base: 'benzene', substituents: [{ pos: 0, kind: 'iodo'     }]  },
  'nitrobenzene':  { base: 'benzene', substituents: [{ pos: 0, kind: 'nitro'    }]  }
};

// R6b — named disubstituted aromatics. Each entry resolves to benzene with
// two substituents at specific ring positions. Positions use engine indexing
// (0-indexed) — position 0 = top-right vertex, position 1 = right vertex,
// etc. Positional relationships:
//   0,1 = 1,2 = ortho (adjacent)
//   0,2 = 1,3 = meta  (1 apart)
//   0,3 = 1,4 = para  (opposite)
// See _stripPositionalPrefix() for the dynamic prefix-stripping parser that
// handles forms like "o-dichlorobenzene", "1,4-dibromobenzene", "p-xylene".
const RING_NAMED_DISUBSTITUTED = {
  // Xylenes (dimethylbenzene)
  'oxylene':             { positions: [0, 1], kinds: ['methyl',   'methyl'],   display: 'o-xylene' },
  'orthoxylene':         { positions: [0, 1], kinds: ['methyl',   'methyl'],   display: 'o-xylene' },
  'mxylene':             { positions: [0, 2], kinds: ['methyl',   'methyl'],   display: 'm-xylene' },
  'metaxylene':          { positions: [0, 2], kinds: ['methyl',   'methyl'],   display: 'm-xylene' },
  'pxylene':             { positions: [0, 3], kinds: ['methyl',   'methyl'],   display: 'p-xylene' },
  'paraxylene':          { positions: [0, 3], kinds: ['methyl',   'methyl'],   display: 'p-xylene' },
  '12dimethylbenzene':   { positions: [0, 1], kinds: ['methyl',   'methyl'],   display: '1,2-dimethylbenzene' },
  '13dimethylbenzene':   { positions: [0, 2], kinds: ['methyl',   'methyl'],   display: '1,3-dimethylbenzene' },
  '14dimethylbenzene':   { positions: [0, 3], kinds: ['methyl',   'methyl'],   display: '1,4-dimethylbenzene' },
  // Cresols (methyl-phenol): CH3 at position 1, OH at 2/3/4
  'ocresol':             { positions: [0, 1], kinds: ['hydroxyl', 'methyl'],   display: 'o-cresol' },
  'orthocresol':         { positions: [0, 1], kinds: ['hydroxyl', 'methyl'],   display: 'o-cresol' },
  'mcresol':             { positions: [0, 2], kinds: ['hydroxyl', 'methyl'],   display: 'm-cresol' },
  'metacresol':          { positions: [0, 2], kinds: ['hydroxyl', 'methyl'],   display: 'm-cresol' },
  'pcresol':             { positions: [0, 3], kinds: ['hydroxyl', 'methyl'],   display: 'p-cresol' },
  'paracresol':          { positions: [0, 3], kinds: ['hydroxyl', 'methyl'],   display: 'p-cresol' }
};

// R6b — dynamic prefix parsing. Base names describe what comes after the
// positional prefix (e.g., "dichlorobenzene", "dibromobenzene"). Each
// entry tells the parser what substituent kind(s) the base contains.
const RING_DISUBSTITUTED_BASES = {
  // "di<X>benzene" forms — two identical substituents
  'dichlorobenzene':   { kinds: ['chloro',   'chloro']   },
  'dibromobenzene':    { kinds: ['bromo',    'bromo']    },
  'difluorobenzene':   { kinds: ['fluoro',   'fluoro']   },
  'diiodobenzene':     { kinds: ['iodo',     'iodo']     },
  'dimethylbenzene':   { kinds: ['methyl',   'methyl']   },
  'dinitrobenzene':    { kinds: ['nitro',    'nitro']    },
  // Additional generic bases — less common but structurally reasonable
  'dihydroxybenzene':  { kinds: ['hydroxyl', 'hydroxyl'] },
  'diaminobenzene':    { kinds: ['amine',    'amine']    }
};

// R6c — heterocycles. Each entry is a complete ring template: atom
// symbols at each ring position, ring bond pattern, and per-atom H
// counts and lone pair counts. The builder (_buildHeterocycleSpec) uses
// this directly rather than deriving from stoichiometry, because the
// heteroatom positions and electron bookkeeping are specific to each
// compound.
//
// Conventions:
//   - size: number of ring atoms
//   - atomSymbols: ring atoms in polygon order, position 0 = top vertex
//   - ringBondOrders: bond order between ring atoms i and (i+1 mod N)
//   - hCountsPerAtom: H atoms bonded to each ring atom
//   - lonePairsPerAtom: lone pairs shown on each ring atom
//   - isAromatic: affects resonance generation and description
const RING_HETEROCYCLES = {
  // Pyridine — 6-member, N at position 0, alternating double/single
  //   Benzene-like; N has 1 in-plane lone pair that does NOT participate
  //   in aromaticity. Atom positions: N, C, C, C, C, C.
  'pyridine': {
    size:              6,
    atomSymbols:       ['N', 'C', 'C', 'C', 'C', 'C'],
    ringBondOrders:    [2, 1, 2, 1, 2, 1],    // N=C, C-C, C=C, C-C, C=C, C-N
    hCountsPerAtom:    [0, 1, 1, 1, 1, 1],    // N has no H (uses valence on ring + LP)
    lonePairsPerAtom:  [1, 0, 0, 0, 0, 0],    // N has 1 in-plane LP
    isAromatic:        true,
    displayName:       'pyridine',
    normalizedFormula: 'C5H5N',
    aromaticityNote:
      'The nitrogen contributes NO electrons to the π system — its lone pair ' +
      'lies in the plane of the ring. The six π electrons all come from the ' +
      'three C=C/C=N double bonds, same as benzene.'
  },

  // Pyrrole — 5-member, N at position 0, N-H
  //   N contributes its lone pair to the π system (6 π electrons total).
  //   Atom positions: N, C, C, C, C. Ring bonds: N-C (single), C=C, C-C,
  //   C=C, C-N (single). So 2 doubles + 3 singles.
  //   For octet bookkeeping: N has 2 ring bonds (4 e⁻) + 1 H (2 e⁻) +
  //   1 lone pair (2 e⁻) = 8 e⁻. The "aromatic π donation" is a
  //   conceptual description of where the lone pair's electrons go; for
  //   Lewis-structure purposes we still show 1 LP on the N.
  'pyrrole': {
    size:              5,
    atomSymbols:       ['N', 'C', 'C', 'C', 'C'],
    ringBondOrders:    [1, 2, 1, 2, 1],       // N-C, C=C, C-C, C=C, C-N
    hCountsPerAtom:    [1, 1, 1, 1, 1],       // N has 1 H, each C has 1 H
    lonePairsPerAtom:  [1, 0, 0, 0, 0],       // N LP (shown; conceptually in π)
    isAromatic:        true,
    displayName:       'pyrrole',
    normalizedFormula: 'C4H5N',
    aromaticityNote:
      'The nitrogen DONATES its lone pair to the π system. Together with ' +
      'the two C=C double bonds (4 electrons), this gives 6 π electrons — ' +
      'satisfying Hückel\'s rule for aromaticity. (The lone pair is still ' +
      'drawn on N in the Lewis structure — the "donation" describes where ' +
      'those electrons conceptually live in the molecular orbitals.)'
  },

  // Furan — 5-member, O at position 0
  //   O contributes 1 lone pair to the π system, keeping the other in plane.
  //   Ring bonds: O-C (single), C=C, C-C, C=C, C-O (single). 2 doubles.
  //   For octet: O has 2 ring bonds (4 e⁻) + 0 H + 2 LP (4 e⁻) = 8 ✓.
  'furan': {
    size:              5,
    atomSymbols:       ['O', 'C', 'C', 'C', 'C'],
    ringBondOrders:    [1, 2, 1, 2, 1],
    hCountsPerAtom:    [0, 1, 1, 1, 1],       // O has no H
    lonePairsPerAtom:  [2, 0, 0, 0, 0],       // O has 2 LP (1 "in π", 1 in plane)
    isAromatic:        true,
    displayName:       'furan',
    normalizedFormula: 'C4H4O',
    aromaticityNote:
      'The oxygen DONATES one of its two lone pairs to the π system. ' +
      'Combined with the two C=C double bonds (4 electrons), the ring has ' +
      '6 π electrons — aromatic by Hückel\'s rule. (Both lone pairs are ' +
      'still drawn on O in the Lewis structure — one conceptually goes ' +
      'into the π system, the other stays in the plane of the ring.)'
  },

  // Thiophene — 5-member, S at position 0
  //   Same electronic logic as furan. S-C bond is essentially nonpolar
  //   (ΔEN ≈ 0.03), so the whole molecule is effectively nonpolar.
  //   For octet: S has 2 ring bonds (4 e⁻) + 0 H + 2 LP (4 e⁻) = 8 ✓.
  'thiophene': {
    size:              5,
    atomSymbols:       ['S', 'C', 'C', 'C', 'C'],
    ringBondOrders:    [1, 2, 1, 2, 1],
    hCountsPerAtom:    [0, 1, 1, 1, 1],       // S has no H
    lonePairsPerAtom:  [2, 0, 0, 0, 0],       // S has 2 LP
    isAromatic:        true,
    displayName:       'thiophene',
    normalizedFormula: 'C4H4S',
    aromaticityNote:
      'The sulfur DONATES one of its two lone pairs to the π system, ' +
      'same as furan\'s oxygen. The ring has 6 π electrons — aromatic by ' +
      'Hückel\'s rule. (Both lone pairs are drawn on S in the Lewis ' +
      'structure — one conceptually goes into the π system, the other ' +
      'stays in the plane of the ring.)'
  },

  // R6d — D-glucose (pyranose form), flat Lewis view.
  //   Ring positions (0-indexed, engine convention):
  //     0 = ring O (top vertex of hexagon)
  //     1 = C1 (anomeric carbon — carries OH whose stereochemistry
  //             distinguishes α from β)
  //     2 = C2
  //     3 = C3
  //     4 = C4
  //     5 = C5 (carries the -CH2OH group that defines D configuration)
  //
  //   All ring bonds are single (saturated 6-membered oxygen-containing
  //   ring — a pyranose). Ring O has 2 lone pairs and no H. Each ring C
  //   has exactly 1 H; its remaining valence is taken by the substituent.
  //   Four of the C's carry -OH (C1, C2, C3, C4) and C5 carries -CH2OH.
  //
  //   In the flat Lewis view, α-glucose and β-glucose have IDENTICAL
  //   structure — they differ only in the 3D orientation of the C1 -OH.
  //   This is flagged in the breakdown; Haworth projection (R6d-2) will
  //   show the stereochemistry.
  'glucose': {
    size:              6,
    atomSymbols:       ['O', 'C', 'C', 'C', 'C', 'C'],
    ringBondOrders:    [1, 1, 1, 1, 1, 1],
    // Pre-substitution H counts: ring O has 0 H, each ring C has 2 H's
    // (like cyclohexane's tetrahedral carbons). Substituents will replace
    // 1 H on C1–C5, leaving each C with 1 H plus its substituent — the
    // correct final state for glucose.
    hCountsPerAtom:    [0, 2, 2, 2, 2, 2],
    lonePairsPerAtom:  [2, 0, 0, 0, 0, 0],   // O: 2 LP
    isAromatic:        false,
    isSaturated:       true,
    isSugar:           true,
    displayName:       'D-glucose',          // overridden per-variant below
    normalizedFormula: 'C6H12O6',
    aromaticityNote:   null,
    sugarMeta: {
      anomericPosition: 1,   // C1 is the anomeric carbon
      variant:          'glucose'
    }
  }
};

// Map stoichiometric formulas to heterocycle names (case-insensitive key).
// Used to route "C5H5N" to pyridine, "C4H4O" to furan, etc.
const HETEROCYCLE_STOICH_MAP = {
  'C5H5N': 'pyridine',
  'C4H5N': 'pyrrole',
  'C4H4NH': 'pyrrole',
  'C4H4O': 'furan',
  'C4H4S': 'thiophene'
};

// R6d — sugar name aliases and their canonical {template, variant, display}.
// Each variant produces glucose's ring template with the appropriate
// display name and anomeric-config notation. All aliases here normalize
// via _normalizeName (lowercased, whitespace/hyphens/commas stripped).
const SUGAR_NAMES = {
  // α-glucose aliases
  'alphaglucose':      { template: 'glucose', variant: 'alpha', display: 'α-D-glucose' },
  'αglucose':          { template: 'glucose', variant: 'alpha', display: 'α-D-glucose' },
  'aglucose':          { template: 'glucose', variant: 'alpha', display: 'α-D-glucose' },
  'alphadglucose':     { template: 'glucose', variant: 'alpha', display: 'α-D-glucose' },
  'αdglucose':         { template: 'glucose', variant: 'alpha', display: 'α-D-glucose' },
  // β-glucose aliases
  'betaglucose':       { template: 'glucose', variant: 'beta',  display: 'β-D-glucose' },
  'βglucose':          { template: 'glucose', variant: 'beta',  display: 'β-D-glucose' },
  'bglucose':          { template: 'glucose', variant: 'beta',  display: 'β-D-glucose' },
  'betadglucose':      { template: 'glucose', variant: 'beta',  display: 'β-D-glucose' },
  'βdglucose':         { template: 'glucose', variant: 'beta',  display: 'β-D-glucose' },
  // Plain "glucose" defaults to α (per R6d decision)
  'glucose':           { template: 'glucose', variant: 'alpha', display: 'α-D-glucose', wasAmbiguous: true },
  'dglucose':          { template: 'glucose', variant: 'alpha', display: 'α-D-glucose', wasAmbiguous: true }
};

// Substituent list for glucose (flat view). Same for both α and β since
// flat view doesn't depict stereochemistry. Position 0 is ring O.
//   Position 1 (C1 anomeric) — -OH
//   Position 2 (C2)          — -OH
//   Position 3 (C3)          — -OH
//   Position 4 (C4)          — -OH
//   Position 5 (C5)          — -CH2OH (this is the "C6" of the sugar)
const GLUCOSE_SUBSTITUENTS = [
  { pos: 1, kind: 'hydroxyl' },      // C1 -OH (anomeric)
  { pos: 2, kind: 'hydroxyl' },      // C2 -OH
  { pos: 3, kind: 'hydroxyl' },      // C3 -OH
  { pos: 4, kind: 'hydroxyl' },      // C4 -OH
  { pos: 5, kind: 'hydroxymethyl' }  // C5 -CH2OH (the "C6" primary alcohol)
];

// For display — map kind to a user-friendly substituent label
const SUBSTITUENT_LABELS = {
  'hydroxyl':      '-OH',
  'methyl':        '-CH₃',
  'amine':         '-NH₂',
  'carboxyl':      '-COOH',
  'aldehyde':      '-CHO',
  'chloro':        '-Cl',
  'bromo':         '-Br',
  'fluoro':        '-F',
  'iodo':          '-I',
  'nitro':         '-NO₂',
  'hydroxymethyl': '-CH₂OH'
};

// The list of named aliases, exported for UI hint-text generation.
const RING_NAMED_COMPOUND_LIST = [
  ...Object.keys(RING_NAMED_COMPOUNDS),
  // R6a
  'phenol', 'toluene', 'aniline', 'benzoic acid', 'benzaldehyde',
  'chlorobenzene', 'bromobenzene', 'fluorobenzene', 'iodobenzene',
  'nitrobenzene',
  // R6b — common named disubstituted
  'o-xylene', 'm-xylene', 'p-xylene',
  'o-cresol', 'm-cresol', 'p-cresol',
  'o-dichlorobenzene', 'm-dichlorobenzene', 'p-dichlorobenzene',
  'o-dibromobenzene', 'p-dibromobenzene',
  'o-dinitrobenzene', 'm-dinitrobenzene', 'p-dinitrobenzene',
  // R6c — heterocycles
  'pyridine', 'pyrrole', 'furan', 'thiophene',
  // R6d — sugars
  'glucose', 'alpha-glucose', 'beta-glucose', 'α-glucose', 'β-glucose'
];

// Parse a stoichiometric formula like "C6H12" into { nC, nH }.
// Returns null if not a pure CₙHₘ formula.
function _parseSimpleStoich(raw) {
  const s = raw.replace(/\s+/g, '');
  const m = s.match(/^C(\d*)H(\d*)$/);
  if (!m) return null;
  const nC = m[1] === '' ? 1 : parseInt(m[1], 10);
  const nH = m[2] === '' ? 1 : parseInt(m[2], 10);
  return { nC, nH };
}

// Map a stoichiometric CₙHₘ to a ring type. Returns a ring spec or null.
// Supported in R5:
//   C3H6 → cyclopropane
//   C4H8 → cyclobutane
//   C5H10 → cyclopentane
//   C6H12 → cyclohexane
//   C5H8 → cyclopentene (1 double bond)
//   C6H10 → cyclohexene (1 double bond)
//   C6H6 → benzene (aromatic, 3 double bonds)
function _classifyStoichiometry(nC, nH) {
  // Benzene is special
  if (nC === 6 && nH === 6) {
    return {
      ok: true, size: 6, displayName: 'benzene',
      isAromatic: true, isSaturated: false,
      doubleBondPositions: [0, 2, 4]   // alternating: 0-1, 2-3, 4-5 (Kekulé form A)
    };
  }
  // Cycloalkanes: CₙH₂ₙ
  if (nH === 2 * nC && nC >= 3 && nC <= 6) {
    return {
      ok: true, size: nC, displayName: `cyclo${_alkylRoot(nC)}ane`,
      isAromatic: false, isSaturated: true,
      doubleBondPositions: []
    };
  }
  // Cycloalkenes: CₙH₂ₙ₋₂
  if (nH === 2 * nC - 2 && nC >= 5 && nC <= 6) {
    return {
      ok: true, size: nC, displayName: `cyclo${_alkylRoot(nC)}ene`,
      isAromatic: false, isSaturated: false,
      doubleBondPositions: [0]         // double bond between atoms 0 and 1
    };
  }
  return null;
}

function _alkylRoot(n) {
  return ['', '', '', 'prop', 'but', 'pent', 'hex'][n] || '';
}

// Case-insensitive normalize for name lookup. Strips whitespace, hyphens,
// and commas so "o-xylene" == "oxylene" == "O Xylene", and
// "1,2-dichlorobenzene" == "12dichlorobenzene". This lets the
// RING_NAMED_DISUBSTITUTED and other lookup tables use compact keys.
function _normalizeName(s) {
  return s.replace(/[\s\-,]+/g, '').toLowerCase();
}

// Normalize user input to see if it matches one of the heterocycle
// stoichiometric keys (C5H5N, C4H4O, etc.). Strips whitespace/hyphens
// while preserving case-sensitivity of element symbols.
function _heterocycleStoichKey(raw) {
  const cleaned = raw.replace(/[\s\-]+/g, '');
  // Normalize: only exact stoichiometric forms like "C5H5N" are valid keys.
  return cleaned;
}



// Build the ring spec from a classification result. Optional substituents
// is an array of { pos: Number, kind: String } — each substituent replaces
// one H at the given ring position.
function _buildRingSpec(classification, raw, nH, notification, substituents) {
  const size = classification.size;
  const atomSymbols = [];
  const ringBonds = [];
  const hCountsPerAtom = [];

  // Emit N ring atoms (all C for R6a scope — heterocycles come in R6c)
  for (let i = 0; i < size; i++) {
    atomSymbols.push('C');
  }

  // Emit N ring bonds. Bond k connects atom k to atom (k+1) mod size.
  // Bond order defaults to 1; gets upgraded to 2 if this position is in
  // doubleBondPositions. Benzene has 3 double bonds at positions 0, 2, 4.
  for (let i = 0; i < size; i++) {
    const j = (i + 1) % size;
    const isDouble = classification.doubleBondPositions.includes(i);
    ringBonds.push({ i, j, order: isDouble ? 2 : 1 });
  }

  // Compute H count per ring atom. Each C has valence 4. Bonds to
  // neighbors (from ringBonds) consume valence; remaining is the H count.
  for (let i = 0; i < size; i++) {
    let ringBondOrderSum = 0;
    for (const b of ringBonds) {
      if (b.i === i || b.j === i) ringBondOrderSum += b.order;
    }
    hCountsPerAtom.push(4 - ringBondOrderSum);
  }

  // Apply substituents — each one replaces 1 H at its ring position.
  const subList = (substituents || []).slice();
  for (const sub of subList) {
    if (sub.pos < 0 || sub.pos >= size) {
      return { ok: false, error: `Substituent position ${sub.pos} is out of range for a ${size}-member ring.` };
    }
    if (hCountsPerAtom[sub.pos] < 1) {
      return {
        ok: false,
        error: `Ring position ${sub.pos} has no H to replace (already fully substituted or double-bonded).`
      };
    }
    hCountsPerAtom[sub.pos] -= 1;
  }

  // Compute display name — substituted name lookup handles most cases;
  // here we just keep the base ring's display name as fallback.
  const displayName = classification.displayName;

  // Build a normalized molecular formula including substituents
  const normalizedFormula = _computeSubstitutedFormula(size, hCountsPerAtom, subList);

  return {
    ok:            true,
    size,
    atomSymbols,
    ringBonds,
    hCountsPerAtom,
    substituents:  subList,      // NEW — R6a
    isAromatic:    classification.isAromatic,
    isSaturated:   classification.isSaturated,
    displayName,
    notification,
    raw,
    normalizedFormula
  };
}

// Build a ring spec for a heterocycle (R6c) or a saturated sugar ring (R6d).
// Unlike _buildRingSpec which assumes an all-C ring plus optional
// substituents, heterocycles/sugars have their ring atoms, bond orders,
// H counts, and lone pair counts specified explicitly in the template.
//
// Optional `substituents` array (R6d) lets the caller attach substituents
// to specific ring positions — used by glucose for its -OH and -CH2OH
// groups. Each substituent replaces 1 H at its ring position.
function _buildHeterocycleSpec(key, raw, notification, substituents) {
  const tpl = RING_HETEROCYCLES[key];
  if (!tpl) return { ok: false, error: `Unknown heterocycle "${key}".` };

  // Convert bond-order list to the ring-bond object list
  const ringBonds = [];
  for (let i = 0; i < tpl.size; i++) {
    const j = (i + 1) % tpl.size;
    ringBonds.push({ i, j, order: tpl.ringBondOrders[i] });
  }

  // Start with the template's H counts; each substituent replaces 1 H
  const hCountsPerAtom = tpl.hCountsPerAtom.slice();
  const subList = (substituents || []).slice();
  for (const sub of subList) {
    if (sub.pos < 0 || sub.pos >= tpl.size) {
      return { ok: false, error: `Substituent position ${sub.pos} is out of range for a ${tpl.size}-member ring.` };
    }
    if (hCountsPerAtom[sub.pos] < 1) {
      return {
        ok: false,
        error: `Ring position ${sub.pos} has no H to replace for substituent ${sub.kind}.`
      };
    }
    hCountsPerAtom[sub.pos] -= 1;
  }

  // Compute molecular formula when substituents change the atom counts
  // (sugars use this; bare heterocycles just use the template formula).
  const normalizedFormula = subList.length > 0
    ? _computeSubstitutedHeterocycleFormula(tpl, hCountsPerAtom, subList)
    : tpl.normalizedFormula;

  return {
    ok:            true,
    size:          tpl.size,
    atomSymbols:   tpl.atomSymbols.slice(),
    ringBonds,
    hCountsPerAtom,
    lonePairsPerAtom: tpl.lonePairsPerAtom.slice(),
    substituents:  subList,
    isAromatic:    tpl.isAromatic,
    isSaturated:   !!tpl.isSaturated,
    displayName:   tpl.displayName,
    aromaticityNote: tpl.aromaticityNote,
    isHeterocycle: true,
    isSugar:       !!tpl.isSugar,     // R6d
    sugarMeta:     tpl.sugarMeta || null,  // R6d — anomeric info, variant name
    notification,
    raw,
    normalizedFormula
  };
}

// Build a sugar spec (R6d). Uses the glucose heterocycle template plus
// the glucose-specific substituent list (4 -OH on C1-C4, -CH2OH on C5).
// R6d-2: `view` controls the display layout — 'haworth' (default, shows
// stereochemistry via vertical substituents) or 'flat' (standard ring
// geometry, flat Lewis view). Both α and β glucose produce identical flat
// views; Haworth shows the anomeric difference at C1.
function _buildSugarSpec(nameKey, raw, view) {
  const entry = SUGAR_NAMES[nameKey];
  if (!entry) return { ok: false, error: `Unknown sugar "${raw}".` };
  const resolvedView = view || 'haworth';

  const templateKey = entry.template;   // currently always 'glucose'
  const tpl = RING_HETEROCYCLES[templateKey];
  if (!tpl) return { ok: false, error: `Internal: sugar template "${templateKey}" missing.` };

  // Build notification — call out the α/β disambiguation for plain "glucose"
  let notification;
  if (entry.wasAmbiguous) {
    notification = `Interpreted "${raw}" as ${entry.display} (C6H12O6). ` +
      `Use "alpha-glucose" or "beta-glucose" to be explicit.`;
  } else if (resolvedView === 'flat') {
    notification = `Interpreted "${raw}" as ${entry.display} (C6H12O6). ` +
      `The flat Lewis view below doesn't show the α/β stereochemistry at C1 — ` +
      `toggle to Haworth to see it.`;
  } else {
    notification = `Interpreted "${raw}" as ${entry.display} (C6H12O6), ` +
      `shown in Haworth projection below. Toggle to flat Lewis view for a ` +
      `conventional 2D structure.`;
  }

  const spec = _buildHeterocycleSpec(templateKey, raw, notification, GLUCOSE_SUBSTITUENTS);
  if (!spec.ok) return spec;

  // Override display name and sugarMeta with the variant-specific info
  spec.displayName = entry.display;
  spec.view = resolvedView;                 // R6d-2: carried to engine
  spec.sugarMeta = {
    ...(tpl.sugarMeta || {}),
    variant:          entry.variant,          // 'alpha' or 'beta'
    displayName:      entry.display,
    anomericPosition: (tpl.sugarMeta && tpl.sugarMeta.anomericPosition) || 1
  };
  return spec;
}

// Aggregate molecular formula for a substituted heterocycle (e.g., glucose).
// Like _computeSubstitutedFormula but starts from the heterocycle's
// specific ring atom composition instead of assuming all-C.
function _computeSubstitutedHeterocycleFormula(tpl, hCountsPerAtom, substituents) {
  let nC = 0, nN = 0, nO = 0, nS = 0;
  for (const sym of tpl.atomSymbols) {
    if (sym === 'C') nC++;
    else if (sym === 'N') nN++;
    else if (sym === 'O') nO++;
    else if (sym === 'S') nS++;
  }
  let nH = hCountsPerAtom.reduce((s, n) => s + n, 0);
  let nCl = 0, nBr = 0, nF = 0, nI = 0;

  for (const sub of substituents) {
    const stpl = SUBSTITUENT_TEMPLATES[sub.kind];
    if (!stpl) continue;
    nC  += stpl.atomCounts.C  || 0;
    nH  += stpl.atomCounts.H  || 0;
    nO  += stpl.atomCounts.O  || 0;
    nN  += stpl.atomCounts.N  || 0;
    nCl += stpl.atomCounts.Cl || 0;
    nBr += stpl.atomCounts.Br || 0;
    nF  += stpl.atomCounts.F  || 0;
    nI  += stpl.atomCounts.I  || 0;
  }

  const parts = [];
  if (nC)  parts.push(nC  > 1 ? `C${nC}`   : 'C');
  if (nH)  parts.push(nH  > 1 ? `H${nH}`   : 'H');
  if (nN)  parts.push(nN  > 1 ? `N${nN}`   : 'N');
  if (nO)  parts.push(nO  > 1 ? `O${nO}`   : 'O');
  if (nS)  parts.push(nS  > 1 ? `S${nS}`   : 'S');
  if (nCl) parts.push(nCl > 1 ? `Cl${nCl}` : 'Cl');
  if (nBr) parts.push(nBr > 1 ? `Br${nBr}` : 'Br');
  if (nF)  parts.push(nF  > 1 ? `F${nF}`   : 'F');
  if (nI)  parts.push(nI  > 1 ? `I${nI}`   : 'I');
  return parts.join('');
}

// Compute total molecular formula for a substituted ring. Aggregates atom
// counts from ring atoms, ring H's, and each substituent's atom contribution.
function _computeSubstitutedFormula(size, hCountsPerAtom, substituents) {
  // Start from ring carbons + ring H's
  let nC = size;
  let nH = hCountsPerAtom.reduce((s, n) => s + n, 0);
  let nO = 0, nN = 0, nCl = 0, nBr = 0, nF = 0, nI = 0;

  for (const sub of substituents) {
    const tpl = SUBSTITUENT_TEMPLATES[sub.kind];
    if (!tpl) continue;
    nC  += tpl.atomCounts.C  || 0;
    nH  += tpl.atomCounts.H  || 0;
    nO  += tpl.atomCounts.O  || 0;
    nN  += tpl.atomCounts.N  || 0;
    nCl += tpl.atomCounts.Cl || 0;
    nBr += tpl.atomCounts.Br || 0;
    nF  += tpl.atomCounts.F  || 0;
    nI  += tpl.atomCounts.I  || 0;
  }

  const parts = [];
  if (nC)  parts.push(nC  > 1 ? `C${nC}`   : 'C');
  if (nH)  parts.push(nH  > 1 ? `H${nH}`   : 'H');
  if (nN)  parts.push(nN  > 1 ? `N${nN}`   : 'N');
  if (nO)  parts.push(nO  > 1 ? `O${nO}`   : 'O');
  if (nCl) parts.push(nCl > 1 ? `Cl${nCl}` : 'Cl');
  if (nBr) parts.push(nBr > 1 ? `Br${nBr}` : 'Br');
  if (nF)  parts.push(nF  > 1 ? `F${nF}`   : 'F');
  if (nI)  parts.push(nI  > 1 ? `I${nI}`   : 'I');
  return parts.join('');
}

// Substituent templates — each entry describes the chemistry of one
// substituent type for purposes of molecular formula calculation,
// downstream structure building, and polarity/H-bond detection.
//
//   kind        : key
//   label       : user-visible short label (used in breakdowns)
//   atomCounts  : contribution to overall molecular formula {C,H,O,N,Cl,...}
//   isPolar     : does this substituent introduce polar bonds to the ring?
//   hasHBondDonor : can it donate an H-bond (has H on N/O/F)?
//   hasHBondAcceptor : can it accept an H-bond (has a lone pair on N/O/F)?
const SUBSTITUENT_TEMPLATES = {
  // -OH: 1 O, 1 H
  'hydroxyl': {
    label: '-OH',       atomCounts: { O: 1, H: 1 },
    isPolar: true,      hasHBondDonor: true,   hasHBondAcceptor: true
  },
  // -CH3: 1 C, 3 H
  'methyl': {
    label: '-CH3',      atomCounts: { C: 1, H: 3 },
    isPolar: false,     hasHBondDonor: false,  hasHBondAcceptor: false
  },
  // -NH2: 1 N, 2 H
  'amine': {
    label: '-NH2',      atomCounts: { N: 1, H: 2 },
    isPolar: true,      hasHBondDonor: true,   hasHBondAcceptor: true
  },
  // -COOH: 1 C, 2 O, 1 H (the OH's H)
  'carboxyl': {
    label: '-COOH',     atomCounts: { C: 1, O: 2, H: 1 },
    isPolar: true,      hasHBondDonor: true,   hasHBondAcceptor: true
  },
  // -CHO: 1 C, 1 O, 1 H (on the C)
  'aldehyde': {
    label: '-CHO',      atomCounts: { C: 1, O: 1, H: 1 },
    isPolar: true,      hasHBondDonor: false,  hasHBondAcceptor: true
  },
  // -Cl: 1 Cl
  'chloro': {
    label: '-Cl',       atomCounts: { Cl: 1 },
    isPolar: true,      hasHBondDonor: false,  hasHBondAcceptor: false
  },
  // -Br: 1 Br
  'bromo': {
    label: '-Br',       atomCounts: { Br: 1 },
    isPolar: true,      hasHBondDonor: false,  hasHBondAcceptor: false
  },
  // -F: 1 F
  'fluoro': {
    label: '-F',        atomCounts: { F: 1 },
    isPolar: true,      hasHBondDonor: false,  hasHBondAcceptor: true    // F can accept H-bonds
  },
  // -I: 1 I
  'iodo': {
    label: '-I',        atomCounts: { I: 1 },
    isPolar: true,      hasHBondDonor: false,  hasHBondAcceptor: false
  },
  // -NO2: 1 N, 2 O
  'nitro': {
    label: '-NO2',      atomCounts: { N: 1, O: 2 },
    isPolar: true,      hasHBondDonor: false,  hasHBondAcceptor: true    // O lone pairs
  },
  // -CH2OH: 1 C, 3 H, 1 O (R6d — used in sugars for the C6 primary alcohol)
  'hydroxymethyl': {
    label: '-CH2OH',    atomCounts: { C: 1, H: 3, O: 1 },
    isPolar: true,      hasHBondDonor: true,   hasHBondAcceptor: true
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point: parse a raw ring input.
//
// Dispatch order:
//   1. Named sugar                    (R6d)  — "glucose", "alpha-glucose", etc.
//   2. Named heterocycle              (R6c)  — "pyridine", "pyrrole", etc.
//   3. Named monosubstituted aromatic (R6a)  — "phenol", "toluene", etc.
//   4. Named disubstituted aromatic   (R6b)  — "o-xylene", "p-cresol", etc.
//   5. Prefix-based disubstituted     (R6b)  — "o-dichlorobenzene", "1,4-dinitrobenzene"
//   6. Named unsubstituted ring       (R5)   — "cyclohexane", "benzene", etc.
//   7. Pattern-based monosubstituted  (R6a)  — "C6H5OH", "C6H5-CH3", etc.
//   8. Stoichiometric heterocycle     (R6c)  — "C5H5N" → pyridine, etc.
//   9. Stoichiometric unsubstituted   (R5)   — "C6H6", "C6H12", etc.
// ─────────────────────────────────────────────────────────────────────────────
function parseRingFormula(raw, options) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'Enter a ring formula or name (e.g. C6H6, cyclohexane, benzene, phenol, pyridine, alpha-glucose).' };
  }
  const input = raw.trim();
  const nameKey = _normalizeName(input);
  const opts = options || {};

  // 1. Named sugar (R6d)
  if (SUGAR_NAMES[nameKey]) {
    return _buildSugarSpec(nameKey, input, opts.sugarView);
  }

  // 2. Named heterocycle (R6c) — note: don't match 'glucose' here; it's
  //    routed via SUGAR_NAMES above. The glucose template is in
  //    RING_HETEROCYCLES because the builder reads from that table, but
  //    we gate it from bare-name lookup to avoid returning unsubstituted
  //    glucose-skeleton without the -OH groups.
  if (RING_HETEROCYCLES[nameKey] && !RING_HETEROCYCLES[nameKey].isSugar) {
    const tpl = RING_HETEROCYCLES[nameKey];
    const notification = `Interpreted "${input}" as ${tpl.displayName} (${tpl.normalizedFormula}).`;
    return _buildHeterocycleSpec(nameKey, input, notification);
  }

  // 2. Named monosubstituted aromatic (R6a)
  if (RING_NAMED_SUBSTITUTED[nameKey]) {
    const entry = RING_NAMED_SUBSTITUTED[nameKey];
    const canonical = RING_NAMED_COMPOUNDS[entry.base] || 'C6H6';
    const stoich = _parseSimpleStoich(canonical);
    const classification = _classifyStoichiometry(stoich.nC, stoich.nH);
    if (!classification) {
      return { ok: false, error: `Internal: named compound "${input}" has no valid base ring.` };
    }
    const spec = _buildRingSpec(classification, input, stoich.nH, null, entry.substituents);
    if (!spec.ok) return spec;

    // Set a user-friendly display name based on the input (capitalized)
    spec.displayName = _canonicalizeSubstitutedName(nameKey) || spec.displayName;
    spec.notification = `Interpreted "${input}" as ${spec.displayName} — benzene with ` +
      `${spec.substituents.map(s => SUBSTITUENT_LABELS[s.kind] || s.kind).join(', ')} substituent.`;
    return spec;
  }

  // 3. Named disubstituted aromatic (R6b)
  if (RING_NAMED_DISUBSTITUTED[nameKey]) {
    const entry = RING_NAMED_DISUBSTITUTED[nameKey];
    const canonical = 'C6H6';
    const stoich = _parseSimpleStoich(canonical);
    const classification = _classifyStoichiometry(stoich.nC, stoich.nH);
    const substituents = [
      { pos: entry.positions[0], kind: entry.kinds[0] },
      { pos: entry.positions[1], kind: entry.kinds[1] }
    ];
    const spec = _buildRingSpec(classification, input, stoich.nH, null, substituents);
    if (!spec.ok) return spec;

    spec.displayName = entry.display;
    spec.notification = _disubstitutedNotification(input, entry.display, substituents);
    return spec;
  }

  // 4. Prefix-based disubstituted (R6b) — handles forms like:
  //    "o-dichlorobenzene", "p-dibromobenzene", "1,4-dinitrobenzene",
  //    "m-dihydroxybenzene", etc.
  const prefixResult = _tryPrefixDisubstitutedAromatic(input);
  if (prefixResult) {
    if (!prefixResult.ok) return prefixResult;
    return prefixResult;
  }

  // 5. Named unsubstituted ring (R5)
  if (RING_NAMED_COMPOUNDS[nameKey]) {
    const canonical = RING_NAMED_COMPOUNDS[nameKey];
    const stoich = _parseSimpleStoich(canonical);
    const classification = _classifyStoichiometry(stoich.nC, stoich.nH);
    if (!classification) {
      return { ok: false, error: `Internal: named compound "${input}" has no valid classification.` };
    }
    const notification =
      `Interpreted "${input}" as ${classification.displayName} (${canonical}).`;
    return _buildRingSpec(classification, input, stoich.nH, notification, []);
  }

  // 6. Pattern-based monosubstituted aromatic (R6a)
  //    Input forms: C6H5X, C6H5-X (hyphen stripped first)
  const patternResult = _tryPatternSubstitutedAromatic(input);
  if (patternResult) {
    if (!patternResult.ok) return patternResult;
    return patternResult;
  }

  // 7. Stoichiometric heterocycle (R6c) — C5H5N, C4H4O, C4H4S, C4H5N
  //    Normalized input (uppercase C/N/O/S preserved in raw; see lookup)
  const stoichKey = _heterocycleStoichKey(input);
  if (stoichKey && HETEROCYCLE_STOICH_MAP[stoichKey]) {
    const heteroName = HETEROCYCLE_STOICH_MAP[stoichKey];
    const tpl = RING_HETEROCYCLES[heteroName];
    const notification = `Interpreted "${input}" as ${tpl.displayName} (${tpl.normalizedFormula}).`;
    return _buildHeterocycleSpec(heteroName, input, notification);
  }

  // 8. Stoichiometric unsubstituted ring (R5)
  const stoich = _parseSimpleStoich(input);
  if (stoich) {
    const classification = _classifyStoichiometry(stoich.nC, stoich.nH);
    if (classification) {
      let notification = `Interpreted as ${classification.displayName}.`;
      const chainAlternative = _chainAlternativeForStoich(stoich.nC, stoich.nH);
      if (chainAlternative) {
        notification +=
          ` (In the Molecules tab, ${input} would be ${chainAlternative}.)`;
      }
      return _buildRingSpec(classification, input, stoich.nH, notification, []);
    }
  }

  // No match — informative error
  return {
    ok: false,
    error: `Couldn't interpret "${input}" as a supported ring. ` +
           `Supported formulas: C3H6, C4H8, C5H10, C6H12 (cycloalkanes); ` +
           `C5H8, C6H10 (cycloalkenes); C6H6 (benzene); ` +
           `C6H5X for substituted benzenes (e.g. C6H5OH, C6H5CH3). ` +
           `Supported names: ${RING_NAMED_COMPOUND_LIST.join(', ')}.`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern-based substituted aromatic parser. Handles C6H5X and C6H5-X
// forms where X is one of the supported substituent patterns.
//
// Returns:
//   - a ring spec if the input matches a known pattern
//   - { ok: false, error: ... } if it looks substituted-aromatic but X
//     isn't a recognized substituent (so we don't fall through to
//     generic stoich parse)
//   - null if the input doesn't look like C6H5X at all (caller falls through)
// ─────────────────────────────────────────────────────────────────────────────
function _tryPatternSubstitutedAromatic(input) {
  // Strip hyphens as syntactic sugar
  const s = input.replace(/[\s\-]/g, '');

  // Must start with "C6H5" (benzene minus one H)
  if (!s.startsWith('C6H5')) return null;
  const tail = s.slice(4);
  if (tail === '') return null;    // just "C6H5" alone is incomplete

  // Identify the substituent pattern
  const kind = _recognizeSubstituentPattern(tail);
  if (!kind) {
    return {
      ok: false,
      error: `"${input}" looks like a substituted benzene, but the substituent ` +
             `"${tail}" isn't supported in R6a. Try: OH, CH3, NH2, COOH, CHO, ` +
             `Cl, Br, F, I, NO2. Or use the named form (e.g. "phenol", "toluene").`
    };
  }

  // Build the spec
  const canonical = RING_NAMED_COMPOUNDS.benzene;
  const stoich = _parseSimpleStoich(canonical);
  const classification = _classifyStoichiometry(stoich.nC, stoich.nH);
  const spec = _buildRingSpec(classification, input, stoich.nH, null,
    [{ pos: 0, kind }]);
  if (!spec.ok) return spec;

  // Friendly display name — use known named if C6H5X maps to one
  const displayName = _displayNameForMonoSub(kind) || 'substituted benzene';
  spec.displayName = displayName;
  spec.notification = `Interpreted "${input}" as ${displayName} — benzene with ` +
    `${SUBSTITUENT_LABELS[kind] || kind} substituent.`;
  return spec;
}

// Pattern → kind. Order matters: longer patterns first to avoid mis-matching.
function _recognizeSubstituentPattern(tail) {
  // Longer patterns (COOH before CHO before CO)
  if (tail === 'COOH') return 'carboxyl';
  if (tail === 'CHO')  return 'aldehyde';
  if (tail === 'NO2')  return 'nitro';
  if (tail === 'NH2')  return 'amine';
  if (tail === 'CH3')  return 'methyl';
  if (tail === 'OH')   return 'hydroxyl';
  if (tail === 'Cl')   return 'chloro';
  if (tail === 'Br')   return 'bromo';
  if (tail === 'F')    return 'fluoro';
  if (tail === 'I')    return 'iodo';
  return null;
}

// Map a substituent kind to its common name for the monosubstituted benzene.
function _displayNameForMonoSub(kind) {
  const names = {
    'hydroxyl': 'phenol',
    'methyl':   'toluene',
    'amine':    'aniline',
    'carboxyl': 'benzoic acid',
    'aldehyde': 'benzaldehyde',
    'chloro':   'chlorobenzene',
    'bromo':    'bromobenzene',
    'fluoro':   'fluorobenzene',
    'iodo':     'iodobenzene',
    'nitro':    'nitrobenzene'
  };
  return names[kind] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prefix-based disubstituted parser (R6b). Handles these forms:
//   "o-dichlorobenzene"   → positions 1,2
//   "m-dibromobenzene"    → positions 1,3
//   "p-dihydroxybenzene"  → positions 1,4
//   "1,2-dinitrobenzene"  → positions 1,2
//   "1,3-dichlorobenzene" → positions 1,3
//   "1,4-dimethylbenzene" → positions 1,4
//
// Returns a ring spec on success, { ok: false, error } on syntactic match
// with an unsupported base, or null if the input doesn't look like a
// prefixed disubstituted aromatic at all.
// ─────────────────────────────────────────────────────────────────────────────
function _tryPrefixDisubstitutedAromatic(input) {
  const stripped = input.trim().toLowerCase();

  // Recognise prefix patterns. Accept optional whitespace/hyphens.
  //   "o-", "ortho-", "m-", "meta-", "p-", "para-"
  //   "1,2-", "1,3-", "1,4-"
  const prefixMatch = stripped.match(/^(o|m|p|ortho|meta|para|1,2|1,3|1,4)\s*-\s*(.+)$/);
  if (!prefixMatch) return null;

  const prefix = prefixMatch[1];
  const baseInput = prefixMatch[2].replace(/\s+/g, '');

  // Look up the base (e.g. "dichlorobenzene") in the R6b registry
  const base = RING_DISUBSTITUTED_BASES[baseInput];
  if (!base) return null;

  // Translate the prefix to ring positions (engine 0-indexed)
  let positions;
  switch (prefix) {
    case 'o': case 'ortho': case '1,2': positions = [0, 1]; break;
    case 'm': case 'meta':  case '1,3': positions = [0, 2]; break;
    case 'p': case 'para':  case '1,4': positions = [0, 3]; break;
    default: return null;
  }

  // Build the spec
  const canonical = 'C6H6';
  const stoich = _parseSimpleStoich(canonical);
  const classification = _classifyStoichiometry(stoich.nC, stoich.nH);
  const substituents = [
    { pos: positions[0], kind: base.kinds[0] },
    { pos: positions[1], kind: base.kinds[1] }
  ];
  const spec = _buildRingSpec(classification, input, stoich.nH, null, substituents);
  if (!spec.ok) return spec;

  // Normalize the display name to "o-basename" / "m-basename" / "p-basename"
  // using the canonical one-letter prefix even if user typed "ortho-" etc.
  const prefixLetter = (prefix === 'o' || prefix === 'ortho' || prefix === '1,2') ? 'o'
                     : (prefix === 'm' || prefix === 'meta'  || prefix === '1,3') ? 'm'
                     : 'p';
  spec.displayName = `${prefixLetter}-${baseInput}`;
  spec.notification = _disubstitutedNotification(input, spec.displayName, substituents);
  return spec;
}

// Build a clear user-facing notification about how a disubstituted aromatic
// was interpreted. Mentions both the name and the positional relationship.
function _disubstitutedNotification(rawInput, displayName, substituents) {
  const [s1, s2] = substituents;
  const labels = [SUBSTITUENT_LABELS[s1.kind] || s1.kind,
                  SUBSTITUENT_LABELS[s2.kind] || s2.kind];
  const relation =
    (s1.pos === 0 && s2.pos === 1) ? 'ortho (1,2 — adjacent)' :
    (s1.pos === 0 && s2.pos === 2) ? 'meta (1,3)' :
    (s1.pos === 0 && s2.pos === 3) ? 'para (1,4 — opposite)' :
    'at positions ' + (s1.pos + 1) + ' and ' + (s2.pos + 1);
  const subDesc = (labels[0] === labels[1])
    ? `two ${labels[0]} substituents`
    : `${labels[0]} and ${labels[1]} substituents`;
  return `Interpreted "${rawInput}" as ${displayName} — benzene with ${subDesc} in the ${relation} relationship.`;
}


// Handles whitespace reintroduction ("benzoicacid" → "benzoic acid").
function _canonicalizeSubstitutedName(nameKey) {
  const canonical = {
    'phenol': 'phenol',
    'toluene': 'toluene',
    'methylbenzene': 'methylbenzene',
    'aniline': 'aniline',
    'aminobenzene': 'aminobenzene',
    'benzoicacid': 'benzoic acid',
    'benzaldehyde': 'benzaldehyde',
    'chlorobenzene': 'chlorobenzene',
    'bromobenzene': 'bromobenzene',
    'fluorobenzene': 'fluorobenzene',
    'iodobenzene': 'iodobenzene',
    'nitrobenzene': 'nitrobenzene'
  };
  return canonical[nameKey] || null;
}

// Describe the open-chain interpretation of a CₙHₘ stoichiometry, so we can
// tell the user "in the Molecules tab, C6H12 would be a hexene or
// methylpentene." Returns null if there's no meaningful alternative.
function _chainAlternativeForStoich(nC, nH) {
  if (nC < 2) return null;
  if (nH === 2 * nC + 2) return `a straight-chain alkane (C${nC}H${nH})`;
  if (nH === 2 * nC)     return `a straight-chain alkene (C${nC}H${nH}, e.g. ${nC === 3 ? 'propene' : nC === 4 ? 'butene' : nC === 5 ? 'pentene' : nC === 6 ? 'hexene' : 'an alkene'})`;
  if (nH === 2 * nC - 2) return `a straight-chain alkyne or diene (C${nC}H${nH})`;
  if (nH === 2 * nC - 4 && nC === 6) return 'benzene (same molecule) or an aromatic precursor';
  return null;
}

// Expose
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseRingFormula,
    RING_NAMED_COMPOUND_LIST,
    RING_NAMED_COMPOUNDS,
    RING_NAMED_SUBSTITUTED,
    RING_NAMED_DISUBSTITUTED,
    RING_DISUBSTITUTED_BASES,
    RING_HETEROCYCLES,
    HETEROCYCLE_STOICH_MAP,
    SUGAR_NAMES,
    GLUCOSE_SUBSTITUENTS,
    SUBSTITUENT_TEMPLATES,
    SUBSTITUENT_LABELS
  };
}
