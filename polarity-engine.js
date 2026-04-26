// polarity-engine.js
// ─────────────────────────────────────────────────────────────────────────────
// Walks Chris's polarity flowchart (notes image 13) step-by-step and records
// every branch taken. The breakdown renderer shows the reasoning so students
// can see HOW the answer was reached, not just WHAT it was.
//
// Flowchart (encoded as a decision tree):
//
//   START ─→ Does the molecule contain any polar covalent bonds?
//            (0.41 ≤ ΔEN ≤ 1.67 per the EN chart)
//              │
//              ├─ NO  → NOT POLAR (stop)
//              └─ YES → Are atoms symmetrically distributed around the molecule?
//                      Symmetric shapes: Trigonal Planar, Tetrahedral,
//                                        Linear (triatomic+),
//                                        Trigonal Bipyramidal, Octahedral,
//                                        Square Planar
//                        │
//                        ├─ NO  → POLAR (bond dipoles can't cancel)
//                        └─ YES → Are ALL outside atoms the same?
//                                  │
//                                  ├─ YES → NOT POLAR (dipoles cancel)
//                                  └─ NO  → POLAR
//
//   Diatomic special case:
//     polar if the single bond is polar (0.41 ≤ ΔEN ≤ 1.67), else not polar.
//
// Polar-covalent range constants (from Chris's EN chart):
//     ΔEN < 0.41              → nonpolar covalent
//     0.41 ≤ ΔEN ≤ 1.67       → polar covalent
//     ΔEN > 1.67              → ionic range
// ─────────────────────────────────────────────────────────────────────────────

