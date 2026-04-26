// polyatomic-ion-data.js
// ─────────────────────────────────────────────────────────────────────────────
// Lookup table for common polyatomic ions. Each entry contains the
// ion's formula (as typed inside parentheses in a formula), its charge,
// display name, and EITHER:
//   - a `coreFormula` field — the Lewis engine builds the ion on demand, OR
//   - a `prebuilt` field — a hardcoded structure used when the ion has
//     multi-center connectivity (S-S, C-C, bridging atoms) that the single-
//     central-atom NASB engine cannot build correctly.
//
// Keys are canonical, uppercase, no charge or braces. Lookup is
// case-sensitive on the first char + lowercase remainder (matches how
// parse tokens arrive).
// ─────────────────────────────────────────────────────────────────────────────

const POLYATOMIC_IONS = {
  // ─── Anions ──────────────────────────────────────────────────────────

  // Hydroxide — O bonded to H with 3 lone pairs on O, −1 overall
  'OH': {
    name: 'hydroxide',
    coreFormula: 'OH',
    charge: -1
  },

  // Cyanide — C triple-bonded to N, −1 on C
  'CN': {
    name: 'cyanide',
    coreFormula: 'CN',
    charge: -1
  },

  // Thiocyanate — S=C=N⁻ linear, −1 overall
  'SCN': {
    name: 'thiocyanate',
    coreFormula: 'SCN',
    charge: -1
  },

  // Nitrate — trigonal planar, 3 equivalent resonance forms, −1 overall
  'NO3': {
    name: 'nitrate',
    coreFormula: 'NO3',
    charge: -1
  },

  // Nitrite — bent, −1 overall
  'NO2': {
    name: 'nitrite',
    coreFormula: 'NO2',
    charge: -1
  },

  // Sulfate — tetrahedral, −2 overall. Expanded-octet form:
  // 2 S=O + 2 S-O⁻, S at FC 0 (post-R2a FC minimization)
  'SO4': {
    name: 'sulfate',
    coreFormula: 'SO4',
    charge: -2
  },

  // Sulfite — trigonal pyramid, −2 overall
  'SO3': {
    name: 'sulfite',
    coreFormula: 'SO3',
    charge: -2
  },

  // Bisulfate / hydrogen sulfate — −1 overall. H on O (acid-H routing)
  'HSO4': {
    name: 'bisulfate',
    coreFormula: 'HSO4',
    charge: -1
  },

  // Bisulfite / hydrogen sulfite — −1 overall
  'HSO3': {
    name: 'bisulfite',
    coreFormula: 'HSO3',
    charge: -1
  },

  // Phosphate — tetrahedral, −3 overall. Expanded-octet form.
  'PO4': {
    name: 'phosphate',
    coreFormula: 'PO4',
    charge: -3
  },

  // Phosphite — PO3³⁻ (real as of 2025; ortho-phosphite).
  // Note: In HS textbooks "phosphite" usually means HPO3²⁻; keeping PO3³⁻
  // here at Chris's request with HPO3²⁻ also available as a separate entry.
  'PO3': {
    name: 'phosphite',
    coreFormula: 'PO3',
    charge: -3
  },

  // Hydrogen phosphate — HPO4²⁻, from H2PO4⁻ + H → HPO4²⁻
  'HPO4': {
    name: 'hydrogen phosphate',
    coreFormula: 'HPO4',
    charge: -2
  },

  // Dihydrogen phosphate — H2PO4⁻, from H3PO4 + H → H2PO4⁻
  'H2PO4': {
    name: 'dihydrogen phosphate',
    coreFormula: 'H2PO4',
    charge: -1
  },

  // Hydrogen phosphite — HPO3²⁻, from H3PO3 (phosphorous acid) deprotonated.
  // This is what HS textbooks commonly label "phosphite".
  'HPO3': {
    name: 'hydrogen phosphite',
    coreFormula: 'HPO3',
    charge: -2
  },

  // Dihydrogen phosphite — H2PO3⁻
  'H2PO3': {
    name: 'dihydrogen phosphite',
    coreFormula: 'H2PO3',
    charge: -1
  },

  // Hypophosphite — H2PO2⁻, sodium salt is industrial reducing agent
  'H2PO2': {
    name: 'hypophosphite',
    coreFormula: 'H2PO2',
    charge: -1
  },

  // Arsenate — AsO4³⁻ tetrahedral
  'AsO4': {
    name: 'arsenate',
    coreFormula: 'AsO4',
    charge: -3
  },

  // Arsenite — AsO3³⁻ trigonal pyramid
  'AsO3': {
    name: 'arsenite',
    coreFormula: 'AsO3',
    charge: -3
  },

  // Hydrogen arsenate — HAsO4²⁻
  'HAsO4': {
    name: 'hydrogen arsenate',
    coreFormula: 'HAsO4',
    charge: -2
  },

  // Dihydrogen arsenate — H2AsO4⁻
  'H2AsO4': {
    name: 'dihydrogen arsenate',
    coreFormula: 'H2AsO4',
    charge: -1
  },

  // Borate — BO3³⁻ (orthoborate) trigonal planar
  'BO3': {
    name: 'borate',
    coreFormula: 'BO3',
    charge: -3
  },

  // Metaborate — BO2⁻ linear with one B=O, one B-O⁻
  'BO2': {
    name: 'metaborate',
    coreFormula: 'BO2',
    charge: -1
  },

  // Carbonate — trigonal planar, 3 resonance forms, −2 overall
  'CO3': {
    name: 'carbonate',
    coreFormula: 'CO3',
    charge: -2
  },

  // Bicarbonate / hydrogen carbonate — −1 overall.
  // H on O (acid-H routing), C=O in the non-protonated direction.
  'HCO3': {
    name: 'bicarbonate',
    coreFormula: 'HCO3',
    charge: -1
  },

  // Acetate — CH3COO⁻. Multi-carbon backbone; pre-built structure.
  // Layout: CH3 on left, COO⁻ on right.
  'C2H3O2': {
    name: 'acetate',
    coreFormula: 'C2H3O2',
    charge: -1,
    prebuilt: {
      // Atom indices:
      //   0: C (methyl carbon)    1: C (carboxyl carbon)
      //   2: H on methyl          3: H on methyl           4: H on methyl
      //   5: O (C=O, double)      6: O (C-O⁻, single)
      atoms: [
        { symbol: 'C', lonePairs: 0, formalCharge:  0, isCentral: true,  x: -100, y:    0 },
        { symbol: 'C', lonePairs: 0, formalCharge:  0, isCentral: true,  x:  100, y:    0 },
        { symbol: 'H', lonePairs: 0, formalCharge:  0, isCentral: false, x: -170, y:  -80 },
        { symbol: 'H', lonePairs: 0, formalCharge:  0, isCentral: false, x: -170, y:   80 },
        { symbol: 'H', lonePairs: 0, formalCharge:  0, isCentral: false, x: -180, y:    0 },
        { symbol: 'O', lonePairs: 2, formalCharge:  0, isCentral: false, x:  180, y:  -90 },
        { symbol: 'O', lonePairs: 3, formalCharge: -1, isCentral: false, x:  180, y:   90 }
      ],
      bonds: [
        { i: 0, j: 1, order: 1 },    // C-C
        { i: 0, j: 2, order: 1 },    // C-H
        { i: 0, j: 3, order: 1 },    // C-H
        { i: 0, j: 4, order: 1 },    // C-H
        { i: 1, j: 5, order: 2 },    // C=O
        { i: 1, j: 6, order: 1 }     // C-O⁻
      ],
      centralIdx: 1,
      isMultiCenter: true
    }
  },

  // Formate — HCOO⁻. H on C (not on O — formate's H is the CH hydrogen).
  // Pre-built because acid-H auto-routing would wrongly place H on O.
  'HCO2': {
    name: 'formate',
    coreFormula: 'HCO2',
    charge: -1,
    prebuilt: {
      // Atom indices:
      //   0: C (central)       1: H (on C)
      //   2: O (C=O)           3: O (C-O⁻)
      atoms: [
        { symbol: 'C', lonePairs: 0, formalCharge:  0, isCentral: true,  x:    0, y:    0 },
        { symbol: 'H', lonePairs: 0, formalCharge:  0, isCentral: false, x:    0, y: -130 },
        { symbol: 'O', lonePairs: 2, formalCharge:  0, isCentral: false, x:  115, y:   65 },
        { symbol: 'O', lonePairs: 3, formalCharge: -1, isCentral: false, x: -115, y:   65 }
      ],
      bonds: [
        { i: 0, j: 1, order: 1 },    // C-H
        { i: 0, j: 2, order: 2 },    // C=O
        { i: 0, j: 3, order: 1 }     // C-O⁻
      ],
      centralIdx: 0,
      isMultiCenter: false
    }
  },

  // Oxalate — [O2C-CO2]²⁻. Two C atoms bonded together, each with one C=O
  // and one C-O⁻. Symmetric around the C-C bond. Pre-built.
  'C2O4': {
    name: 'oxalate',
    coreFormula: 'C2O4',
    charge: -2,
    prebuilt: {
      // Atom indices:
      //   0: C (left center)     1: C (right center)
      //   2: O (C0=O, double)    3: O (C0-O⁻, single)
      //   4: O (C1=O, double)    5: O (C1-O⁻, single)
      atoms: [
        { symbol: 'C', lonePairs: 0, formalCharge:  0, isCentral: true,  x: -100, y:    0 },
        { symbol: 'C', lonePairs: 0, formalCharge:  0, isCentral: true,  x:  100, y:    0 },
        { symbol: 'O', lonePairs: 2, formalCharge:  0, isCentral: false, x: -200, y:  -90 },
        { symbol: 'O', lonePairs: 3, formalCharge: -1, isCentral: false, x: -200, y:   90 },
        { symbol: 'O', lonePairs: 2, formalCharge:  0, isCentral: false, x:  200, y:   90 },
        { symbol: 'O', lonePairs: 3, formalCharge: -1, isCentral: false, x:  200, y:  -90 }
      ],
      bonds: [
        { i: 0, j: 1, order: 1 },    // C-C
        { i: 0, j: 2, order: 2 },    // C=O
        { i: 0, j: 3, order: 1 },    // C-O⁻
        { i: 1, j: 4, order: 2 },    // C=O
        { i: 1, j: 5, order: 1 }     // C-O⁻
      ],
      centralIdx: 0,
      isMultiCenter: true
    }
  },

  // Thiosulfate — [S-SO3]²⁻. Central S with 1 S-S bond + 3 S-O bonds.
  // Expanded octet on central S: 2 S=O + 1 S-O⁻ + 1 S-S (terminal S carries
  // the remaining -1 FC). Pre-built because the S-S backbone is outside
  // the single-central-atom engine's scope.
  'S2O3': {
    name: 'thiosulfate',
    coreFormula: 'S2O3',
    charge: -2,
    prebuilt: {
      // Atom indices:
      //   0: S (central, tetrahedral)  1: S (terminal, FC -1)
      //   2: O (S=O, double)           3: O (S=O, double)
      //   4: O (S-O⁻, single, FC -1)
      atoms: [
        { symbol: 'S', lonePairs: 0, formalCharge:  0, isCentral: true,  x:    0, y:    0 },
        { symbol: 'S', lonePairs: 3, formalCharge: -1, isCentral: false, x:  160, y:    0 },
        { symbol: 'O', lonePairs: 2, formalCharge:  0, isCentral: false, x:  -90, y: -130 },
        { symbol: 'O', lonePairs: 2, formalCharge:  0, isCentral: false, x:  -90, y:  130 },
        { symbol: 'O', lonePairs: 3, formalCharge: -1, isCentral: false, x: -160, y:    0 }
      ],
      bonds: [
        { i: 0, j: 1, order: 1 },    // S-S
        { i: 0, j: 2, order: 2 },    // S=O
        { i: 0, j: 3, order: 2 },    // S=O
        { i: 0, j: 4, order: 1 }     // S-O⁻
      ],
      centralIdx: 0,
      isMultiCenter: true
    }
  },

  // Permanganate — Mn with 4 O, −1 overall. Mn is beyond the engine's
  // usual coverage but behaves like a main-group oxyanion with expanded
  // octet — 3 Mn=O + 1 Mn-O⁻.
  'MnO4': {
    name: 'permanganate',
    coreFormula: 'MnO4',
    charge: -1
  },

  // Chromate — Cr with 4 O, −2 overall. Expanded octet on Cr.
  'CrO4': {
    name: 'chromate',
    coreFormula: 'CrO4',
    charge: -2
  },

  // Dichromate — 2 Cr atoms bridged by one O, each Cr bound to 3 terminal O
  // (2 double-bonded + 1 single-bonded O⁻). Expanded octet on Cr.
  // Pre-built because multi-center connectivity is outside the engine.
  'Cr2O7': {
    name: 'dichromate',
    coreFormula: 'Cr2O7',
    charge: -2,
    prebuilt: {
      atoms: [
        { symbol: 'Cr', lonePairs: 0, formalCharge:  0, isCentral: true,  x: -120, y:    0 },
        { symbol: 'Cr', lonePairs: 0, formalCharge:  0, isCentral: true,  x:  120, y:    0 },
        { symbol: 'O',  lonePairs: 2, formalCharge:  0, isCentral: false, x:    0, y:    0 },
        { symbol: 'O',  lonePairs: 2, formalCharge:  0, isCentral: false, x: -200, y: -104 },
        { symbol: 'O',  lonePairs: 2, formalCharge:  0, isCentral: false, x: -200, y:  104 },
        { symbol: 'O',  lonePairs: 3, formalCharge: -1, isCentral: false, x: -120, y: -140 },
        { symbol: 'O',  lonePairs: 2, formalCharge:  0, isCentral: false, x:  200, y: -104 },
        { symbol: 'O',  lonePairs: 2, formalCharge:  0, isCentral: false, x:  200, y:  104 },
        { symbol: 'O',  lonePairs: 3, formalCharge: -1, isCentral: false, x:  120, y: -140 }
      ],
      bonds: [
        { i: 0, j: 2, order: 1 },    // Cr-O bridge
        { i: 1, j: 2, order: 1 },    // Cr-O bridge
        { i: 0, j: 3, order: 2 },    // Cr=O
        { i: 0, j: 4, order: 2 },    // Cr=O
        { i: 0, j: 5, order: 1 },    // Cr-O⁻
        { i: 1, j: 6, order: 2 },    // Cr=O
        { i: 1, j: 7, order: 2 },    // Cr=O
        { i: 1, j: 8, order: 1 }     // Cr-O⁻
      ],
      centralIdx: 0,
      isMultiCenter: true
    }
  },

  // Hypochlorite — bent, −1 overall
  'ClO': {
    name: 'hypochlorite',
    coreFormula: 'ClO',
    charge: -1
  },

  // Chlorite — bent, −1 overall
  'ClO2': {
    name: 'chlorite',
    coreFormula: 'ClO2',
    charge: -1
  },

  // Chlorate — trigonal pyramid, −1 overall
  'ClO3': {
    name: 'chlorate',
    coreFormula: 'ClO3',
    charge: -1
  },

  // Perchlorate — tetrahedral, −1 overall. Expanded-octet form: 3 Cl=O + 1 Cl-O⁻
  'ClO4': {
    name: 'perchlorate',
    coreFormula: 'ClO4',
    charge: -1
  },

  // Hypobromite, bromite, bromate, perbromate — Br analogs of the chlorine oxyanions
  'BrO': {
    name: 'hypobromite',
    coreFormula: 'BrO',
    charge: -1
  },

  'BrO2': {
    name: 'bromite',
    coreFormula: 'BrO2',
    charge: -1
  },

  'BrO3': {
    name: 'bromate',
    coreFormula: 'BrO3',
    charge: -1
  },

  'BrO4': {
    name: 'perbromate',
    coreFormula: 'BrO4',
    charge: -1
  },

  // Hypoiodite, iodite, iodate, periodate — I analogs
  'IO': {
    name: 'hypoiodite',
    coreFormula: 'IO',
    charge: -1
  },

  'IO2': {
    name: 'iodite',
    coreFormula: 'IO2',
    charge: -1
  },

  'IO3': {
    name: 'iodate',
    coreFormula: 'IO3',
    charge: -1
  },

  'IO4': {
    name: 'periodate',
    coreFormula: 'IO4',
    charge: -1
  },

  // Peroxide — O–O single bond, −2 overall
  'O2': {
    name: 'peroxide',
    coreFormula: 'O2',
    charge: -2
  },

  // ─── Cations ──────────────────────────────────────────────────────────

  // Ammonium — tetrahedral N with 4 H, +1 overall
  'NH4': {
    name: 'ammonium',
    coreFormula: 'NH4',
    charge: +1
  },

  // Hydronium — trigonal pyramid O with 3 H, +1 overall
  'H3O': {
    name: 'hydronium',
    coreFormula: 'H3O',
    charge: +1
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Look up a polyatomic ion by its formula (the string between parens).
// Returns the entry, or null if not found.
// ─────────────────────────────────────────────────────────────────────────────
function lookupPolyatomicIon(formulaStr) {
  if (!formulaStr) return null;
  return POLYATOMIC_IONS[formulaStr] || null;
}

// Get a list of all known polyatomic ion keys (for error messages, testing)
function knownPolyatomicIonKeys() {
  return Object.keys(POLYATOMIC_IONS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Materialize a polyatomic ion's pre-built structure into the shape that
// buildLewisStructure() normally returns. Pre-built structures skip the
// NASB engine entirely — they're used for ions the engine's single-
// central-atom approach cannot build correctly (dichromate, thiosulfate,
// oxalate, acetate, formate with bridging/multi-center atoms or where
// the engine would produce wrong connectivity).
//
// Returns an object identical in shape to buildLewisStructure's success
// return, or null if the ion has no prebuilt field.
// ─────────────────────────────────────────────────────────────────────────────
function materializePrebuiltStructure(ionEntry) {
  if (!ionEntry || !ionEntry.prebuilt) return null;
  const pb = ionEntry.prebuilt;

  // Deep-copy atoms, assign indices
  const atoms = pb.atoms.map((a, idx) => ({
    symbol:       a.symbol,
    x:            a.x || 0,
    y:            a.y || 0,
    lonePairs:    a.lonePairs,
    formalCharge: a.formalCharge,
    isCentral:    !!a.isCentral,
    index:        idx
  }));

  // Deep-copy bonds
  const bonds = pb.bonds.map(b => ({ i: b.i, j: b.j, order: b.order }));

  return {
    ok: true,
    atoms,
    bonds,
    overallCharge: ionEntry.charge || 0,
    isIon: (ionEntry.charge || 0) !== 0,
    nasb: null,                // no NASB was run
    centralAtomChoice: {
      symbol: atoms[pb.centralIdx || 0].symbol,
      reason: 'Pre-built structure for ' + ionEntry.name +
              ' — multi-center connectivity beyond the single-central-atom engine.'
    },
    validationNotes: ['Rendered from the curated pre-built structure for ' + ionEntry.name + '.'],
    octetMetOnAllAtoms: true,
    isPrebuilt: true,
    isMultiCenter: !!pb.isMultiCenter
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Match a parsed formula + charge against pre-built polyatomic entries.
// Used by buildLewisStructure to short-circuit when someone types
// Cr2O7{-2} (or any other pre-built entry's core formula + charge).
// ─────────────────────────────────────────────────────────────────────────────
function findPrebuiltMatch(parsed) {
  if (!parsed || !parsed.atoms) return null;
  const parsedFormula = parsed.atoms
    .map(a => a.symbol + (a.count > 1 ? a.count : ''))
    .join('');
  const parsedCharge = parsed.charge || 0;
  for (const key of Object.keys(POLYATOMIC_IONS)) {
    const entry = POLYATOMIC_IONS[key];
    if (!entry.prebuilt) continue;
    if (entry.coreFormula === parsedFormula && entry.charge === parsedCharge) {
      return entry;
    }
  }
  return null;
}
