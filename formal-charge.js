// formal-charge.js
// ─────────────────────────────────────────────────────────────────────────────
// Standalone formal-charge module — consumed by the Lewis engine,
// resonance engine, and breakdown renderer.
//
// Uses Chris's exact teaching formula:
//
//     F.C. = (valence e⁻ of element)
//          − (lone-pair electrons around the atom)
//          − (bonding electrons / 2)
//
// where:
//   "lone-pair electrons"  = total non-bonding electrons sitting on the atom
//                            (e.g. 2 lone pairs = 4 electrons)
//   "bonding electrons"    = total electrons the atom is sharing
//                            (a single bond = 2, double = 4, triple = 6)
//
// The formula is mathematically equivalent to (valence) − (lone pairs count
// × 2) − (bond order sum), but we accept the inputs in the form students
// actually use when grading their own work.
// ─────────────────────────────────────────────────────────────────────────────

// Calculate the formal charge on a single atom.
//
//   atomSymbol        — element symbol, e.g. 'N'
//   lonePairElectrons — total non-bonding electrons on the atom (0, 2, 4, 6, 8)
//   bondingElectrons  — total bonding electrons around the atom
//                       (single=2, double=4, triple=6, per bond; sum all bonds)
//
// Returns a signed integer, or null if the symbol is unknown.
function calculateFC(atomSymbol, lonePairElectrons, bondingElectrons) {
  const el = getElement(atomSymbol);
  if (!el) return null;

  const lone = Number(lonePairElectrons) || 0;
  const bond = Number(bondingElectrons)  || 0;

  return el.valence - lone - (bond / 2);
}

// Convenience wrapper: accept lone-pair COUNT and bond-ORDER SUM instead of
// electron counts. Both Lewis-engine pathways end up calling one of these two.
//
//   lonePairCount — number of lone pairs (each = 2 e⁻)
//   bondOrderSum  — sum of bond orders for all bonds on the atom
//                   (e.g. 1 double + 2 singles → 2 + 1 + 1 = 4)
function calculateFCFromCounts(atomSymbol, lonePairCount, bondOrderSum) {
  return calculateFC(
    atomSymbol,
    (Number(lonePairCount) || 0) * 2,
    (Number(bondOrderSum)  || 0) * 2
  );
}

// Format a formal charge for display.
//   0    → '' (empty — don't show)
//  +1    → '+1'
//  −1    → '−1'    (uses real minus sign U+2212)
//  +2    → '+2'
function formalChargeString(fc) {
  if (fc === 0 || fc === null || fc === undefined || isNaN(fc)) return '';
  const mag  = Math.abs(fc);
  const sign = fc > 0 ? '+' : '−';
  return sign + mag;
}

// Sum |F.C.| across a list of atoms. Used by the resonance "best structure"
// picker (criterion #2: lowest total formal-charge magnitude wins).
function sumAbsoluteFormalCharges(atomsWithFC) {
  if (!Array.isArray(atomsWithFC)) return 0;
  return atomsWithFC.reduce(
    (sum, a) => sum + Math.abs(Number(a.formalCharge) || 0),
    0
  );
}

// Electronegativity-weighted F.C. score. Used by the resonance picker
// tiebreaker (criterion #3: negative F.C. belongs on the MORE electronegative
// atom, positive F.C. on the LESS electronegative atom).
//
// Score = Σ (F.C. × EN).  LOWER score is BETTER because:
//   − F.C. on high-EN atom  →  large negative contribution  →  lower total
//   + F.C. on low-EN atom   →  small positive contribution  →  lower total
//
// When two structures tie on criterion #2, the one with the lower (more
// negative) EN-weighted score wins.
function electronegativityWeightedFCScore(atomsWithFC) {
  if (!Array.isArray(atomsWithFC)) return 0;
  let score = 0;
  for (const a of atomsWithFC) {
    const en = electronegativityOf(a.symbol);
    const fc = Number(a.formalCharge) || 0;
    if (en === null || en === undefined) continue;
    score += fc * en;
  }
  return score;
}