const POLARITY_NONPOLAR_MAX = 0.41;
const POLARITY_IONIC_MIN    = 1.67;

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point.
// Input:  structure (covalent), vsepr (classification result)
// Output: {
//   ok: true,
//   applicable: Boolean,       // false for ionic / single atom
//   isPolar: Boolean,
//   reasoning: [String, ...],  // one line per flowchart step
//   stopReason: String,        // short summary of WHY it stopped where it did
//   maxDEN: Number,            // largest ΔEN observed (for display)
//   hasPolarBond: Boolean,
//   symmetricShape: Boolean,
//   allTerminalsSame: Boolean
// }
// ─────────────────────────────────────────────────────────────────────────────
function classifyPolarity(structure, vsepr) {
  // ── Guards ────────────────────────────────────────────────────────
  if (!structure || !structure.ok) {
    return {
      ok: false, applicable: false, isPolar: false,
      reasoning: [], stopReason: 'No valid structure.'
    };
  }
  if (structure.atoms.length < 2) {
    return {
      ok: true, applicable: false, isPolar: false,
      reasoning: ['A single atom does not have molecular polarity.'],
      stopReason: 'Single atom.'
    };
  }

  // ── Chain path: walk the flowchart per-bond, with symmetry inferred from
  // the chain's composition rather than a single-central-atom shape look-up.
  if (structure.isChain) {
    return classifyPolarityChain(structure);
  }

  // ── Ring path: similar to chains, all-C rings (cycloalkanes,
  // cycloalkenes, benzene) in R5 scope are pure hydrocarbons → nonpolar.
  if (structure.isRing) {
    return classifyPolarityRing(structure);
  }

  // ── Diatomic special case ─────────────────────────────────────────
  if (structure.atoms.length === 2) {
    const a = structure.atoms[0], b = structure.atoms[1];
    const ea = electronegativityOf(a.symbol) ?? 0;
    const eb = electronegativityOf(b.symbol) ?? 0;
    const dEN = Math.abs(ea - eb);
    const reasoning = [];
    reasoning.push(
      `This is a diatomic molecule. Molecular polarity reduces to bond polarity.`
    );
    reasoning.push(
      `ΔEN = |${ea.toFixed(2)} − ${eb.toFixed(2)}| = ${dEN.toFixed(2)}.`
    );

    let isPolar, stop;
    if (dEN < POLARITY_NONPOLAR_MAX) {
      reasoning.push(
        `ΔEN < ${POLARITY_NONPOLAR_MAX} → nonpolar covalent bond → ` +
        `molecule is NOT polar.`
      );
      isPolar = false;
      stop    = 'Nonpolar diatomic — ΔEN below the polar-covalent threshold.';
    } else if (dEN > POLARITY_IONIC_MIN) {
      reasoning.push(
        `ΔEN > ${POLARITY_IONIC_MIN} → ionic range. ` +
        `For IMF/polarity purposes, this species is treated as polar.`
      );
      isPolar = true;
      stop    = 'ΔEN above ionic threshold — treated as polar.';
    } else {
      reasoning.push(
        `${POLARITY_NONPOLAR_MAX} ≤ ΔEN ≤ ${POLARITY_IONIC_MIN} → ` +
        `polar covalent bond → molecule is POLAR.`
      );
      isPolar = true;
      stop    = 'Polar diatomic — bond is in the polar covalent range.';
    }
    return {
      ok: true, applicable: true, isPolar, reasoning,
      stopReason: stop,
      maxDEN: dEN,
      hasPolarBond: isPolar,
      symmetricShape: true,
      allTerminalsSame: true
    };
  }

  // ── Step 1: any polar bonds? ──────────────────────────────────────
  const reasoning = [];
  let maxDEN = 0;
  let maxPair = null;
  for (const b of structure.bonds) {
    const a1 = structure.atoms[b.i], a2 = structure.atoms[b.j];
    const e1 = electronegativityOf(a1.symbol) ?? 0;
    const e2 = electronegativityOf(a2.symbol) ?? 0;
    const d  = Math.abs(e1 - e2);
    if (d > maxDEN) { maxDEN = d; maxPair = `${a1.symbol}–${a2.symbol}`; }
  }
  const hasPolarBond = maxDEN >= POLARITY_NONPOLAR_MAX;

  reasoning.push(
    `Step 1 — Does the molecule contain any polar covalent bonds?`
  );
  if (maxPair !== null) {
    reasoning.push(
      `Largest ΔEN in the molecule: ${maxPair} bond with ΔEN = ${maxDEN.toFixed(2)}. ` +
      (hasPolarBond
        ? `This falls at or above the ${POLARITY_NONPOLAR_MAX} polar-covalent threshold.`
        : `This is below the ${POLARITY_NONPOLAR_MAX} polar-covalent threshold.`)
    );
  }

  if (!hasPolarBond) {
    reasoning.push('Answer: NO polar bonds → molecule is NOT polar. Stop.');
    return {
      ok: true, applicable: true, isPolar: false, reasoning,
      stopReason: 'No polar bonds.',
      maxDEN, hasPolarBond: false,
      symmetricShape: null, allTerminalsSame: null
    };
  }
  reasoning.push('Answer: YES → continue to Step 2.');

  // ── Step 2: symmetric shape? ──────────────────────────────────────
  reasoning.push(`Step 2 — Are atoms symmetrically distributed around the molecule?`);
  if (!vsepr || !vsepr.ok || !vsepr.applicable) {
    reasoning.push(
      `Shape information is unavailable. Because the molecule has polar ` +
      `bonds, we default to POLAR.`
    );
    return {
      ok: true, applicable: true, isPolar: true, reasoning,
      stopReason: 'Polar bonds + shape unknown.',
      maxDEN, hasPolarBond: true,
      symmetricShape: null, allTerminalsSame: null
    };
  }

  const symmetric = isShapeSymmetric(vsepr.shape);
  reasoning.push(
    `Shape is ${vsepr.shape}, which is ` +
    `${symmetric ? 'SYMMETRICAL' : 'NOT symmetrical'}.`
  );

  if (!symmetric) {
    reasoning.push(
      `Answer: NO → bond dipoles cannot cancel → molecule is POLAR. Stop.`
    );
    return {
      ok: true, applicable: true, isPolar: true, reasoning,
      stopReason: 'Polar bonds + asymmetric shape.',
      maxDEN, hasPolarBond: true,
      symmetricShape: false, allTerminalsSame: null
    };
  }

  reasoning.push('Answer: YES → continue to Step 3.');

  // ── Step 3: all outside atoms the same? ───────────────────────────
  reasoning.push(`Step 3 — Are ALL outside atoms the same?`);
  const centralAtom = structure.atoms.find(a => a.isCentral);
  const outsideSyms = new Set();
  for (const b of structure.bonds) {
    if (b.i === centralAtom.index)      outsideSyms.add(structure.atoms[b.j].symbol);
    else if (b.j === centralAtom.index) outsideSyms.add(structure.atoms[b.i].symbol);
  }
  const allSame = outsideSyms.size === 1;
  reasoning.push(
    `Outside atoms: ${[...outsideSyms].join(', ')}. ` +
    `All the same? ${allSame ? 'YES' : 'NO'}.`
  );

  if (allSame) {
    reasoning.push(
      `Answer: YES → symmetric shape + identical outside atoms means ` +
      `bond dipoles cancel → molecule is NOT polar.`
    );
    return {
      ok: true, applicable: true, isPolar: false, reasoning,
      stopReason: 'Symmetric shape with identical outside atoms — dipoles cancel.',
      maxDEN, hasPolarBond: true,
      symmetricShape: true, allTerminalsSame: true
    };
  }

  reasoning.push(
    `Answer: NO → outside atoms differ, so bond dipoles don't fully cancel ` +
    `→ molecule is POLAR.`
  );
  return {
    ok: true, applicable: true, isPolar: true, reasoning,
    stopReason: 'Symmetric shape but mixed outside atoms.',
    maxDEN, hasPolarBond: true,
    symmetricShape: true, allTerminalsSame: false
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Polarity for carbon chains.
//
// R3a scope: pure hydrocarbons only (C and H). The only bond types are
// C-C (ΔEN = 0) and C-H (ΔEN = 0.35). Both are below the 0.41 polar-
// covalent threshold, so the molecule is nonpolar by the "no polar
// bonds" rule of the flowchart.
//
// When R4 brings functional groups (C-O, C-N, C-X halogens, etc.), we'll
// need to add symmetry analysis here. For now the rule is simple:
//   Pure hydrocarbon chain → nonpolar, stop at Step 1.
// ─────────────────────────────────────────────────────────────────────────────
function classifyPolarityChain(structure) {
  const reasoning = [];
  let maxDEN  = 0;
  let maxPair = null;
  for (const b of structure.bonds) {
    const a1 = structure.atoms[b.i], a2 = structure.atoms[b.j];
    const e1 = electronegativityOf(a1.symbol) ?? 0;
    const e2 = electronegativityOf(a2.symbol) ?? 0;
    const d  = Math.abs(e1 - e2);
    if (d > maxDEN) { maxDEN = d; maxPair = `${a1.symbol}–${a2.symbol}`; }
  }
  const hasPolarBond = maxDEN >= POLARITY_NONPOLAR_MAX;

  reasoning.push(`This is a carbon chain molecule. Polarity is determined by the bonds present.`);
  reasoning.push(`Step 1 — Does the molecule contain any polar covalent bonds?`);
  if (maxPair !== null) {
    reasoning.push(
      `Largest ΔEN in the chain: ${maxPair} bond with ΔEN = ${maxDEN.toFixed(2)}. ` +
      (hasPolarBond
        ? `This meets or exceeds the ${POLARITY_NONPOLAR_MAX} polar-covalent threshold.`
        : `This is below the ${POLARITY_NONPOLAR_MAX} polar-covalent threshold.`)
    );
  }

  if (!hasPolarBond) {
    reasoning.push(`Answer: NO polar bonds → molecule is NOT polar. Stop.`);
    return {
      ok: true, applicable: true, isPolar: false, reasoning,
      stopReason: 'Pure hydrocarbon chain — no polar bonds.',
      maxDEN, hasPolarBond: false,
      symmetricShape: null, allTerminalsSame: null,
      isChain: true
    };
  }

  reasoning.push(`Answer: YES → at least one polar bond in the chain.`);
  reasoning.push(`Step 2 — Check for symmetric substitution patterns that might cancel the dipoles.`);

  // ── R4a Rule: identical halogen substituents on a single sp³ carbon ───
  // If the entire molecule is one carbon with 4 identical halogen substituents
  // (CCl4, CF4, CBr4, CI4), the tetrahedral symmetry perfectly cancels the
  // bond dipoles → nonpolar.
  const tetrahalidePattern = _chainIsTetrahalide(structure);
  if (tetrahalidePattern) {
    reasoning.push(
      `Pattern match: single carbon with 4 identical ${tetrahalidePattern} atoms ` +
      `in tetrahedral arrangement. The four C–${tetrahalidePattern} bond dipoles ` +
      `point outward at 109.5° and cancel perfectly by symmetry.`
    );
    reasoning.push(`Answer: molecule is NOT polar. Stop.`);
    return {
      ok: true, applicable: true, isPolar: false, reasoning,
      stopReason: `Tetrahedral ${tetrahalidePattern}₄ — symmetric dipole cancellation.`,
      maxDEN, hasPolarBond: true,
      symmetricShape: true, allTerminalsSame: true,
      isChain: true
    };
  }

  // ── Default: any other chain with polar bonds is polar ─────────────────
  // This covers the vast majority of HS-chemistry cases:
  //   - Monosubstituted chains (CH3OH, CH3Cl, CH3NH2) — clearly polar
  //   - Multi-substituted but not fully symmetric (CH2Cl2, CHCl3, CHFCl2)
  //   - Dihalides across a chain (ClCH2CH2Cl) — typically polar in practice
  //
  // The only "symmetric enough to be nonpolar" pattern we handle explicitly
  // is full halogen substitution on a single carbon (above). Other
  // symmetric cases (trans-1,2-dichloroethylene, para-disubstituted rings)
  // require stereochemistry or ring geometry beyond R4a scope.
  reasoning.push(
    `No symmetric cancellation pattern matches. Polar bonds present ` +
    `without full tetrahedral symmetry → molecule is POLAR.`
  );
  return {
    ok: true, applicable: true, isPolar: true, reasoning,
    stopReason: 'Polar bonds present, no symmetric cancellation.',
    maxDEN, hasPolarBond: true,
    symmetricShape: false, allTerminalsSame: null,
    isChain: true
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern detector: is this structure exactly one carbon with four identical
// halogen substituents? (CCl4, CF4, CBr4, CI4)
// Returns the halogen symbol if matched, null otherwise.
// ─────────────────────────────────────────────────────────────────────────────
function _chainIsTetrahalide(structure) {
  const carbons = structure.atoms.filter(a => a.symbol === 'C');
  if (carbons.length !== 1) return null;
  const c = carbons[0];

  // Collect atoms directly bonded to this single carbon
  const bondedAtoms = [];
  for (const b of structure.bonds) {
    if (b.i === c.index) bondedAtoms.push(structure.atoms[b.j]);
    else if (b.j === c.index) bondedAtoms.push(structure.atoms[b.i]);
  }
  if (bondedAtoms.length !== 4) return null;

  // All 4 must be the same halogen
  const HALOGENS = ['F', 'Cl', 'Br', 'I'];
  const first = bondedAtoms[0].symbol;
  if (!HALOGENS.includes(first)) return null;
  if (!bondedAtoms.every(a => a.symbol === first)) return null;
  return first;
}

// ─────────────────────────────────────────────────────────────────────────────
// Polarity for ring molecules. For R5 scope (cycloalkanes, cycloalkenes,
// benzene), all supported rings are pure hydrocarbons, so they're all
// nonpolar. If R6 adds substituents (phenol, aniline), this function would
// need to check for polar substituents like chainPolarity does.
// ─────────────────────────────────────────────────────────────────────────────
function classifyPolarityRing(structure) {
  const reasoning = [];
  const displayName = (structure.ringMeta && structure.ringMeta.displayName) || 'ring';

  // Check if any bond has a significant ΔEN (any polar bonds present?)
  let maxDEN = 0;
  let maxPair = null;
  for (const b of structure.bonds) {
    const a1 = structure.atoms[b.i], a2 = structure.atoms[b.j];
    const e1 = electronegativityOf(a1.symbol) ?? 0;
    const e2 = electronegativityOf(a2.symbol) ?? 0;
    const d  = Math.abs(e1 - e2);
    if (d > maxDEN) { maxDEN = d; maxPair = `${a1.symbol}–${a2.symbol}`; }
  }
  const hasPolarBond = maxDEN >= POLARITY_NONPOLAR_MAX;

  reasoning.push(`This is a ${displayName} ring molecule.`);
  reasoning.push(`Step 1 — Does the molecule contain any polar covalent bonds?`);
  if (maxPair) {
    reasoning.push(
      `Largest ΔEN in the ring: ${maxPair} bond with ΔEN = ${maxDEN.toFixed(2)}. ` +
      (hasPolarBond
        ? `This meets or exceeds the ${POLARITY_NONPOLAR_MAX} polar-covalent threshold.`
        : `This is below the ${POLARITY_NONPOLAR_MAX} polar-covalent threshold.`)
    );
  }

  if (!hasPolarBond) {
    reasoning.push(`Answer: NO polar bonds → molecule is NOT polar.`);
    // Heterocycle without detectable polar bonds (thiophene is the main case)
    if (structure.ringMeta && structure.ringMeta.isHeterocycle) {
      const heteroSyms = structure.ringMeta.heteroAtomSymbols || [];
      if (heteroSyms.includes('S')) {
        reasoning.push(
          `Thiophene's C–S bond has a very small ΔEN (~0.03), below the ` +
          `polar-covalent threshold, so the flowchart classifies thiophene ` +
          `as nonpolar.`
        );
        reasoning.push(
          `Note: in reality, thiophene has a small dipole moment (~0.52 D) ` +
          `because the sulfur's in-plane lone pair creates an electronic ` +
          `asymmetry that bond-ΔEN alone doesn't capture. For HS-level ` +
          `polar-bond analysis, we treat it as nonpolar.`
        );
      } else {
        reasoning.push(
          `The ring's bonds all have ΔEN below the polar-covalent threshold, ` +
          `so the molecule is nonpolar overall.`
        );
      }
    } else if (structure.isAromatic) {
      reasoning.push(
        `Benzene (C₆H₆) is a classic nonpolar aromatic molecule. Its six C–H ` +
        `bonds are essentially nonpolar, and the ring's symmetry means any ` +
        `small dipoles cancel.`
      );
    } else {
      reasoning.push(
        `Cycloalkanes and cycloalkenes are pure hydrocarbons — their C–C and ` +
        `C–H bonds are nonpolar, so the molecule is nonpolar overall.`
      );
    }
    return {
      ok: true, applicable: true, isPolar: false, reasoning,
      stopReason: 'Ring with no polar bonds → nonpolar.',
      maxDEN, hasPolarBond: false,
      symmetricShape: true, allTerminalsSame: true,
      isRing: true
    };
  }

  // ── Sugar analysis (R6d) ────────────────────────────────────────
  //   Sugars like glucose have a ring O plus multiple -OH groups. The
  //   ring O and every C-OH pair contribute polar bonds. Even if the
  //   molecule looks "symmetric" in some abstract sense, the many
  //   -OH groups guarantee a large net dipole — glucose is strongly
  //   polar and forms many hydrogen bonds.
  if (structure.ringMeta && structure.ringMeta.isSugar) {
    return _classifySugarPolarity(structure, reasoning, maxDEN);
  }

  // ── Heterocycle with polar bonds (R6c) ─────────────────────────────
  //   Pyridine, pyrrole, furan — the heteroatom itself is the source
  //   of asymmetry (no substituent needed). Always polar.
  if (structure.ringMeta && structure.ringMeta.isHeterocycle) {
    return _classifyHeterocyclePolarity(structure, reasoning, maxDEN);
  }

  // ── Substituted ring analysis (R6a+) ───────────────────────────────
  // The ring has one or more polar substituents. For R6a (monosubstituted
  // benzene), the single substituent creates an asymmetric dipole — the
  // molecule is polar. For multi-substituted rings (R6b+), symmetry can
  // cancel dipoles (e.g., p-dichlorobenzene is nonpolar because the two
  // C-Cl dipoles point in opposite directions).
  const substituents = (structure.ringMeta && structure.ringMeta.substituents) || [];

  // Monosubstituted: inherently asymmetric → polar
  if (substituents.length === 1) {
    const subLabel = substituents[0].label || substituents[0].kind;
    reasoning.push(
      `Answer: YES — polar bonds from the ${subLabel} substituent.`
    );
    reasoning.push(
      `Step 2 — Is the molecule symmetric?`
    );
    reasoning.push(
      `A monosubstituted benzene has one substituent and five H's on the ring. ` +
      `The substituent breaks the ring's symmetry, so the dipoles don't cancel. ` +
      `Answer: NO, not symmetric → molecule IS polar.`
    );
    return {
      ok: true, applicable: true, isPolar: true, reasoning,
      stopReason: 'Monosubstituted aromatic — asymmetric substituent makes it polar.',
      maxDEN, hasPolarBond: true,
      symmetricShape: false, allTerminalsSame: false,
      isRing: true
    };
  }

  // Disubstituted ring analysis (R6b)
  if (substituents.length === 2) {
    return _classifyDisubstitutedPolarity(substituents, reasoning, maxDEN);
  }

  // 3+ substituents — defer to later phase, assume polar
  if (substituents.length > 2) {
    reasoning.push(
      `Answer: YES — polar bonds from ${substituents.length} substituents.`
    );
    reasoning.push(
      `Symmetry analysis for 3+ substituents (tri-substituted rings) ` +
      `comes in a later phase. Defaulting to POLAR.`
    );
    return {
      ok: true, applicable: true, isPolar: true, reasoning,
      stopReason: 'Tri-substituted+ ring — symmetry analysis deferred.',
      maxDEN, hasPolarBond: true,
      symmetricShape: null, allTerminalsSame: null,
      isRing: true
    };
  }

  // Polar bond detected but no substituents recorded — shouldn't happen
  // for R6a scope; defensive fallback.
  reasoning.push(
    `Answer: YES — polar bonds detected, defaulting to POLAR.`
  );
  return {
    ok: true, applicable: true, isPolar: true, reasoning,
    stopReason: 'Polar bonds present with no substituent info.',
    maxDEN, hasPolarBond: true,
    symmetricShape: null, allTerminalsSame: null,
    isRing: true
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Disubstituted aromatic polarity analysis (R6b).
//
// Rules:
//   - Two IDENTICAL substituents in para (1,4) → dipoles cancel → NONPOLAR
//   - Two IDENTICAL substituents in ortho (1,2) or meta (1,3) → dipoles
//     don't cancel → POLAR
//   - Two DIFFERENT substituents → asymmetric → POLAR (at any position)
//
// Edge case: if both substituents are nonpolar (two methyls), the ring is
// nonpolar regardless of position — there are no dipoles to cancel.
// ─────────────────────────────────────────────────────────────────────────────
function _classifyDisubstitutedPolarity(substituents, reasoning, maxDEN) {
  const [s1, s2] = substituents;

  // Determine positional relationship from the ring positions
  const posDelta = Math.abs(s1.ringPos - s2.ringPos);
  const relation =
    posDelta === 1 || posDelta === 5 ? 'ortho' :
    posDelta === 2 || posDelta === 4 ? 'meta'  :
    posDelta === 3                   ? 'para'  :
    'unknown';

  const identical = (s1.kind === s2.kind);
  const subLabels = [s1.label || s1.kind, s2.label || s2.kind];

  reasoning.push(`Answer: YES — polar bonds from the substituents.`);
  reasoning.push(`Step 2 — Is the molecule symmetric?`);
  reasoning.push(
    `This is a disubstituted benzene with ${identical ? 'two identical' : 'two different'} ` +
    `substituents (${subLabels.join(', ')}) in the ${relation} (1,${posDelta === 3 ? '4' : posDelta + 1}) position.`
  );

  // Case 1: two methyls (or other purely-nonpolar substituents) — no dipoles
  if (s1.kind === 'methyl' && s2.kind === 'methyl') {
    reasoning.push(
      `Both substituents are methyl groups, which introduce only nonpolar ` +
      `C–C and C–H bonds. The molecule has no significant polar bonds, so it ` +
      `is NOT polar regardless of position.`
    );
    return {
      ok: true, applicable: true, isPolar: false, reasoning,
      stopReason: 'Dimethylbenzene — two nonpolar substituents → nonpolar molecule.',
      maxDEN, hasPolarBond: false,
      symmetricShape: true, allTerminalsSame: true,
      isRing: true
    };
  }

  // Case 2: identical polar substituents in para — dipoles cancel
  if (identical && relation === 'para') {
    reasoning.push(
      `The two ${subLabels[0]} groups are across the ring from each other (para). ` +
      `Their bond dipoles point in exactly opposite directions, so the dipoles CANCEL. ` +
      `Answer: YES, symmetric → molecule is NOT polar.`
    );
    return {
      ok: true, applicable: true, isPolar: false, reasoning,
      stopReason: 'para-disubstituted with identical substituents — dipoles cancel.',
      maxDEN, hasPolarBond: true,
      symmetricShape: true, allTerminalsSame: true,
      isRing: true
    };
  }

  // Case 3: identical polar substituents in ortho or meta — dipoles don't cancel
  if (identical && (relation === 'ortho' || relation === 'meta')) {
    const angleDesc = relation === 'ortho' ? '60°' : '120°';
    reasoning.push(
      `The two ${subLabels[0]} groups are at ${angleDesc} to each other (${relation}). ` +
      `Their bond dipoles partially add rather than cancel, leaving a net dipole. ` +
      `Answer: NO, not symmetric → molecule IS polar.`
    );
    return {
      ok: true, applicable: true, isPolar: true, reasoning,
      stopReason: `${relation}-disubstituted with identical substituents — dipoles don't cancel.`,
      maxDEN, hasPolarBond: true,
      symmetricShape: false, allTerminalsSame: true,
      isRing: true
    };
  }

  // Case 4: different substituents — always polar (can't cancel)
  if (!identical) {
    reasoning.push(
      `The two substituents are different (${subLabels.join(' and ')}), so their ` +
      `dipoles have different magnitudes. They cannot cancel regardless of position. ` +
      `Answer: NO, not symmetric → molecule IS polar.`
    );
    return {
      ok: true, applicable: true, isPolar: true, reasoning,
      stopReason: 'Disubstituted with different substituents — dipoles can\'t cancel.',
      maxDEN, hasPolarBond: true,
      symmetricShape: false, allTerminalsSame: false,
      isRing: true
    };
  }

  // Fallback — shouldn't reach here
  return {
    ok: true, applicable: true, isPolar: true, reasoning,
    stopReason: 'Disubstituted ring — defaulting to polar.',
    maxDEN, hasPolarBond: true,
    symmetricShape: null, allTerminalsSame: null,
    isRing: true
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Heterocycle polarity analysis (R6c).
//
// Pyridine, pyrrole, furan — all have a heteroatom in the ring that breaks
// the symmetry and creates a net dipole. These are always polar.
//
// (Thiophene's bonds don't meet the polar-covalent threshold, so it's
// handled by the earlier "no polar bonds" branch and never reaches here.)
// ─────────────────────────────────────────────────────────────────────────────
function _classifyHeterocyclePolarity(structure, reasoning, maxDEN) {
  const meta = structure.ringMeta || {};
  const displayName = meta.displayName || 'heterocycle';
  const heteroSyms = meta.heteroAtomSymbols || [];
  const heteroSym = heteroSyms[0] || 'heteroatom';

  reasoning.push(`Answer: YES — polar bonds involving the ${heteroSym} atom.`);
  reasoning.push(`Step 2 — Is the molecule symmetric?`);
  reasoning.push(
    `The ring contains a ${heteroSym} atom at one position, with C atoms at ` +
    `the others. The heteroatom has a different electronegativity than carbon, ` +
    `so the C–${heteroSym} bonds are polar and point inward toward the ` +
    `${heteroSym}. There's nothing on the opposite side to cancel this, so ` +
    `the molecule has a net dipole.`
  );
  reasoning.push(`Answer: NO, not symmetric → molecule IS polar.`);

  return {
    ok: true, applicable: true, isPolar: true, reasoning,
    stopReason: `${displayName} — heteroatom breaks ring symmetry.`,
    maxDEN, hasPolarBond: true,
    symmetricShape: false, allTerminalsSame: false,
    isRing: true
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sugar polarity analysis (R6d).
//
// Sugars like glucose have a ring O plus multiple -OH groups — so many polar
// bonds that there's no question of symmetric cancellation. Always polar.
// ─────────────────────────────────────────────────────────────────────────────
function _classifySugarPolarity(structure, reasoning, maxDEN) {
  const meta = structure.ringMeta || {};
  const displayName = meta.displayName || 'sugar';
  const substituents = meta.substituents || [];
  const ohCount = substituents.filter(s => s.kind === 'hydroxyl').length;
  const ch2ohCount = substituents.filter(s => s.kind === 'hydroxymethyl').length;
  const totalOhGroups = ohCount + ch2ohCount;

  reasoning.push(
    `Answer: YES — polar bonds in the ring O and in ${totalOhGroups} ` +
    `${totalOhGroups === 1 ? 'hydroxyl group' : 'hydroxyl groups'} around the ring.`
  );
  reasoning.push(`Step 2 — Is the molecule symmetric?`);
  reasoning.push(
    `${displayName} has a ring oxygen plus multiple -OH groups on the ring ` +
    `carbons. These polar C–O and O–H bonds point in many different directions ` +
    `and can't cancel out — the molecule has a large net dipole.`
  );
  reasoning.push(`Answer: NO, not symmetric → molecule IS polar.`);
  reasoning.push(
    `With ${totalOhGroups} -OH groups, ${displayName} also forms extensive ` +
    `hydrogen bonds, which is why it dissolves so readily in water.`
  );

  return {
    ok: true, applicable: true, isPolar: true, reasoning,
    stopReason: `${displayName} — multiple -OH groups make it strongly polar.`,
    maxDEN, hasPolarBond: true,
    symmetricShape: false, allTerminalsSame: false,
    isRing: true
  };
}
