// resonance-engine.js
// ─────────────────────────────────────────────────────────────────────────────
// Generates resonance structures for a covalent Lewis structure and applies
// Chris's three-criteria picking rule to label the "BEST" structure.
//
//   Input:  a structure object from lewis-engine.js
//   Output: {
//     hasResonance:   Boolean,
//     structures:     [ structureObject, ... ],   // all valid forms
//     bestIndices:    [int, ...],                 // indices of best structure(s)
//     pickingNotes:   [String]                    // step-by-step reasoning
//   }
//
// Resonance detection (per teaching notes):
//   A structure has resonance possibilities when it contains at least one
//   multiple bond AND at least one adjacent atom with a lone pair.
//
// Generation procedure (your arrow-pushing rules):
//   For each (multi-bond atom ↔ adjacent lone-pair atom) pair:
//     • Shift one pair from the adjacent atom down to form a new bond
//     • Shift one pair from the existing multi-bond up to form a lone pair
//       on the atom at the other end of that bond
//   Iterate until no new unique structures emerge.
//
// Picking criteria (applied in order):
//   1. Every atom's octet is met (already enforced during construction)
//   2. Lowest total |formal charge| wins
//   3. Tiebreaker: negative FC on more-electronegative atom, positive FC on
//      less-electronegative atom  — lower (more negative) EN-weighted score
// ─────────────────────────────────────────────────────────────────────────────

