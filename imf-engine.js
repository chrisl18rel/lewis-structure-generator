// imf-engine.js
// ─────────────────────────────────────────────────────────────────────────────
// Classifies intermolecular forces using Chris's three-tier rule:
//
//   1) London forces (Van der Waals / London Dispersion)
//        — EVERY covalent molecule has these
//        — the only IMF in nonpolar covalent molecules
//        — weakest
//   2) Dipole-dipole forces
//        — ALL polar covalent molecules (in addition to London)
//        — second weakest
//   3) Hydrogen bonding
//        — polar covalent molecules where H is bonded directly to N, O, or F
//        — strongest
//
// Input:  (parse, structure, polarity)
//         polarity is the result from classifyPolarity (polarity-engine.js)
// Output: {
//   ok:          Boolean,
//   applicable:  Boolean,         // false for ionic / single atoms
//   imfs:        [String, ...],   // IMF names, weakest→strongest
//   isPolar:     Boolean,
//   hasHBondable:Boolean,         // H bonded to N/O/F anywhere
//   reasoning:   [String, ...],   // one per IMF included
//   note:        String           // context message (e.g. ionic skipped)
// }
// ─────────────────────────────────────────────────────────────────────────────

function classifyIMF(parse, structure, polarity) {
  // Ionic compounds don't have IMF — they have lattice ionic bonding
  if (!parse || parse.type !== 'covalent') {
    return {
      ok: true, applicable: false,
      imfs: [], isPolar: false, hasHBondable: false,
      reasoning: [],
      note: 'Intermolecular forces do not apply to ionic compounds; ' +
            'ionic attractions within the lattice are the primary force ' +
            'holding the compound together.'
    };
  }
  if (!structure || !structure.ok) {
    return {
      ok: false, applicable: false,
      imfs: [], isPolar: false, hasHBondable: false,
      reasoning: [], note: 'No valid structure supplied.'
    };
  }
  if (structure.atoms.length < 2) {
    return {
      ok: true, applicable: false,
      imfs: [], isPolar: false, hasHBondable: false,
      reasoning: [],
      note: 'A single atom has no intermolecular forces to classify.'
    };
  }

  const isPolar      = !!(polarity && polarity.isPolar);
  const hasHBondable = hasHydrogenBondedToNOF(structure);

  const imfs      = [];
  const reasoning = [];

  // 1. London forces — always
  imfs.push('London forces');
  reasoning.push(
    'London forces (Van der Waals / London Dispersion): every covalent ' +
    'molecule exhibits London forces. They arise from temporary electron ' +
    'movement and are the weakest intermolecular force.'
  );

  // 2. Dipole-dipole — if polar
  if (isPolar) {
    imfs.push('Dipole-dipole forces');
    reasoning.push(
      'Dipole-dipole forces: the molecule is polar, so it acts as a little ' +
      'magnet with a positive end and a negative end. All polar covalent ' +
      'molecules exhibit dipole-dipole forces. Second-weakest IMF.'
    );
  }

  // 3. Hydrogen bonding — if polar AND H bonded to N/O/F
  if (isPolar && hasHBondable) {
    imfs.push('Hydrogen bonding');
    reasoning.push(
      'Hydrogen bonding: the molecule is polar AND contains an H atom ' +
      'bonded directly to N, O, or F. Hydrogen bonding is the strongest ' +
      'intermolecular force.'
    );
  }

  return {
    ok: true,
    applicable: true,
    imfs,
    isPolar,
    hasHBondable,
    reasoning,
    note: ''
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// True if any H atom in the structure is directly bonded to N, O, or F.
// ─────────────────────────────────────────────────────────────────────────────
function hasHydrogenBondedToNOF(structure) {
  for (const b of structure.bonds) {
    const a1 = structure.atoms[b.i];
    const a2 = structure.atoms[b.j];
    const pair = [a1.symbol, a2.symbol];
    const hasH   = pair.includes('H');
    const hasNOF = pair.includes('N') || pair.includes('O') || pair.includes('F');
    if (hasH && hasNOF) return true;
  }
  return false;
}
