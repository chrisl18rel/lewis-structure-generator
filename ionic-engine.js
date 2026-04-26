// ionic-engine.js
// ─────────────────────────────────────────────────────────────────────────────
// Ionic-compound Lewis-structure builder.
//
// Follows Chris's teaching procedure (notes images 1–2):
//   1. Write each element's atomic symbol on the page
//   2. Place valence electrons around each atom — one dot on each side (N,E,S,W)
//      BEFORE pairing up. This is the "correct ✓ vs wrong ✗" rule from the
//      Nitrogen example.
//   3. The more-electronegative atom "steals" electrons from the less-
//      electronegative atom until the nonmetal reaches its octet (or duet).
//   4. Put brackets around each ion.
//   5. Show the charge on each ion's top-right corner outside the brackets.
//
// Scope: binary ionic compounds (metal + nonmetal). Multiple metal atoms
// and/or multiple nonmetal atoms are handled by repeating the electron-
// transfer per ion.
//
// Input:  parsed-formula object from formula-parser.js with type='ionic'
// Output:
//   {
//     ok: true,
//     ions: [{ symbol, x, y, lonePairs, charge, isAnion, dotArrangement:[sides] }],
//     chargeBalance: { cationTotal, anionTotal, balanced:Boolean },
//     transferNotes: [String],    // per-electron-transfer reasoning
//     validationNotes: [String]
//   }
// ─────────────────────────────────────────────────────────────────────────────

