// lewis-engine.js
// ─────────────────────────────────────────────────────────────────────────────
// Covalent Lewis-structure builder using Chris's NASB procedure.
//
// Input:  parsed-formula object from formula-parser.js
//         { ok:true, type:'covalent', atoms:[{symbol,count}], charge }
// Output: a fully-resolved structure object:
//   {
//     ok: true,
//     atoms: [{ symbol, x, y, lonePairs, formalCharge, isCentral, index }],
//     bonds: [{ i, j, order }],
//     overallCharge: Number,
//     isIon: Boolean,
//     nasb: { N, A, S, B, perAtomN:{sym:n,...}, perAtomValence:{sym:v,...},
//             chargeAdjustment, totalN, totalAraw, totalAadjusted },
//     centralAtomChoice: { symbol, reason },
//     validationNotes: [String],
//     octetMetOnAllAtoms: Boolean
//   }
//  — or { ok:false, error:String } on failure.
//
// Coordinate convention: (0,0) at central atom; y grows downward to match
// canvas space. Renderer will re-center as needed.
// ─────────────────────────────────────────────────────────────────────────────

function buildLewisStructure(parsed) {
  if (!parsed || !parsed.ok) return { ok:false, error:'Invalid parse input.' };
  if (parsed.type !== 'covalent') {
    return { ok:false, error:'lewis-engine only handles covalent molecules / polyatomic ions. Use ionic-engine for ionic compounds.' };
  }

  // ── Pre-built structure short-circuit ─────────────────────────────────
  // Some polyatomic ions (dichromate, thiosulfate, oxalate, etc.) have
  // multi-center connectivity that our single-central-atom NASB engine
  // cannot correctly build. Those ions carry a `prebuilt` field in the
  // polyatomic-ion data table; if the parsed formula + charge matches
  // one of them, return its curated structure directly.
  if (typeof findPrebuiltMatch === 'function') {
    const matchedEntry = findPrebuiltMatch(parsed);
    if (matchedEntry) {
      const prebuilt = materializePrebuiltStructure(matchedEntry);
      if (prebuilt) return prebuilt;
    }
  }

  // ── Expand the atom list into a flat array with per-atom data ──────────
  //   e.g.  [{sym:N,count:1}, {sym:H,count:4}]  →  [N, H, H, H, H]
  const flatAtoms = [];
  for (const group of parsed.atoms) {
    const el = getElement(group.symbol);
    if (!el) return { ok:false, error:`Unknown element: ${group.symbol}` };
    for (let k = 0; k < group.count; k++) {
      flatAtoms.push({
        symbol:       group.symbol,
        x:            0,
        y:            0,
        lonePairs:    0,      // lone-pair COUNT (each = 2 e⁻)
        formalCharge: 0,
        isCentral:    false,
        index:        flatAtoms.length
      });
    }
  }
  if (flatAtoms.length < 2) {
    return { ok:false, error:'Lewis structures require at least 2 atoms.' };
  }

  const charge = parsed.charge || 0;

  // ── Step 1: N (Needed electrons) ──────────────────────────────────────
  // Initial pass uses the standard octet TARGET (8 for most, 2 for H, 6 for B, 4 for Be).
  // If the central atom can expand its octet AND the resulting B is too small
  // to seat every terminal, we'll bump the central atom's contribution to its
  // expanded maximum and recompute. This preserves NASB as-taught for the
  // normal case (CH4, H2O, NH3, BF3, SO3, NO3-, etc.) and only deviates for
  // the expanded-octet cases (SF6, PF5, SF4, XeF2, ClF3) your notes call out.
  let perAtomN = {};
  let totalN = 0;
  for (const a of flatAtoms) {
    const target = octetTargetOf(a.symbol);
    totalN += target;
    perAtomN[a.symbol] = (perAtomN[a.symbol] || 0) + target;
  }

  // ── Step 2: A (Available electrons) ───────────────────────────────────
  //     Sum of valence electrons, THEN adjust for ion charge:
  //     anion (−): ADD magnitude;  cation (+): SUBTRACT magnitude
  const perAtomValence = {};
  let totalAraw = 0;
  for (const a of flatAtoms) {
    const v = valenceOf(a.symbol);
    totalAraw += v;
    perAtomValence[a.symbol] = (perAtomValence[a.symbol] || 0) + v;
  }
  const chargeAdjustment = -charge;              // +1 charge → -1 electrons
  const totalAadjusted   = totalAraw + chargeAdjustment;

  if (totalAadjusted < 0) {
    return { ok:false, error:'Negative electron count — impossible structure.' };
  }

  // ── Step 3: S (Shared) — initial pass ─────────────────────────────────
  let S = totalN - totalAadjusted;

  // ── Step 5: Pick central atom ─────────────────────────────────────────
  // Must happen before the expanded-octet correction, since we need to know
  // which atom is central before we can bump its N contribution.
  const centralChoice = pickCentralAtom(flatAtoms);
  if (!centralChoice.ok) return { ok:false, error: centralChoice.error };
  const centralIdx = centralChoice.index;
  flatAtoms[centralIdx].isCentral = true;

  const terminalIndices = flatAtoms
    .map((_, i) => i)
    .filter(i => i !== centralIdx);

  // ── Step 3b: Expanded-octet correction ────────────────────────────────
  // If B (= S/2) would be less than the number of terminals AND the central
  // atom can expand its octet, promote the central atom's target just enough
  // to make B equal the number of terminals — no more. This leaves any
  // remaining available electrons as lone pairs on the central atom, which
  // is how SF4 (1 LP), XeF2 (3 LP), ClF3 (2 LP), I3- etc. resolve.
  const centralSym = flatAtoms[centralIdx].symbol;
  let expandedOctetApplied = false;
  if (S > 0 && S / 2 < terminalIndices.length && canExpandOctet(centralSym)) {
    const el         = getElement(centralSym);
    const nTerminals = terminalIndices.length;
    // Target B = nTerminals. To get that: new S = 2·nTerminals.
    //   new N − A = 2·nTerminals  →  new N = A + 2·nTerminals
    //   bump = new N − old N
    const desiredN   = totalAadjusted + 2 * nTerminals;
    const bumpNeeded = desiredN - totalN;
    // Cap at octetMax expansion (never exceed element's max allowance)
    const maxBump    = el.octetMax - el.octetTarget;
    const bump       = Math.min(Math.max(bumpNeeded, 0), maxBump);
    if (bump > 0) {
      totalN += bump;
      perAtomN[centralSym] = (perAtomN[centralSym] || 0) + bump;
      S = totalN - totalAadjusted;
      expandedOctetApplied = true;
    }
  }

  if (S <= 0) {
    // Edge case: too many electrons for a covalent octet framework.
    return { ok:false,
      error:`No bonds possible (N − A = ${S}). This is usually a sign the compound should be drawn as ionic.` };
  }
  if (S % 2 !== 0) {
    return { ok:false,
      error:`Electron count mismatch (S = ${S} is odd). Radical species are not supported.` };
  }

  // ── Step 4: B (Bonds) ─────────────────────────────────────────────────
  const B = S / 2;

  // Accumulates engine notes shared across steps (skeleton decisions,
  // repair decisions, octet checks). Initialized here because the skeleton
  // step (Step 6) may want to record its acid-H routing choice.
  const validationNotes = [];

  // ── Step 6: Skeleton — single bonds from central to each terminal ─────
  // Default skeleton: each terminal gets one bond to the central atom.
  // BUT: for oxyacids and their conjugate bases (HCO3⁻, HSO4⁻, H2PO4⁻,
  // HPO4²⁻, HNO3, etc.), any H atoms bond to O terminals (not to the
  // central atom). This produces the textbook connectivity H-O-X instead
  // of H-X, because the H–O–X pattern matches what students see for
  // oxyacid Lewis structures.
  const centralSymForH = flatAtoms[centralIdx].symbol;
  const hIdx = terminalIndices.filter(i => flatAtoms[i].symbol === 'H');
  const oIdx = terminalIndices.filter(i => flatAtoms[i].symbol === 'O');
  const acidReroute =
    hIdx.length > 0 &&
    oIdx.length > 0 &&
    centralSymForH !== 'H' &&
    centralSymForH !== 'O' &&
    hIdx.length <= oIdx.length;

  const bonds = [];
  if (acidReroute) {
    // Pair each H with its own O terminal; those O atoms still bond to
    // central. The remaining O atoms also bond to central directly.
    const usedAsAcidO = new Set();
    for (let k = 0; k < hIdx.length; k++) {
      const h = hIdx[k];
      const o = oIdx[k];
      usedAsAcidO.add(o);
      // O–H bond
      bonds.push({ i: o, j: h, order: 1 });
      // Each acid-O also bonds to central
      bonds.push({ i: centralIdx, j: o, order: 1 });
    }
    // Any O not carrying an H still bonds to central
    for (const o of oIdx) {
      if (usedAsAcidO.has(o)) continue;
      bonds.push({ i: centralIdx, j: o, order: 1 });
    }
    // Any non-H, non-O terminals bond to central directly
    for (const t of terminalIndices) {
      const sym = flatAtoms[t].symbol;
      if (sym === 'H' || sym === 'O') continue;
      bonds.push({ i: centralIdx, j: t, order: 1 });
    }
    validationNotes.push(
      `Acid-H routing: ${hIdx.length} H atom${hIdx.length===1?'':'s'} placed ` +
      `on oxygen atom${hIdx.length===1?'':'s'} (not on ${centralSymForH}) — ` +
      `textbook oxyacid connectivity.`
    );
  } else {
    for (const ti of terminalIndices) {
      bonds.push({ i: centralIdx, j: ti, order: 1 });
    }
  }

  let bondsPlaced = bonds.length;
  if (bondsPlaced > B) {
    // Too many terminals for available bonds. Very rare; would only happen
    // for something like a totally malformed input.
    return { ok:false,
      error:`Cannot seat ${bondsPlaced} terminals with only ${B} total bond(s).` };
  }

  // Electrons currently used by bonding: bondsPlaced × 2
  let electronsUsed = bondsPlaced * 2;

  // ── Step 7: Promote bonds until total bond order = B ──────────────────
  //    Strategy: prioritize promoting bonds to terminals that CAN take more
  //    bonds. H can never take more than 1 bond. Halogens (F/Cl/Br/I) are
  //    "reluctant" to double-bond — they accept only if nothing else will.
  //    Preferred double-bond partners: O > N > C > S > P.
  //
  //    Only bonds between the CENTRAL atom and a terminal are candidates
  //    for promotion — O–H bonds (from acid-H routing) are never promoted.
  //
  //    Within the O candidates, non-protonated O atoms are preferred over
  //    protonated (acid-O) atoms: the X=O double bond in an oxyacid goes
  //    to the non-protonated oxygen, matching textbook HCO₃⁻, HNO₃, etc.
  const bondPromotionPriority = (sym) => {
    if (sym === 'H') return -999;                        // NEVER promote
    if (sym === 'F') return -50;                         // avoid
    if (sym === 'Cl'||sym==='Br'||sym==='I') return -20; // avoid
    const p = { O:10, N:9, C:8, S:7, P:6, Se:5 };
    return p[sym] !== undefined ? p[sym] : 0;
  };

  // Identify which terminals are "protonated" (bonded to at least one H
  // besides via the central atom). Used to deprioritize them for double-
  // bond promotion in oxyacids.
  const isProtonatedTerminal = new Set();
  for (const b of bonds) {
    const a = flatAtoms[b.i], c = flatAtoms[b.j];
    if (b.i === centralIdx || b.j === centralIdx) continue;
    if (a.symbol === 'H' && c.symbol !== 'H') isProtonatedTerminal.add(b.j);
    else if (c.symbol === 'H' && a.symbol !== 'H') isProtonatedTerminal.add(b.i);
  }

  // Sort bond indices by descending promotion priority. Only central-to-
  // terminal bonds are candidates; O–H bonds are excluded.
  const promoteOrder = bonds
    .map((b, idx) => ({ b, idx }))
    .filter(({ b }) => b.i === centralIdx || b.j === centralIdx)
    .map(({ b, idx }) => {
      const ti = b.i === centralIdx ? b.j : b.i;
      const sym = flatAtoms[ti].symbol;
      const isProt = isProtonatedTerminal.has(ti);
      return {
        idx,
        termIdx: ti,
        termSym: sym,
        // Protonated O atoms get a large penalty so they come LAST among
        // oxygens but stay above non-oxygens like C.
        prio: bondPromotionPriority(sym) - (isProt ? 5 : 0)
      };
    })
    .sort((a, b) => b.prio - a.prio);

  let extraBondsNeeded = B - bondsPlaced;
  let passGuard = 0;
  while (extraBondsNeeded > 0 && passGuard < 8) {
    passGuard++;
    let progressed = false;
    for (const p of promoteOrder) {
      if (extraBondsNeeded <= 0) break;
      const bond = bonds[p.idx];
      const termSym = p.termSym;
      // Hard limits: H stays single; halogens stay single unless nothing else works
      if (termSym === 'H') continue;
      if (bond.order >= 3) continue;  // max triple bond
      // Halogens: only promote if this pass already tried everything else
      if ((termSym==='F'||termSym==='Cl'||termSym==='Br'||termSym==='I') && passGuard === 1) continue;

      bond.order++;
      electronsUsed += 2;
      extraBondsNeeded--;
      progressed = true;
    }
    if (!progressed) break;
  }

  if (extraBondsNeeded > 0) {
    return { ok:false,
      error:`Could not place all ${B} bonds (${extraBondsNeeded} left over). Structure is ambiguous.` };
  }

  // ── Step 8: Distribute remaining electrons as lone pairs on TERMINALS ─
  //            Most electronegative first, to the terminal's octet target.
  let electronsRemaining = totalAadjusted - electronsUsed;

  const terminalFillOrder = terminalIndices
    .slice()
    .sort((a, b) => {
      const ea = electronegativityOf(flatAtoms[a].symbol) ?? 0;
      const eb = electronegativityOf(flatAtoms[b].symbol) ?? 0;
      return eb - ea;  // descending EN
    });

  for (const ti of terminalFillOrder) {
    if (electronsRemaining <= 0) break;
    const atom    = flatAtoms[ti];
    const target  = octetTargetOf(atom.symbol);
    // Sum ALL bond orders incident on this terminal. Important for acid-O
    // atoms that are bonded to BOTH an H and the central atom — they
    // contribute 2 bonds, not 1.
    let bondOrderSum = 0;
    for (const b of bonds) {
      if (b.i === ti || b.j === ti) bondOrderSum += b.order;
    }
    const bondElectrons = 2 * bondOrderSum;
    let need = target - bondElectrons;           // electrons still needed
    if (need <= 0) continue;                     // already at/over target
    const give = Math.min(need, electronsRemaining);
    // Only full pairs go as "lone pairs"
    const pairsToGive = Math.floor(give / 2);
    atom.lonePairs += pairsToGive;
    const electronsPlaced = pairsToGive * 2;
    electronsRemaining   -= electronsPlaced;
  }

  // ── Step 9: Any leftover electrons go on the CENTRAL atom ─────────────
  if (electronsRemaining > 0) {
    const pairs = Math.floor(electronsRemaining / 2);
    flatAtoms[centralIdx].lonePairs += pairs;
    electronsRemaining -= pairs * 2;
  }
  if (electronsRemaining !== 0) {
    // Shouldn't happen since S was even, but guard anyway
    return { ok:false, error:`Electron bookkeeping off by ${electronsRemaining}.` };
  }

  // ── Step 10: Validate & repair octets ─────────────────────────────────
  //            If the central atom is short of its octet AND a terminal has
  //            lone pairs, promote one of those lone pairs into a new bond.
  //            (Standard move for CO, CO2, N2, HCN, etc. when the central
  //            atom was left under-filled after Step 9.)
  repairCentralOctet(flatAtoms, bonds, centralIdx, validationNotes);

  // ── Step 11: Formal charges ───────────────────────────────────────────
  computeFormalCharges(flatAtoms, bonds);

  // ── Step 11.5: Expanded-octet FC minimization ─────────────────────────
  // For oxyanions where the central atom can expand its octet (S, P, Cl,
  // Br, I, Xe) and currently carries a positive formal charge while one
  // or more terminal O atoms carry -1, convert single X–O⁻ bonds to
  // double X=O bonds. Each conversion reduces central FC by 1 and pushes
  // the terminal O to FC 0, improving structural correctness:
  //   SO4²⁻: S(+2) + 4 O(-1) → S(0) + 2 O(0) + 2 O(-1)   [sum unchanged]
  //   PO4³⁻: P(+1) + 4 O(-1) → P(0) + 1 O(0) + 3 O(-1)   [sum unchanged]
  //   ClO4⁻: Cl(+3) + 4 O(-1) → Cl(0) + 3 O(0) + 1 O(-1) [sum unchanged]
  // Stops when central FC reaches 0 or no promotable terminals remain.
  //
  // Only applied to charged species (ions). Neutral molecules like SO₃
  // keep their standard Lewis form with resonance (1 S=O + 2 S-O⁻) so
  // the resonance engine can still enumerate the three Kekulé forms.
  if (charge !== 0) {
    minimizeExpandedOctetCentralCharge(flatAtoms, bonds, centralIdx, validationNotes);
    // Recompute FCs after any promotions above
    computeFormalCharges(flatAtoms, bonds);
  }

  // ── Step 12: Octet check ──────────────────────────────────────────────
  const octetMetOnAllAtoms = checkAllOctets(flatAtoms, bonds, validationNotes);

  // ── Step 13: Lay out 2D coordinates ──────────────────────────────────
  layoutAtoms(flatAtoms, bonds, centralIdx);

  return {
    ok: true,
    atoms: flatAtoms,
    bonds,
    overallCharge: charge,
    isIon: charge !== 0,
    nasb: {
      N: totalN,
      A: totalAadjusted,
      S, B,
      perAtomN,
      perAtomValence,
      chargeAdjustment,
      totalN,
      totalAraw,
      totalAadjusted,
      expandedOctetApplied
    },
    centralAtomChoice: {
      symbol: flatAtoms[centralIdx].symbol,
      reason: centralChoice.reason
    },
    validationNotes,
    octetMetOnAllAtoms
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Central atom selection.
//   1. H is NEVER central.
//   2. If exactly one C is present → C is central.
//   3. Otherwise the LEAST electronegative non-H atom is central.
//      (Ties broken by appearance order in the formula.)
// Returns { ok, index, reason }.
// ─────────────────────────────────────────────────────────────────────────────
function pickCentralAtom(flatAtoms) {
  const nonH = flatAtoms.filter(a => a.symbol !== 'H');
  if (nonH.length === 0) {
    return { ok:false, error:'Cannot build Lewis structure from hydrogens alone.' };
  }

  // Rule 2: single carbon → that carbon is central
  const carbons = flatAtoms.filter(a => a.symbol === 'C');
  if (carbons.length === 1) {
    return {
      ok: true,
      index: carbons[0].index,
      reason: 'Carbon is central whenever it is present.'
    };
  }
  if (carbons.length > 1) {
    // Plan: "if multiple C's are present, chain them". HS scope is dominated
    // by single-carbon molecules and simple chains. For multi-C we pick the
    // first carbon as the anchor; renderer can extend to a chain later.
    return {
      ok: true,
      index: carbons[0].index,
      reason: 'Multiple carbons present — using the first carbon as the central anchor.'
    };
  }

  // Rule 3: least-electronegative non-H atom
  let best = nonH[0];
  for (const a of nonH) {
    const ea = electronegativityOf(a.symbol) ?? Infinity;
    const eb = electronegativityOf(best.symbol) ?? Infinity;
    if (ea < eb) best = a;
  }
  return {
    ok: true,
    index: best.index,
    reason: `${best.symbol} is the least electronegative non-hydrogen atom.`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// If the central atom is under its octet, shift a terminal lone pair into
// a bond. Loops until satisfied or no more adjustments possible.
// ─────────────────────────────────────────────────────────────────────────────
function repairCentralOctet(atoms, bonds, centralIdx, notes) {
  const central = atoms[centralIdx];
  const centralTarget = octetTargetOf(central.symbol);
  const canExpand     = canExpandOctet(central.symbol);

  // Boron/Beryllium purposefully DON'T get octets — their targets are 6/4.
  // So this repair loop uses their target, not 8.
  function centralElectronCount() {
    let bondElectrons = 0;
    for (const b of bonds) {
      if (b.i === centralIdx || b.j === centralIdx) bondElectrons += 2 * b.order;
    }
    return bondElectrons + central.lonePairs * 2;
  }

  let guard = 0;
  while (centralElectronCount() < centralTarget && guard < 6) {
    guard++;
    // Find a terminal that has lone pairs AND is bonded to central
    const candidateBonds = bonds
      .filter(b => (b.i === centralIdx || b.j === centralIdx) && b.order < 3)
      .map(b => {
        const ti = b.i === centralIdx ? b.j : b.i;
        return { bond:b, term: atoms[ti], termIdx: ti };
      })
      // H can't be promoted (duet only). Skip H terminals.
      .filter(c => c.term.symbol !== 'H')
      // Skip terminals with no lone pair to donate
      .filter(c => c.term.lonePairs > 0);

    if (candidateBonds.length === 0) break;

    // For each candidate, check whether it is a "protonated" terminal
    // (bonded to at least one H besides the central atom). We deprioritize
    // those because in oxyacid structures the C=O / S=O / P=O / N=O double
    // bond should form to the NON-protonated oxygen, not the O-H oxygen.
    for (const c of candidateBonds) {
      c.isProtonated = bonds.some(b =>
        (b.i === c.termIdx || b.j === c.termIdx) &&
        b.i !== centralIdx && b.j !== centralIdx &&
        (atoms[b.i].symbol === 'H' || atoms[b.j].symbol === 'H')
      );
    }

    // Prefer non-protonated terminals first, then most-electronegative donor.
    candidateBonds.sort((a,b) => {
      if (a.isProtonated !== b.isProtonated) return a.isProtonated ? 1 : -1;
      const ea = electronegativityOf(a.term.symbol) ?? 0;
      const eb = electronegativityOf(b.term.symbol) ?? 0;
      return eb - ea;
    });

    const c = candidateBonds[0];
    c.term.lonePairs -= 1;
    c.bond.order     += 1;
    notes.push(`Shifted a lone pair from ${c.term.symbol} into the ${central.symbol}–${c.term.symbol} bond to complete the central octet.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Expanded-octet formal-charge minimization.
//
// For oxyanions whose central atom can expand its octet (S, P, Cl, Br, I,
// Xe), convert single X–O⁻ bonds to double X=O bonds until the central
// atom's formal charge reaches 0. This produces the textbook expanded-
// octet forms of SO4²⁻ (2 S=O + 2 S-O⁻), PO4³⁻ (1 P=O + 3 P-O⁻), etc.
//
// Algorithm:
//   While central FC > 0:
//     Find a terminal O with FC = -1, bonded to central by a single bond,
//       AND not protonated (not bonded to H). Promote that bond to double.
//     The terminal loses one lone pair; central gains one bond order.
//     Central FC decreases by 1; terminal FC goes to 0.
//   Stop if no eligible terminal remains.
// ─────────────────────────────────────────────────────────────────────────────
function minimizeExpandedOctetCentralCharge(atoms, bonds, centralIdx, notes) {
  const central = atoms[centralIdx];
  if (!canExpandOctet(central.symbol)) return;

  // Helper: sum bond orders incident on a given atom
  const bondOrderOn = (idx) => {
    let s = 0;
    for (const b of bonds) if (b.i === idx || b.j === idx) s += b.order;
    return s;
  };

  // Helper: compute FC from atom's current lone pairs + bond order
  const fcOf = (idx) => {
    const a = atoms[idx];
    return calculateFCFromCounts(a.symbol, a.lonePairs, bondOrderOn(idx));
  };

  // Helper: is this terminal protonated (bonded to an H besides via central)?
  const isProtonated = (idx) => {
    for (const b of bonds) {
      if (b.i !== idx && b.j !== idx) continue;
      if (b.i === centralIdx || b.j === centralIdx) continue;
      const other = b.i === idx ? b.j : b.i;
      if (atoms[other].symbol === 'H') return true;
    }
    return false;
  };

  let guard = 0;
  while (guard < 8) {
    guard++;
    const centralFC = fcOf(centralIdx);
    if (centralFC <= 0) break;

    // Find a terminal O bonded to central by single bond, with FC = -1, not protonated
    const candidates = bonds
      .filter(b => (b.i === centralIdx || b.j === centralIdx) && b.order === 1)
      .map(b => {
        const ti = b.i === centralIdx ? b.j : b.i;
        return { bond: b, term: atoms[ti], termIdx: ti };
      })
      .filter(c => c.term.symbol === 'O')
      .filter(c => c.term.lonePairs > 0)
      .filter(c => !isProtonated(c.termIdx))
      .filter(c => fcOf(c.termIdx) === -1);

    if (candidates.length === 0) break;

    // Promote the first candidate's bond; move one lone pair into the bond
    const c = candidates[0];
    c.term.lonePairs -= 1;
    c.bond.order     += 1;
    notes.push(
      `Expanded-octet FC minimization: promoted ${central.symbol}–${c.term.symbol} ` +
      `single bond to double bond, moving central ${central.symbol} toward ` +
      `formal charge 0.`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Compute F.C. on every atom using the Phase-2 helper.
// ─────────────────────────────────────────────────────────────────────────────
function computeFormalCharges(atoms, bonds) {
  for (const a of atoms) {
    // Sum bond orders incident on this atom
    let bondOrderSum = 0;
    for (const b of bonds) {
      if (b.i === a.index || b.j === a.index) bondOrderSum += b.order;
    }
    a.formalCharge = calculateFCFromCounts(a.symbol, a.lonePairs, bondOrderSum);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Verify every atom satisfies its octet target (or expanded octet allowance).
// Returns true if all met, and appends notes.
// ─────────────────────────────────────────────────────────────────────────────
function checkAllOctets(atoms, bonds, notes) {
  let allMet = true;
  for (const a of atoms) {
    let bondElectrons = 0;
    for (const b of bonds) {
      if (b.i === a.index || b.j === a.index) bondElectrons += 2 * b.order;
    }
    const electronsAround = bondElectrons + a.lonePairs * 2;
    const target = octetTargetOf(a.symbol);

    if (electronsAround < target) {
      allMet = false;
      notes.push(`${a.symbol} (atom #${a.index}) has ${electronsAround} e⁻, below its octet target of ${target}.`);
    } else if (electronsAround > target && !canExpandOctet(a.symbol)) {
      allMet = false;
      notes.push(`${a.symbol} (atom #${a.index}) has ${electronsAround} e⁻, above its max of ${target}.`);
    }
  }
  if (allMet && notes.length === 0) notes.push('Octets met for all atoms.');
  return allMet;
}

// ─────────────────────────────────────────────────────────────────────────────
// Place atoms on a canvas-friendly 2D grid.
//   - Central atom at (0,0)
//   - Terminals distributed around it at equal angles
//   - Coordinates scaled to ~120 px from center (renderer can rescale)
// Geometry here is purely VISUAL — the shape this produces is NOT the VSEPR
// geometry (that's Phase 8). For Lewis drawing, even angular distribution
// reads cleanest.
// ─────────────────────────────────────────────────────────────────────────────
function layoutAtoms(atoms, bonds, centralIdx) {
  const R = 120;            // bond length in px
  const cx = 0, cy = 0;
  atoms[centralIdx].x = cx;
  atoms[centralIdx].y = cy;

  const terminalIdx = atoms.map((_,i)=>i).filter(i=>i!==centralIdx);
  const n = terminalIdx.length;
  if (n === 0) return;

  // Two terminals → horizontal placement (X–A–X). Textbook Lewis structures
  // draw both linear (CO2, BeF2) and bent (H2O, OF2, H2S) molecules with
  // the terminals to the left and right of the central atom; the bent
  // angle itself shows up in the separate Molecular Geometry panel.
  if (n === 2) {
    atoms[terminalIdx[0]].x = cx - R;
    atoms[terminalIdx[0]].y = cy;
    atoms[terminalIdx[1]].x = cx + R;
    atoms[terminalIdx[1]].y = cy;
    return;
  }

  // 3+ terminals: distribute evenly clockwise starting from the top
  // (−y direction). Gives trigonal/tetrahedral/octahedral spreads.
  const startAngle = -Math.PI/2;
  for (let k = 0; k < n; k++) {
    const theta = startAngle + (2*Math.PI * k / n);
    atoms[terminalIdx[k]].x = cx + R * Math.cos(theta);
    atoms[terminalIdx[k]].y = cy + R * Math.sin(theta);
  }
}