function generateResonanceStructures(structure) {
  if (!structure || !structure.ok) {
    return { hasResonance:false, structures:[], bestIndices:[], pickingNotes:[] };
  }

  // Pre-built structures are canonical curated references — there's no
  // engine-driven bond reshuffling to explore for them. Return the single
  // structure as-is so the downstream pipeline stays consistent.
  if (structure.isPrebuilt) {
    return {
      hasResonance: false,
      structures:   [structure],
      bestIndices:  [0],
      pickingNotes: ['Pre-built structure — no resonance enumeration applied.']
    };
  }

  // Ring aromatic structures (benzene in R5 scope) — produce the 2 Kekulé
  // forms directly rather than running the general FC-minimization loop.
  // This also prevents the generator from going infinite on closed loops.
  if (structure.isRing) {
    if (structure.isAromatic && typeof buildAlternateKekuleStructure === 'function') {
      const alt = buildAlternateKekuleStructure(structure);
      if (alt) {
        return {
          hasResonance: true,
          structures:   [structure, alt],
          bestIndices:  [0, 1],       // Both Kekulé forms are equivalent
          pickingNotes: [
            'Benzene exists as a resonance hybrid of 2 equivalent Kekulé structures. ' +
            'The actual molecule has all C–C bonds of equal length (between a single ' +
            'and double bond) due to delocalization of π electrons around the ring.'
          ]
        };
      }
    }
    // Non-aromatic ring — no resonance
    return {
      hasResonance: false,
      structures:   [structure],
      bestIndices:  [0],
      pickingNotes: ['No resonance — saturated or simply-unsaturated ring has one valid structure.']
    };
  }

  // Chain structures — no resonance generated (FC-permutation approach
  // doesn't apply to chains the way it does to single-central-atom molecules).
  if (structure.isChain) {
    return {
      hasResonance: false,
      structures:   [structure],
      bestIndices:  [0],
      pickingNotes: ['Chain molecule — resonance enumeration not applied.']
    };
  }

  const seen        = new Map();     // canonical-key → structure
  const queue       = [structure];
  seen.set(canonicalKey(structure), structure);

  while (queue.length > 0) {
    const current = queue.shift();
    const neighbors = generateNeighborStructures(current);
    for (const n of neighbors) {
      const key = canonicalKey(n);
      if (!seen.has(key)) {
        seen.set(key, n);
        queue.push(n);
      }
    }
  }

  const all = Array.from(seen.values());
  const hasResonance = all.length > 1;

  if (!hasResonance) {
    return {
      hasResonance: false,
      structures:   [structure],
      bestIndices:  [0],
      pickingNotes: ['No resonance — only one valid structure exists for this molecule.']
    };
  }

  const picked = pickBestStructure(all);
  return {
    hasResonance: true,
    structures:   all,
    bestIndices:  picked.bestIndices,
    pickingNotes: picked.notes
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate all single-arrow-push neighbors of a given structure.
// Each neighbor represents ONE step:
//   • Move a lone pair from atom X down into bond (X–Y), making X=Y / X≡Y
//   • Simultaneously move a pair from an existing double/triple bond at Y
//     onto another atom Z as a lone pair (conservation of electrons)
//
// The "Y has a multiple bond to Z" requirement comes from the arrow-pushing
// rule that all electrons move in the same direction along adjacent bonds.
// ─────────────────────────────────────────────────────────────────────────────
function generateNeighborStructures(structure) {
  const results = [];
  const atoms = structure.atoms;
  const bonds = structure.bonds;

  for (let bondIdx = 0; bondIdx < bonds.length; bondIdx++) {
    const bond = bonds[bondIdx];
    if (bond.order < 2) continue;     // need a multiple bond to shift from

    // The two atoms flanking this multi-bond
    const [endA, endB] = [bond.i, bond.j];

    // Try shifting the pair toward each end
    for (const [shiftFromEnd, shiftToEnd] of [[endA, endB], [endB, endA]]) {
      // "shiftFromEnd" becomes an atom with fewer bonding electrons (gains LP)
      // "shiftToEnd"   becomes an atom with fewer electrons (loses LP to a new bond)
      //
      // For a valid push, shiftToEnd must have a neighbor (other than shiftFromEnd)
      // that currently has a lone pair AND a single-or-double bond to shiftToEnd.
      // That neighbor donates a lone pair to form a new (or additional) bond
      // with shiftToEnd, balancing the electrons that moved off shiftFromEnd.
      //
      // Visually (for NO3- going between resonance forms):
      //   O=N−O⁻  ↔  ⁻O−N=O
      //      double bond   lone pair becomes       lone pair       new double
      //      becomes LP    bond on other side      donates

      const donorCandidates = findDonorCandidates(structure, shiftToEnd, endA === shiftFromEnd ? endB : endA);

      for (const donor of donorCandidates) {
        const next = cloneStructure(structure);

        // 1. Reduce the multi-bond by one order, put a new lone pair on shiftFromEnd
        const newBond1 = next.bonds[bondIdx];
        newBond1.order -= 1;
        next.atoms[shiftFromEnd].lonePairs += 1;

        // 2. Take a lone pair from the donor, convert one of the donor-shiftToEnd
        //    bonds into a higher-order bond
        next.atoms[donor.atomIdx].lonePairs -= 1;
        const donorBond = next.bonds[donor.bondIdx];
        donorBond.order += 1;

        // 3. If the multi-bond collapsed to order 0, we made an illegal move
        if (newBond1.order === 0) continue;

        // 4. Recompute formal charges and validate
        computeFormalChargesForClone(next);

        if (!isStructureValid(next)) continue;

        results.push(next);
      }
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Find donor atoms adjacent to `targetIdx` that could promote one of their
// bonds to `targetIdx` into a higher-order bond.
//
// excludeIdx = the atom on the OTHER side of the multi-bond we're shifting;
//              we can't re-enter through it.
// ─────────────────────────────────────────────────────────────────────────────
function findDonorCandidates(structure, targetIdx, excludeIdx) {
  const out = [];
  structure.bonds.forEach((b, idx) => {
    let donorIdx = null;
    if (b.i === targetIdx && b.j !== excludeIdx) donorIdx = b.j;
    else if (b.j === targetIdx && b.i !== excludeIdx) donorIdx = b.i;
    if (donorIdx === null) return;
    if (b.order >= 3) return;                              // can't exceed triple
    const donor = structure.atoms[donorIdx];
    if (donor.lonePairs < 1) return;                       // needs a LP to donate
    if (donor.symbol === 'H') return;                      // H is never a donor
    out.push({ atomIdx: donorIdx, bondIdx: idx });
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validate: octets met (or expanded octet allowance respected).
// Matches the same logic the main lewis-engine uses at the end of its build.
// ─────────────────────────────────────────────────────────────────────────────
function isStructureValid(structure) {
  for (const a of structure.atoms) {
    let bondElectrons = 0;
    for (const b of structure.bonds) {
      if (b.i === a.index || b.j === a.index) bondElectrons += 2 * b.order;
    }
    const total  = bondElectrons + a.lonePairs * 2;
    const target = octetTargetOf(a.symbol);
    if (total < target) return false;
    if (total > target && !canExpandOctet(a.symbol)) return false;
    if (a.lonePairs < 0) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep clone of a structure so we can mutate safely.
// Preserves NASB metadata and central-atom info (same across all resonance
// forms) so breakdown output stays coherent.
// ─────────────────────────────────────────────────────────────────────────────
function cloneStructure(s) {
  return {
    ok: true,
    atoms: s.atoms.map(a => ({ ...a })),
    bonds: s.bonds.map(b => ({ ...b })),
    overallCharge: s.overallCharge,
    isIon: s.isIon,
    nasb: s.nasb,                               // shared (same math for all forms)
    centralAtomChoice: s.centralAtomChoice,
    validationNotes: s.validationNotes.slice(),
    octetMetOnAllAtoms: s.octetMetOnAllAtoms,
    isPrebuilt: s.isPrebuilt || false,          // preserve curated-structure flag
    isMultiCenter: s.isMultiCenter || false     // preserve multi-center flag
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recompute formal charges on a cloned structure using the Phase-2 helper.
// ─────────────────────────────────────────────────────────────────────────────
function computeFormalChargesForClone(structure) {
  for (const a of structure.atoms) {
    let bondOrderSum = 0;
    for (const b of structure.bonds) {
      if (b.i === a.index || b.j === a.index) bondOrderSum += b.order;
    }
    a.formalCharge = calculateFCFromCounts(a.symbol, a.lonePairs, bondOrderSum);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical key: deterministic string that identifies the structure's
// electron distribution, independent of atom order. Two structures with the
// same key are chemically identical — just different arrangements of atoms
// we happen to label differently.
//
// For picking resonance uniqueness we want to treat atom IDENTITIES as
// distinct (so NO3⁻'s three structures are considered separate), but still
// deduplicate true mirror-images produced by the shift algorithm.
//
// Compromise: key = sorted list of (atomIndex, lonePairs, formalCharge) +
//             sorted list of (min(i,j), max(i,j), order).
// This keeps each placement of a multi-bond distinct (so the 3 NO3⁻ forms
// remain separate), while still catching the rare case of the algorithm
// re-deriving the same structure it just came from.
// ─────────────────────────────────────────────────────────────────────────────
function canonicalKey(structure) {
  const atomPart = structure.atoms
    .slice()
    .sort((a,b) => a.index - b.index)
    .map(a => `${a.index}:${a.lonePairs}:${a.formalCharge}`)
    .join('|');
  const bondPart = structure.bonds
    .map(b => {
      const lo = Math.min(b.i, b.j), hi = Math.max(b.i, b.j);
      return `${lo}-${hi}:${b.order}`;
    })
    .sort()
    .join('|');
  return atomPart + '#' + bondPart;
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply Chris's picking criteria in order.
// Returns { bestIndices: [int], notes: [String] }.
// ─────────────────────────────────────────────────────────────────────────────
function pickBestStructure(structures) {
  const notes = [];

  // Criterion 1: all atoms' octets met. Already enforced during generation,
  // but we still filter here to be safe.
  const validIdx = structures
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.octetMetOnAllAtoms !== false && isStructureValid(s))
    .map(({ i }) => i);

  if (validIdx.length === 0) {
    notes.push('No structures pass the octet check.');
    return { bestIndices: [0], notes };
  }
  notes.push(`All ${validIdx.length} structure${validIdx.length===1?'':'s'} satisfy every atom's octet.`);

  // Criterion 2: minimize Σ|FC|
  const fcTotals = validIdx.map(i => sumAbsoluteFormalCharges(structures[i].atoms));
  const minFC    = Math.min(...fcTotals);
  notes.push(`Total |formal charge| per structure: [${fcTotals.join(', ')}]. Minimum = ${minFC}.`);

  const afterFC = validIdx.filter((_, k) => fcTotals[k] === minFC);

  if (afterFC.length === 1) {
    notes.push(`Criterion 2 decides: structure #${afterFC[0] + 1} has the lowest total |formal charge|.`);
    return { bestIndices: afterFC, notes };
  }

  notes.push(`${afterFC.length} structures tied on total |formal charge|. Applying criterion 3.`);

  // Criterion 3: EN-weighted FC score (lower = better)
  const enScores = afterFC.map(i => electronegativityWeightedFCScore(structures[i].atoms));
  const minEN    = Math.min(...enScores);
  const EPS      = 1e-6;
  const afterEN  = afterFC.filter((_, k) => Math.abs(enScores[k] - minEN) < EPS);

  if (afterEN.length === 1) {
    notes.push(
      `EN-weighted FC scores: [${enScores.map(s=>s.toFixed(2)).join(', ')}]. ` +
      `Structure #${afterEN[0] + 1} wins — negative formal charge sits on the ` +
      `more-electronegative atom.`
    );
  } else {
    notes.push(
      `All ${afterEN.length} remaining structures tie on EN-weighted FC (score = ${minEN.toFixed(2)}). ` +
      `They are equivalent resonance forms.`
    );
  }
  return { bestIndices: afterEN, notes };
}