function buildIonicStructure(parsed) {
  if (!parsed || !parsed.ok) return { ok:false, error:'Invalid parse input.' };
  if (parsed.type !== 'ionic') {
    return { ok:false, error:'ionic-engine only handles ionic compounds. Use lewis-engine for covalent.' };
  }

  // Branch on whether any polyatomic ions are present in the units array.
  // When at least one unit is a recognized polyatomic ion, we build via the
  // polyatomic pathway (which uses the covalent Lewis engine to structure
  // each polyatomic ion internally). Otherwise, fall through to the classic
  // binary-ionic pathway below.
  const hasPolyatomic = Array.isArray(parsed.units)
    && parsed.units.some(u => u.kind === 'polyatomic' && u.ionData);
  if (hasPolyatomic) {
    return _buildIonicWithPolyatomic(parsed);
  }

  // ── Flatten atoms ──────────────────────────────────────────────────────
  const flat = [];
  for (const g of parsed.atoms) {
    const el = getElement(g.symbol);
    if (!el) return { ok:false, error:`Unknown element: ${g.symbol}` };
    for (let k = 0; k < g.count; k++) {
      flat.push({ symbol: g.symbol, el, origIndex: flat.length });
    }
  }

  // ── Classify metals vs nonmetals ──────────────────────────────────────
  const metalAtoms    = flat.filter(a => a.el.isMetal);
  const nonmetalAtoms = flat.filter(a => !a.el.isMetal);

  if (metalAtoms.length === 0) {
    return { ok:false,
      error:'Ionic compound requires at least one metal. If this is a polyatomic ion, use covalent mode.' };
  }
  if (nonmetalAtoms.length === 0) {
    return { ok:false, error:'Ionic compound requires at least one nonmetal.' };
  }

  // ── Electron pool & transfer ──────────────────────────────────────────
  // Each metal donates ALL its valence electrons. Each nonmetal accepts
  // until it reaches its octet (or duet). This is the HS-chemistry
  // simplification Chris teaches and matches the examples in her notes
  // (Li₃N, NaCl, MgO, CaCl₂, Al₂O₃).
  const transferNotes = [];
  const validationNotes = [];

  // Cation electron counts + charges
  const cations = metalAtoms.map(a => {
    const cationCharge = a.el.valence;    // loses all valence electrons
    transferNotes.push(
      `${a.symbol} donates ${a.el.valence} valence electron${a.el.valence===1?'':'s'} → ` +
      `becomes ${a.symbol}${chargeString(cationCharge)}`
    );
    return {
      symbol:    a.symbol,
      charge:    cationCharge,
      isAnion:   false,
      isCation:  true,
      lonePairs: 0,
      valenceAfterTransfer: 0,
      dotArrangement: [],
      origIndex: a.origIndex
    };
  });

  // Total electrons available for the nonmetals
  const totalDonated = metalAtoms.reduce((sum, a) => sum + a.el.valence, 0);

  // Nonmetals accept electrons until each reaches its octet target
  // The acceptance order doesn't affect the chemistry (each nonmetal has a
  // fixed need), but we process by decreasing EN so the notes read naturally.
  const nonmetalOrder = nonmetalAtoms.slice().sort((a,b) => {
    const ea = a.el.en ?? 0, eb = b.el.en ?? 0;
    return eb - ea;
  });

  let electronsLeft = totalDonated;
  const anions = [];

  for (const a of nonmetalOrder) {
    const target  = a.el.octetTarget;    // 2 for H, else 8
    const ownVal  = a.el.valence;
    const needed  = target - ownVal;     // electrons to reach octet/duet
    if (needed < 0) {
      // Nonmetal already has more than its target (shouldn't happen for HS-
      // scope elements, but guard). Treat as no transfer.
      anions.push(makeAnion(a, 0));
      continue;
    }
    const taken = Math.min(needed, electronsLeft);
    electronsLeft -= taken;
    const anionCharge = -taken;           // gains `taken` electrons
    const totalElectronsOnAnion = ownVal + taken;

    transferNotes.push(
      `${a.symbol} accepts ${taken} electron${taken===1?'':'s'} → ` +
      `reaches ${totalElectronsOnAnion} valence e⁻ ` +
      `(${taken<needed?'short of':'full'} octet${target===2?'/duet':''}) ` +
      `and becomes ${a.symbol}${chargeString(anionCharge)}`
    );

    anions.push({
      symbol:    a.symbol,
      charge:    anionCharge,
      isAnion:   true,
      isCation:  false,
      // Draw the FULL shell the anion now holds (ownVal + taken electrons)
      lonePairs: Math.floor(totalElectronsOnAnion / 2),
      valenceAfterTransfer: totalElectronsOnAnion,
      dotArrangement: distributeDots(totalElectronsOnAnion),
      origIndex: a.origIndex
    });

    if (taken < needed) {
      validationNotes.push(
        `${a.symbol} received only ${taken} of the ${needed} electrons it wanted; ` +
        `the metal did not donate enough electrons. Check the formula.`
      );
    }
  }

  if (electronsLeft > 0) {
    validationNotes.push(
      `${electronsLeft} donated electron${electronsLeft===1?'':'s'} unused — ` +
      `all nonmetals reached their octet before the metals ran out. ` +
      `Check the formula.`
    );
  }

  // ── Charge balance check ──────────────────────────────────────────────
  const cationTotal = cations.reduce((s,i) => s + i.charge, 0);
  const anionTotal  = anions.reduce((s,i) => s + i.charge, 0);
  const balanced    = (cationTotal + anionTotal) === 0;
  if (!balanced) {
    validationNotes.push(
      `Charge imbalance: cations total ${chargeString(cationTotal)}, ` +
      `anions total ${chargeString(anionTotal)}. Net = ${chargeString(cationTotal + anionTotal)}. ` +
      `Check the formula.`
    );
  }

  // ── Assemble ion list in presentation order ──────────────────────────
  //     Keep the original formula order so Li₃N → Li⁺, Li⁺, Li⁺, N³⁻
  //     (not alphabetical, not by EN).
  const allIons = [...cations, ...anions]
    .sort((a,b) => a.origIndex - b.origIndex);

  // ── Lay out ions in a grid ───────────────────────────────────────────
  layoutIons(allIons);

  return {
    ok: true,
    ions: allIons,
    chargeBalance: { cationTotal, anionTotal, balanced },
    transferNotes,
    validationNotes
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Distribute dots around an atom per Chris's "one on each side first" rule.
// Input:  total number of valence electrons to display (0–8)
// Output: array of 4 slot counts corresponding to [N, E, S, W] positions,
//         e.g.
//           4 electrons → [1, 1, 1, 1]   (one on each side, no pairs yet)
//           5 electrons → [2, 1, 1, 1]   (first pair goes N)
//           6 electrons → [2, 2, 1, 1]   (then E)
//           7 electrons → [2, 2, 2, 1]   (then S)
//           8 electrons → [2, 2, 2, 2]   (all paired)
// Order of filling: first one-per-side (N,E,S,W), then pairs (N,E,S,W).
// This is the ✓ arrangement from the Nitrogen example in image 1.
// ─────────────────────────────────────────────────────────────────────────────
function distributeDots(electronCount) {
  const slots = [0, 0, 0, 0];         // [N, E, S, W]
  let remaining = Math.max(0, Math.min(8, electronCount));

  // Pass 1: one electron on each side (up to 4)
  for (let i = 0; i < 4 && remaining > 0; i++) {
    slots[i] = 1;
    remaining--;
  }
  // Pass 2: pair up (bump each side to 2, in same order)
  for (let i = 0; i < 4 && remaining > 0; i++) {
    slots[i] = 2;
    remaining--;
  }
  return slots;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout: arrange ions horizontally in a row (wrapping if > 6 ions).
// Engine coordinates use a rough 120-unit spacing to match the covalent
// engine's scale convention.
// ─────────────────────────────────────────────────────────────────────────────
function layoutIons(ions) {
  const spacing = 140;
  const perRow  = 6;

  ions.forEach((ion, k) => {
    const row = Math.floor(k / perRow);
    const col = k % perRow;
    const rowCount = Math.min(perRow, ions.length - row * perRow);
    // Center each row horizontally around x=0
    const rowStartX = -(rowCount - 1) * spacing / 2;
    ion.x = rowStartX + col * spacing;
    ion.y = row * spacing;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Build a bare anion object (used in the edge case where a nonmetal enters
// with more electrons than its target).
// ─────────────────────────────────────────────────────────────────────────────
function makeAnion(nonmetalAtom, accepted) {
  const totalE = nonmetalAtom.el.valence + accepted;
  return {
    symbol:    nonmetalAtom.symbol,
    charge:    -accepted,
    isAnion:   true,
    isCation:  false,
    lonePairs: Math.floor(totalE / 2),
    valenceAfterTransfer: totalE,
    dotArrangement: distributeDots(totalE),
    origIndex: nonmetalAtom.origIndex
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POLYATOMIC-IONIC PATHWAY
// ─────────────────────────────────────────────────────────────────────────────
// Handles compounds like Ca(OH)₂, (NH₄)₂SO₄, NaHCO₃, K₃PO₄ where at least
// one of the constituent ions is a polyatomic ion (not a bare atom).
//
// Procedure:
//   1. Walk parsed.units. For each unit:
//        - polyatomic → build its internal Lewis structure via the covalent
//          Lewis engine using (ion.coreFormula + ion.charge)
//        - atom → treat as monatomic ion. Metal atoms become cations; the
//          rare bare nonmetal (e.g. Cl in NH4Cl) becomes a monatomic anion
//          with charge balanced against everything else.
//   2. Sum up the net charge from polyatomic ions. Bare nonmetals take on
//      enough charge to balance the cations after polyatomic anions are
//      accounted for.
//   3. Return an ion list where each item is either a monatomic-ion
//      descriptor (same shape as the classic ionic engine output) OR a
//      polyatomic-ion descriptor (new shape, wraps a covalent structure).
//
// Output shape (extended):
//   {
//     ok: true,
//     ions: [<see below>],
//     chargeBalance: { cationTotal, anionTotal, balanced },
//     transferNotes: [String],
//     validationNotes: [String]
//   }
//
// Ion item shapes:
//   Monatomic (unchanged from classic pathway):
//     { isPolyatomic:false, symbol, charge, isAnion, isCation,
//       lonePairs, valenceAfterTransfer, dotArrangement, x, y }
//
//   Polyatomic (new):
//     { isPolyatomic:true, ionName, formula, charge, isAnion, isCation,
//       structure:<covalent Lewis structure>, x, y }
//
// ─────────────────────────────────────────────────────────────────────────────
function _buildIonicWithPolyatomic(parsed) {
  const transferNotes   = [];
  const validationNotes = [];
  const builtIons       = [];

  // Walk units in order, building ion objects
  for (const unit of parsed.units) {
    if (unit.kind === 'polyatomic' && unit.ionData) {
      // Build this polyatomic ion via the covalent engine
      const ion         = unit.ionData;
      const chargeStr   = ion.charge >= 0
                          ? `{+${ion.charge}}`
                          : `{${ion.charge}}`;
      const formulaIn   = ion.coreFormula + chargeStr;
      const subParsed   = parseFormula(formulaIn, 'covalent');
      if (!subParsed.ok) {
        return { ok:false,
          error: `Could not parse polyatomic ion "${unit.formula}": ${subParsed.error}` };
      }
      const subStruct = buildLewisStructure(subParsed);
      if (!subStruct.ok) {
        return { ok:false,
          error: `Could not build Lewis structure for ${ion.name} (${unit.formula}): ${subStruct.error}` };
      }
      // Emit `unit.count` copies of this polyatomic ion
      for (let k = 0; k < unit.count; k++) {
        builtIons.push({
          isPolyatomic: true,
          ionName:      ion.name,
          formula:      unit.formula,
          charge:       ion.charge,
          isAnion:      ion.charge < 0,
          isCation:     ion.charge > 0,
          structure:    subStruct,
          origOrder:    builtIons.length
        });
      }
      transferNotes.push(
        `${ion.name} (${unit.formula})${unit.count > 1 ? ` × ${unit.count}` : ''} ` +
        `→ each carries a ${chargeString(ion.charge)} charge.`
      );
      continue;
    }

    if (unit.kind === 'atom') {
      const el = getElement(unit.symbol);
      if (!el) return { ok:false, error:`Unknown element: ${unit.symbol}` };

      if (el.isMetal) {
        // Metal cation — loses all valence electrons
        for (let k = 0; k < unit.count; k++) {
          const cCharge = el.valence;
          builtIons.push({
            isPolyatomic: false,
            symbol:       unit.symbol,
            charge:       cCharge,
            isAnion:      false,
            isCation:     true,
            lonePairs:    0,
            valenceAfterTransfer: 0,
            dotArrangement: [0,0,0,0],
            origOrder:    builtIons.length
          });
        }
        transferNotes.push(
          `${unit.symbol}${unit.count > 1 ? ` × ${unit.count}` : ''} donates all valence ` +
          `electrons → becomes ${unit.symbol}${chargeString(el.valence)}` +
          `${unit.count > 1 ? ` (×${unit.count})` : ''}.`
        );
      } else {
        // Bare nonmetal in a polyatomic compound — e.g. Cl in NH4Cl.
        // We defer charge assignment to the balancing step (below) since
        // we need to know the total cation charge first.
        for (let k = 0; k < unit.count; k++) {
          builtIons.push({
            isPolyatomic: false,
            symbol:       unit.symbol,
            charge:       0,           // placeholder, set during balancing
            isAnion:      true,
            isCation:     false,
            lonePairs:    0,
            valenceAfterTransfer: 0,
            dotArrangement: [0,0,0,0],
            origOrder:    builtIons.length,
            _needsChargeFromBalance: true,
            _element:     el
          });
        }
      }
      continue;
    }
  }

  // ── Balance bare-nonmetal charges from remaining cation-anion gap ────
  const knownCationTotal = builtIons
    .filter(i => i.isCation)
    .reduce((s,i) => s + i.charge, 0);
  const knownAnionTotal = builtIons
    .filter(i => i.isAnion && !i._needsChargeFromBalance)
    .reduce((s,i) => s + i.charge, 0);
  const toBalance = -(knownCationTotal + knownAnionTotal);  // how negative the bare anions must sum to

  const bareAnions = builtIons.filter(i => i._needsChargeFromBalance);
  if (bareAnions.length > 0) {
    if (toBalance > 0) {
      return { ok:false,
        error: `Charge imbalance: cations net ${chargeString(knownCationTotal)}, polyatomic anions net ${chargeString(knownAnionTotal)}. ` +
               `No room for additional negative charge.` };
    }
    // Distribute equally if possible
    const perAnion = toBalance / bareAnions.length;
    if (!Number.isInteger(perAnion)) {
      return { ok:false,
        error: `Charge imbalance: need ${chargeString(toBalance)} spread across ` +
               `${bareAnions.length} bare ${bareAnions[0].symbol} ion${bareAnions.length>1?'s':''} — ` +
               `does not divide evenly.` };
    }
    for (const a of bareAnions) {
      const el = a._element;
      const accepted = -perAnion;               // how many electrons the nonmetal gains
      const totalE   = el.valence + accepted;
      a.charge            = perAnion;
      a.lonePairs         = Math.floor(totalE / 2);
      a.valenceAfterTransfer = totalE;
      a.dotArrangement    = distributeDots(totalE);
      delete a._needsChargeFromBalance;
      delete a._element;
      transferNotes.push(
        `${a.symbol} accepts ${accepted} electron${accepted===1?'':'s'} → ` +
        `becomes ${a.symbol}${chargeString(perAnion)}.`
      );
    }
  }

  // ── Charge-balance check ─────────────────────────────────────────────
  const cationTotal = builtIons.filter(i => i.isCation).reduce((s,i) => s + i.charge, 0);
  const anionTotal  = builtIons.filter(i => i.isAnion).reduce((s,i) => s + i.charge, 0);
  const balanced    = (cationTotal + anionTotal) === 0;
  if (!balanced) {
    validationNotes.push(
      `Charge imbalance: cations total ${chargeString(cationTotal)}, ` +
      `anions total ${chargeString(anionTotal)}. Net = ${chargeString(cationTotal + anionTotal)}. ` +
      `Check the formula.`
    );
  }

  // ── Layout ───────────────────────────────────────────────────────────
  layoutIons(builtIons);

  return {
    ok: true,
    ions: builtIons,
    chargeBalance: { cationTotal, anionTotal, balanced },
    transferNotes,
    validationNotes,
    hasPolyatomic: true
  };
}
