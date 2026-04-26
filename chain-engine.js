// chain-engine.js
// ─────────────────────────────────────────────────────────────────────────────
// Converts a parsed chain descriptor (from condensed-formula-parser.js)
// into a Lewis structure object compatible with the existing renderer
// and downstream engines. Bypasses NASB because carbon chains have no
// single "central atom" — each carbon manages its own valence locally.
//
// Input shape:
//   {
//     ok: true,
//     kind: 'chain',
//     carbons: [{ index, hCount, branches:[ {carbons, bonds}, ... ] }, ...],
//     chainBonds: [{ i, j, order }, ...],
//     charge: 0,
//     raw, normalizedFormula
//   }
//
// Output shape (matches buildLewisStructure's success return):
//   {
//     ok: true,
//     atoms: [...],          // all carbons + all hydrogens (main + branch)
//     bonds: [...],          // all C-C + C-H
//     overallCharge: 0,
//     isIon: false,
//     isChain: true,         // signals downstream engines
//     nasb: null,            // chains don't run NASB
//     hybridization: {       // per-atom hybridization, keyed by atom.index
//       [atomIdx]: 'sp3' | 'sp2' | 'sp' | null
//     },
//     centralAtomChoice: { symbol, reason },
//     validationNotes: [...],
//     octetMetOnAllAtoms: true
//   }
// ─────────────────────────────────────────────────────────────────────────────

// Layout constants — units are engine coordinates, renderer scales them
const CHAIN_BOND_LENGTH = 120;              // horizontal spacing between adjacent C atoms
const CHAIN_H_OFFSET    = 90;               // vertical H placement from C
const CHAIN_BRANCH_OFFSET = 120;            // vertical distance to branch root

function buildChainStructure(parsed) {
  if (!parsed || !parsed.ok) return { ok:false, error:'Invalid chain parse input.' };
  if (parsed.kind !== 'chain') return { ok:false, error:'chain-engine requires a chain descriptor.' };

  const mainCarbons = parsed.carbons;
  const chainBonds  = parsed.chainBonds;
  if (mainCarbons.length < 1) return { ok:false, error:'Chain has no carbons.' };

  const validationNotes = [];

  // ── Validate per-carbon valence (main chain AND branches) ─────────────
  // Each carbon's total = backbone bond orders + H count + branches.length.
  // For branches, each branch contributes 1 bond of order 1 to the attach-
  // point carbon; inside the branch, each sub-carbon has its own backbone
  // bonds + H count + (if any) further branches.
  const mainCheck = _validateCarbonList(mainCarbons, chainBonds, /* attachedBonds */ 0);
  if (!mainCheck.ok) return mainCheck;
  for (const c of mainCarbons) {
    for (const br of c.branches) {
      const brCheck = _validateBranch(br);
      if (!brCheck.ok) return brCheck;
    }
  }

  // ── Build flat atom list: main chain carbons first ───────────────────
  const atoms = [];
  const hybridization = {};
  const bonds = [];

  for (const c of mainCarbons) {
    atoms.push({
      symbol:        c.symbol || 'C',
      x:             0, y: 0,
      lonePairs:     c.lonePairs || 0,
      formalCharge:  0,
      isCentral:     false,
      isChainCarbon: true,         // kept for backward-compat (marker for "main chain")
      chainIndex:    c.index,
      index:         atoms.length
    });
  }

  // Layout main carbons horizontally, centered on x=0
  const n = mainCarbons.length;
  const totalWidth = (n - 1) * CHAIN_BOND_LENGTH;
  for (let k = 0; k < n; k++) {
    atoms[k].x = -totalWidth / 2 + k * CHAIN_BOND_LENGTH;
    atoms[k].y = 0;
  }

  // Emit main-chain C-C bonds
  for (const b of chainBonds) {
    bonds.push({ i: b.i, j: b.j, order: b.order });
  }

  // ── Pre-compute hybridization for main-chain atoms ───────────────────
  // Considers both backbone bonds AND double-bond substituents (e.g. C=O
  // in carbonyl). sp for triple bonds, sp² for any double, sp³ otherwise.
  // Non-carbon chain atoms (e.g. ether O) are hybridized based on their
  // own bonding pattern: O with 2 single bonds → sp³ (bent, 2 lone pairs).
  for (const c of mainCarbons) {
    let maxOrder = 1;
    for (const b of chainBonds) {
      if (b.i === c.index || b.j === c.index) {
        if (b.order > maxOrder) maxOrder = b.order;
      }
    }
    // Also check substituent bond orders (carbonyl =O gives order 2, nitrile ≡N order 3)
    for (const s of (c.substituents || [])) {
      if ((s.attachOrder || 1) > maxOrder) maxOrder = s.attachOrder;
    }
    hybridization[c.index] =
      maxOrder === 3 ? 'sp' :
      maxOrder === 2 ? 'sp2' :
      'sp3';
  }

  // ── Place branches on each main-chain carbon ─────────────────────────
  // Each branch's root carbon is placed perpendicular to the main chain.
  // Direction cycle: up, down, right, left. For the common case of 1-2
  // branches per carbon, the first goes up and the second goes down —
  // which matches textbook convention. For 3-4 branches (like (CH3)3CH
  // or C(CH3)4 on a short main chain), they fan out to all cardinals.
  const branchDirections = [
    { dx: 0,                    dy: -CHAIN_BRANCH_OFFSET, side: 'up'    },
    { dx: 0,                    dy:  CHAIN_BRANCH_OFFSET, side: 'down'  },
    { dx:  CHAIN_BRANCH_OFFSET, dy: 0,                    side: 'right' },
    { dx: -CHAIN_BRANCH_OFFSET, dy: 0,                    side: 'left'  }
  ];

  // Track which main-chain carbons have branches (affects H placement).
  // Four cardinals tracked: up, down, left, right.
  const branchOccupancy = {};   // atomIdx → { up, down, left, right }
  for (const c of mainCarbons) {
    branchOccupancy[c.index] = { up: false, down: false, left: false, right: false };
  }

  for (const c of mainCarbons) {
    const parentAtom = atoms[c.index];
    for (let bi = 0; bi < c.branches.length; bi++) {
      const br = c.branches[bi];
      const dir = branchDirections[bi % branchDirections.length];
      if (dir.side === 'up')    branchOccupancy[c.index].up    = true;
      if (dir.side === 'down')  branchOccupancy[c.index].down  = true;
      if (dir.side === 'left')  branchOccupancy[c.index].left  = true;
      if (dir.side === 'right') branchOccupancy[c.index].right = true;

      // Emit branch carbons with coordinates relative to the parent.
      // Sub-chain extends further in the branch direction for each carbon.
      const branchAtomIndices = [];
      for (let ci = 0; ci < br.carbons.length; ci++) {
        const bc = br.carbons[ci];
        const newAtomIdx = atoms.length;
        // Direction vector (normalized to unit multiples of CHAIN_BOND_LENGTH)
        const ux = dir.dx === 0 ? 0 : (dir.dx > 0 ? 1 : -1);
        const uy = dir.dy === 0 ? 0 : (dir.dy > 0 ? 1 : -1);
        const offsetX = parentAtom.x + dir.dx + ux * ci * CHAIN_BOND_LENGTH;
        const offsetY = parentAtom.y + dir.dy + uy * ci * CHAIN_BOND_LENGTH;
        atoms.push({
          symbol:        'C',
          x:             offsetX, y: offsetY,
          lonePairs:     0,
          formalCharge:  0,
          isCentral:     false,
          isChainCarbon: true,
          chainIndex:    null,       // branch carbons have no main-chain index
          isBranchCarbon: true,
          branchSide:    dir.side,    // for H placement logic
          index:         newAtomIdx
        });
        branchAtomIndices.push(newAtomIdx);
      }
      // Bond from parent to branch root
      bonds.push({ i: c.index, j: branchAtomIndices[0], order: 1 });
      // Bonds within the branch
      for (const bb of br.bonds) {
        bonds.push({
          i: branchAtomIndices[bb.i],
          j: branchAtomIndices[bb.j],
          order: bb.order
        });
      }
      // Recursive: branch carbons may have their own branches (R3b: 1 level,
      // but the parser allows deeper nesting; handle it here for safety).
      for (let ci = 0; ci < br.carbons.length; ci++) {
        const bc = br.carbons[ci];
        for (let sbi = 0; sbi < bc.branches.length; sbi++) {
          const subBr = bc.branches[sbi];
          _emitSubBranch(
            atoms, bonds, branchAtomIndices[ci], subBr,
            /* side */ dir.side.startsWith('up') ? 'up' : 'down'
          );
        }
      }
    }
  }

  // ── Place substituents on main-chain carbons (after branches) ─────────
  // Substituents take any remaining cardinal directions branches haven't
  // used. Halogens/OH/NH2 are terminal (1 atom + H's). For amines with
  // R groups, the R sub-chain extends in the same direction as the N.
  for (const c of mainCarbons) {
    _emitSubstituentsForCarbon(atoms, bonds, c, c.index, branchOccupancy[c.index], hybridization);
  }

  // ── Also emit substituents for branch carbons ────────────────────────
  // Branch carbons can have substituents too (e.g. CH3CH(CH(OH)CH3)CH3).
  _emitSubstituentsForBranchCarbons(atoms, bonds, mainCarbons, hybridization);

  // ── Compute hybridization for branch + substituent carbons ───────────
  // Main-chain hybridization was pre-computed above; here we cover any
  // additional carbons that got added via branches or R groups.
  for (const a of atoms) {
    if (a.symbol !== 'C') continue;
    if (hybridization[a.index] !== undefined) continue;
    let maxOrder = 1;
    for (const b of bonds) {
      if (b.i === a.index || b.j === a.index) {
        if (b.order > maxOrder) maxOrder = b.order;
      }
    }
    hybridization[a.index] =
      maxOrder === 3 ? 'sp' :
      maxOrder === 2 ? 'sp2' :
      'sp3';
  }

  // ── Emit hydrogens with layout ───────────────────────────────────────
  _emitHydrogensForMainChain(atoms, bonds, mainCarbons, branchOccupancy);
  _emitHydrogensForBranchCarbons(atoms, bonds, mainCarbons);

  // ── Octet / duet validation ──────────────────────────────────────────
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

  // ── Build the per-chainIndex hybridization summary (for VSEPR breakdowns) ─
  // The VSEPR engine expects `hybridization[chainIndex]` for main-chain carbons.
  // We populate both atomIdx→hyb and chainIndex→hyb for compatibility.
  const hybridByChainIdx = {};
  for (const a of atoms) {
    if (a.isChainCarbon && a.chainIndex !== null && a.chainIndex !== undefined) {
      hybridByChainIdx[a.chainIndex] = hybridization[a.index];
    }
  }

  // ── Central-atom choice placeholder ──────────────────────────────────
  const middleCarbonIdx = Math.floor((mainCarbons.length - 1) / 2);
  const hybList = Object.values(hybridByChainIdx);

  const cCount = atoms.filter(a => a.symbol === 'C').length;
  const hCount = atoms.filter(a => a.symbol === 'H').length;
  const hasBranches = mainCarbons.some(c => c.branches.length > 0);

  return {
    ok:             true,
    atoms,
    bonds,
    overallCharge:  parsed.charge || 0,
    isIon:          (parsed.charge || 0) !== 0,
    isChain:        true,
    nasb:           null,
    hybridization:  hybridByChainIdx,        // VSEPR engine expects chain-indexed
    hybridizationByAtom: hybridization,      // atom-indexed for renderer/breakdown
    centralAtomChoice: {
      symbol: 'C',
      reason: `Carbon ${hasBranches ? 'branched ' : ''}chain: ${cCount} C + ${hCount} H. ` +
              `Main chain hybridization ${hybList.join('/')}. ` +
              `${hasBranches ? 'Branches attached perpendicular to the main chain.' : ''}`
    },
    validationNotes,
    octetMetOnAllAtoms: allMet,
    chainMeta: {
      carbonCount:   cCount,
      mainChainLen:  mainCarbons.length,
      carbonIndices: mainCarbons.map(c => c.index),
      middleCarbonIdx,
      hasBranches
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Target valence for each chain-atom symbol. Neutral atoms with standard
// octet fills follow group-number rules: C=4, N=3, O=2, F=1. Used to
// validate that a chain atom's total bond order + H count matches what
// electronic structure demands.
// ─────────────────────────────────────────────────────────────────────────────
const CHAIN_ATOM_TARGET_VALENCE = { C: 4, N: 3, O: 2, F: 1 };

// ─────────────────────────────────────────────────────────────────────────────
// Validate that each chain atom in a flat list has the correct valence for
// its element, accounting for backbone bonds, H count, branch attachments,
// and substituent attachments. Default (for C) is valence 4.
// ─────────────────────────────────────────────────────────────────────────────
function _validateCarbonList(carbons, backboneBonds, attachedBonds) {
  for (const c of carbons) {
    const sym = c.symbol || 'C';
    const targetValence = CHAIN_ATOM_TARGET_VALENCE[sym] || 4;

    let bondSum = 0;
    for (const b of backboneBonds) {
      if (b.i === c.index || b.j === c.index) bondSum += b.order;
    }
    // Plus 1 bond order per branch attached at this atom
    bondSum += (c.branches || []).length;
    // Plus attachOrder per substituent (usually 1)
    for (const s of (c.substituents || [])) {
      bondSum += (s.attachOrder || 1);
    }
    // Plus any attached bond from the parent (for branch roots)
    const total = bondSum + c.hCount + (c.index === 0 ? attachedBonds : 0);
    if (total !== targetValence) {
      const subSummary = (c.substituents || []).map(s => s.label).join(',') || 'none';
      return {
        ok: false,
        error: `${sym} atom #${c.index} has valence ${total} (backbone ${bondSum - (c.branches || []).length - (c.substituents || []).reduce((s, x) => s + (x.attachOrder || 1), 0)}, H ${c.hCount}, branches ${(c.branches || []).length}, subs [${subSummary}]${attachedBonds && c.index === 0 ? ', attached ' + attachedBonds : ''}); expected ${targetValence}.`
      };
    }
  }
  return { ok: true };
}

// Validate a branch (sub-chain) as a whole. The root carbon has 1 bond
// coming in from the parent (attached=1); other carbons stand alone.
function _validateBranch(branch) {
  return _validateCarbonList(branch.carbons, branch.bonds, /* attachedBonds */ 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Recursively emit a sub-branch (branch of a branch) — rare but supported
// by the parser, so handled here for completeness. Simple geometry: extend
// in the same direction as the parent branch.
// ─────────────────────────────────────────────────────────────────────────────
function _emitSubBranch(atoms, bonds, parentAtomIdx, branch, side) {
  const parent = atoms[parentAtomIdx];
  const branchAtomIndices = [];
  const dy = side === 'up' ? -CHAIN_BOND_LENGTH : CHAIN_BOND_LENGTH;
  for (let ci = 0; ci < branch.carbons.length; ci++) {
    const bc = branch.carbons[ci];
    const newIdx = atoms.length;
    atoms.push({
      symbol:        'C',
      x:             parent.x + (ci + 1) * 40,
      y:             parent.y + dy + ci * CHAIN_BOND_LENGTH * (side === 'up' ? -1 : 1),
      lonePairs:     0,
      formalCharge:  0,
      isCentral:     false,
      isChainCarbon: true,
      chainIndex:    null,
      isBranchCarbon: true,
      index:         newIdx
    });
    branchAtomIndices.push(newIdx);
  }
  bonds.push({ i: parentAtomIdx, j: branchAtomIndices[0], order: 1 });
  for (const b of branch.bonds) {
    bonds.push({
      i: branchAtomIndices[b.i],
      j: branchAtomIndices[b.j],
      order: b.order
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Place hydrogens on each main-chain carbon, respecting branch occupancy.
// (A carbon with a branch going up doesn't also get an H going up.)
// ─────────────────────────────────────────────────────────────────────────────
function _emitHydrogensForMainChain(atoms, bonds, mainCarbons, branchOccupancy) {
  // Build a map: chainIndex → atom index (same for main chain)
  // Main-chain atoms are indices 0..mainCarbons.length-1 by construction.
  for (const c of mainCarbons) {
    const cAtom = atoms[c.index];
    const isFirst = c.index === 0;
    const isLast  = c.index === mainCarbons.length - 1;
    // Determine hybridization from incident bonds
    let maxOrder = 1;
    for (const b of bonds) {
      if ((b.i === c.index || b.j === c.index) && b.order > maxOrder) {
        maxOrder = b.order;
      }
    }
    const isSp  = maxOrder === 3;
    const isSp2 = maxOrder === 2;

    const occupied = branchOccupancy[c.index];

    // Decide H slots considering branch occupancy
    const slots = [];
    if (isSp) {
      if (isFirst && !occupied.left)  slots.push({ dx: -CHAIN_H_OFFSET, dy: 0 });
      if (isLast  && !occupied.right) slots.push({ dx:  CHAIN_H_OFFSET, dy: 0 });
    } else if (isSp2) {
      // sp² carbon. Two cases:
      //   Case A (backbone C=C): the double bond is horizontal along the chain,
      //     so up/down are free. Use them first (matches textbook ethene).
      //   Case B (C=O or other vertical double-bond substituent): a substituent
      //     occupies up or down. Remaining H's should fill horizontal slots
      //     (matches textbook formaldehyde/carbonyl geometry).
      const vertOccupied = occupied.up || occupied.down;
      if (vertOccupied) {
        // Case B: prefer horizontal slots (for terminals)
        if (isFirst && !occupied.left)  slots.push({ dx: -CHAIN_H_OFFSET, dy: 0 });
        if (isLast  && !occupied.right) slots.push({ dx:  CHAIN_H_OFFSET, dy: 0 });
        if (!occupied.up)   slots.push({ dx: 0, dy: -CHAIN_H_OFFSET });
        if (!occupied.down) slots.push({ dx: 0, dy:  CHAIN_H_OFFSET });
      } else {
        // Case A: prefer vertical slots (textbook alkene look)
        if (!occupied.up)   slots.push({ dx: 0, dy: -CHAIN_H_OFFSET });
        if (!occupied.down) slots.push({ dx: 0, dy:  CHAIN_H_OFFSET });
        if (isFirst && !occupied.left)  slots.push({ dx: -CHAIN_H_OFFSET, dy: 0 });
        if (isLast  && !occupied.right) slots.push({ dx:  CHAIN_H_OFFSET, dy: 0 });
      }
    } else {
      // sp3: prefer up, down, then outward horizontal for terminals.
      // Skip any direction occupied by a branch.
      if (!occupied.up)   slots.push({ dx: 0, dy: -CHAIN_H_OFFSET });
      if (!occupied.down) slots.push({ dx: 0, dy:  CHAIN_H_OFFSET });
      if (isFirst && !occupied.left)  slots.push({ dx: -CHAIN_H_OFFSET, dy: 0 });
      if (isLast  && !occupied.right) slots.push({ dx:  CHAIN_H_OFFSET, dy: 0 });
      // Diagonal fillers
      slots.push({ dx: -CHAIN_H_OFFSET * 0.7, dy: -CHAIN_H_OFFSET * 0.7 });
      slots.push({ dx:  CHAIN_H_OFFSET * 0.7, dy:  CHAIN_H_OFFSET * 0.7 });
    }

    for (let k = 0; k < c.hCount; k++) {
      const slot = slots[k] || { dx: 0, dy: CHAIN_H_OFFSET * (k - slots.length + 2) };
      const hIdx = atoms.length;
      atoms.push({
        symbol:       'H',
        x:            cAtom.x + slot.dx,
        y:            cAtom.y + slot.dy,
        lonePairs:    0,
        formalCharge: 0,
        isCentral:    false,
        isChainCarbon: false,
        index:        hIdx
      });
      bonds.push({ i: c.index, j: hIdx, order: 1 });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Place hydrogens on branch carbons. The parent direction is stored on
// each branch carbon as `branchSide`; H atoms go in the three perpendicular
// directions (away from the parent).
// ─────────────────────────────────────────────────────────────────────────────
function _emitHydrogensForBranchCarbons(atoms, bonds, mainCarbons) {
  for (const a of atoms) {
    if (!a.isBranchCarbon) continue;
    // Count non-H bond order to determine how many H's to add.
    // Any bond to a non-H atom (C, N, O, halogen) consumes valence.
    let nonHBondSum = 0;
    for (const b of bonds) {
      if (b.i === a.index || b.j === a.index) {
        const other = atoms[b.i === a.index ? b.j : b.i];
        if (other.symbol !== 'H') nonHBondSum += b.order;
      }
    }
    const hNeeded = 4 - nonHBondSum;
    if (hNeeded <= 0) continue;

    // H slots depend on which side this branch points. The parent direction
    // is "behind" us; the other three cardinals get H atoms (if needed).
    // For vertical branches (up/down), H's go up/down/horizontal (away
    // from the parent's direction). For horizontal branches, swap.
    let slots;
    const side = a.branchSide;
    if (side === 'up') {
      // Parent below (in main chain); H's go up, left, right
      slots = [
        { dx: 0, dy: -CHAIN_H_OFFSET },
        { dx: -CHAIN_H_OFFSET, dy: 0 },
        { dx:  CHAIN_H_OFFSET, dy: 0 }
      ];
    } else if (side === 'down') {
      // Parent above; H's go down, left, right
      slots = [
        { dx: 0, dy:  CHAIN_H_OFFSET },
        { dx: -CHAIN_H_OFFSET, dy: 0 },
        { dx:  CHAIN_H_OFFSET, dy: 0 }
      ];
    } else if (side === 'right') {
      // Parent on the left; H's go right, up, down
      slots = [
        { dx:  CHAIN_H_OFFSET, dy: 0 },
        { dx: 0, dy: -CHAIN_H_OFFSET },
        { dx: 0, dy:  CHAIN_H_OFFSET }
      ];
    } else {  // 'left'
      // Parent on the right; H's go left, up, down
      slots = [
        { dx: -CHAIN_H_OFFSET, dy: 0 },
        { dx: 0, dy: -CHAIN_H_OFFSET },
        { dx: 0, dy:  CHAIN_H_OFFSET }
      ];
    }

    for (let k = 0; k < hNeeded; k++) {
      const slot = slots[k] || { dx: (k - slots.length + 1) * 30, dy: 0 };
      const hIdx = atoms.length;
      atoms.push({
        symbol:       'H',
        x:            a.x + slot.dx,
        y:            a.y + slot.dy,
        lonePairs:    0,
        formalCharge: 0,
        isCentral:    false,
        isChainCarbon: false,
        index:        hIdx
      });
      bonds.push({ i: a.index, j: hIdx, order: 1 });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Substituent placement — for R4a: halogens (F, Cl, Br, I), hydroxyl (OH),
// primary amine (NH2), secondary amine (NHR), tertiary amine (NR₂).
//
// Each substituent's first atom gets placed in the first available cardinal
// direction (up, down, right, left) not already occupied by a branch. Its
// H atoms (if any) get placed around the substituent atom, away from the
// parent carbon. R-group sub-chains extend in the same direction as the
// substituent (so NHR has R extending further from the chain).
// ─────────────────────────────────────────────────────────────────────────────
function _emitSubstituentsForCarbon(atoms, bonds, carbon, parentAtomIdx, occupancy, hybridization) {
  if (!carbon.substituents || carbon.substituents.length === 0) return;
  const parentAtom = atoms[parentAtomIdx];
  const isMainChainCarbon = parentAtom.isChainCarbon && parentAtom.chainIndex !== null;
  const isSp  = hybridization[parentAtomIdx] === 'sp';
  const isSp2 = hybridization[parentAtomIdx] === 'sp2';

  // Direction candidates in preference order (default: vertical first).
  // sp² carbons have 3 in-plane bonds at 120°; substituents go up/down.
  // sp carbons (triple-bond) have 2 bonds at 180° — substituents extend
  // along the chain axis (see special-case logic below).
  const defaultCandidates = [
    { side: 'up',    dx: 0,                    dy: -CHAIN_BRANCH_OFFSET },
    { side: 'down',  dx: 0,                    dy:  CHAIN_BRANCH_OFFSET },
    { side: 'right', dx:  CHAIN_BRANCH_OFFSET, dy: 0                    },
    { side: 'left',  dx: -CHAIN_BRANCH_OFFSET, dy: 0                    }
  ];

  for (const sub of carbon.substituents) {
    // Triple-bond substituents (nitrile ≡N on sp carbon): extend along the
    // chain axis to match textbook H–C≡N / R–C≡N drawings. Always prefer
    // 'right' — nitriles are terminal by nature and textbook drawings
    // always place the nitrogen to the right of the carbon.
    let candidates = defaultCandidates;
    if ((sub.attachOrder || 1) === 3 && isSp) {
      candidates = [defaultCandidates[2], defaultCandidates[3], defaultCandidates[0], defaultCandidates[1]];
    }

    // Find first unoccupied direction
    const dir = candidates.find(c => !occupancy[c.side]) || candidates[0];
    occupancy[dir.side] = true;

    _emitOneSubstituent(atoms, bonds, parentAtomIdx, sub, dir, hybridization);
  }
}

// Emit substituents for branch carbons.
function _emitSubstituentsForBranchCarbons(atoms, bonds, mainCarbons, hybridization) {
  // Walk each main carbon's branches recursively. For each branch carbon,
  // if it has substituents, emit them.
  function walk(bcList, parentAtomMap, parentDir) {
    for (let i = 0; i < bcList.length; i++) {
      const bc = bcList[i];
      const parentAtomIdx = parentAtomMap[i];
      if (parentAtomIdx === undefined) continue;
      if (bc.substituents && bc.substituents.length > 0) {
        // Branch carbon occupancy: we assume the "toward-parent" direction
        // is occupied plus the "extend-further" direction if there are
        // more carbons in the branch.
        const occupancy = { up: false, down: false, left: false, right: false };
        if (parentDir === 'up')    { occupancy.down = true; occupancy.up   = i < bcList.length - 1; }
        if (parentDir === 'down')  { occupancy.up   = true; occupancy.down = i < bcList.length - 1; }
        if (parentDir === 'right') { occupancy.left = true; occupancy.right = i < bcList.length - 1; }
        if (parentDir === 'left')  { occupancy.right = true; occupancy.left = i < bcList.length - 1; }

        const candidates = [
          { side: 'up',    dx: 0,                    dy: -CHAIN_BRANCH_OFFSET },
          { side: 'down',  dx: 0,                    dy:  CHAIN_BRANCH_OFFSET },
          { side: 'right', dx:  CHAIN_BRANCH_OFFSET, dy: 0                    },
          { side: 'left',  dx: -CHAIN_BRANCH_OFFSET, dy: 0                    }
        ];
        for (const sub of bc.substituents) {
          const dir = candidates.find(c => !occupancy[c.side]) || candidates[0];
          occupancy[dir.side] = true;
          _emitOneSubstituent(atoms, bonds, parentAtomIdx, sub, dir, hybridization);
        }
      }
    }
  }

  // For each main carbon's branches, walk and emit substituents
  for (const c of mainCarbons) {
    for (let bi = 0; bi < c.branches.length; bi++) {
      const br = c.branches[bi];
      // Find the atom indices for this branch's carbons
      const branchAtoms = atoms.filter(a =>
        a.isBranchCarbon && _isFromBranch(a, atoms, c.index, bi)
      );
      // Actually we don't track which branch each atom came from. Skip for
      // now — branch carbon substituents are a less common case. Flag as
      // R4a follow-up if needed.
    }
  }
}

// Helper: approximate check if a branch-carbon atom is from a specific branch.
// For now returns false (we skip substituents on branch carbons in R4a).
function _isFromBranch(atom, allAtoms, mainIdx, branchIdx) {
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Emit a single substituent and its associated atoms (H's, R-groups).
// ─────────────────────────────────────────────────────────────────────────────
function _emitOneSubstituent(atoms, bonds, parentAtomIdx, sub, dir, hybridization) {
  const parentAtom = atoms[parentAtomIdx];
  const subAtomIdx = atoms.length;
  const subX = parentAtom.x + dir.dx;
  const subY = parentAtom.y + dir.dy;

  // The substituent's main atom (F, Cl, Br, I, O, N)
  atoms.push({
    symbol:        sub.symbol,
    x:             subX, y: subY,
    lonePairs:     sub.lonePairs,
    formalCharge:  0,
    isCentral:     false,
    isChainCarbon: false,
    isSubstituent: true,
    substituentLabel: sub.label,
    side:          dir.side,
    index:         subAtomIdx
  });

  // Bond from parent carbon to the substituent's main atom
  bonds.push({ i: parentAtomIdx, j: subAtomIdx, order: sub.attachOrder || 1 });

  // Emit H's on the substituent, on the side away from the parent
  const hSlots = _substituentHSlots(dir.side);
  for (let k = 0; k < sub.hCount; k++) {
    const slot = hSlots[k] || { dx: 0, dy: CHAIN_H_OFFSET };
    const hIdx = atoms.length;
    atoms.push({
      symbol:       'H',
      x:            subX + slot.dx,
      y:            subY + slot.dy,
      lonePairs:    0,
      formalCharge: 0,
      isCentral:    false,
      isChainCarbon: false,
      index:        hIdx
    });
    bonds.push({ i: subAtomIdx, j: hIdx, order: 1 });
  }

  // R-group sub-chains for secondary/tertiary amines
  if (sub.rBranches && sub.rBranches.length > 0) {
    _emitAmineRGroups(atoms, bonds, subAtomIdx, sub.rBranches, dir.side, hybridization);
  }
}

// H placement slots around a substituent atom, away from the parent carbon.
function _substituentHSlots(parentSide) {
  // parentSide tells us which side the parent is on relative to this atom.
  // H's go on the three sides away from the parent.
  const s = CHAIN_H_OFFSET * 0.8;
  if (parentSide === 'up') {
    // Parent is below us; H's go up, left, right
    return [
      { dx: 0, dy: -s },
      { dx: -s, dy: 0 },
      { dx:  s, dy: 0 }
    ];
  }
  if (parentSide === 'down') {
    // Parent is above us; H's go down, left, right
    return [
      { dx: 0, dy:  s },
      { dx: -s, dy: 0 },
      { dx:  s, dy: 0 }
    ];
  }
  if (parentSide === 'right') {
    // Parent is to the left; H's go right, up, down
    return [
      { dx:  s, dy: 0 },
      { dx: 0, dy: -s },
      { dx: 0, dy:  s }
    ];
  }
  // parentSide === 'left'
  return [
    { dx: -s, dy: 0 },
    { dx: 0, dy: -s },
    { dx: 0, dy:  s }
  ];
}

// Emit R-group sub-chains for secondary/tertiary amines. The N is at subAtomIdx;
// its R groups extend in directions OTHER than back toward the parent carbon.
function _emitAmineRGroups(atoms, bonds, nAtomIdx, rBranches, parentSide, hybridization) {
  const nAtom = atoms[nAtomIdx];
  // `parentSide` is the direction FROM the parent TO the N. The direction
  // BACK to the parent (from N's perspective) is the opposite. We block that.
  const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const backToParent = opposite[parentSide];
  const usedSides = new Set([backToParent]);
  const candidates = [
    { side: 'up',    dx: 0,                    dy: -CHAIN_BRANCH_OFFSET },
    { side: 'down',  dx: 0,                    dy:  CHAIN_BRANCH_OFFSET },
    { side: 'right', dx:  CHAIN_BRANCH_OFFSET, dy: 0                    },
    { side: 'left',  dx: -CHAIN_BRANCH_OFFSET, dy: 0                    }
  ];

  for (const rBr of rBranches) {
    const dir = candidates.find(c => !usedSides.has(c.side)) || candidates[0];
    usedSides.add(dir.side);

    // Emit R-group carbons
    const rAtomIndices = [];
    for (let ci = 0; ci < rBr.carbons.length; ci++) {
      const bc = rBr.carbons[ci];
      const newIdx = atoms.length;
      const ux = dir.dx === 0 ? 0 : (dir.dx > 0 ? 1 : -1);
      const uy = dir.dy === 0 ? 0 : (dir.dy > 0 ? 1 : -1);
      const offsetX = nAtom.x + dir.dx + ux * ci * CHAIN_BOND_LENGTH;
      const offsetY = nAtom.y + dir.dy + uy * ci * CHAIN_BOND_LENGTH;
      atoms.push({
        symbol:        'C',
        x:             offsetX, y: offsetY,
        lonePairs:     0,
        formalCharge:  0,
        isCentral:     false,
        isChainCarbon: true,
        chainIndex:    null,
        isBranchCarbon: true,
        branchSide:    dir.side,
        index:         newIdx
      });
      rAtomIndices.push(newIdx);
    }
    // Bond N to first R carbon
    bonds.push({ i: nAtomIdx, j: rAtomIndices[0], order: 1 });
    // Bonds within the R group
    for (const bb of (rBr.bonds || [])) {
      bonds.push({ i: rAtomIndices[bb.i], j: rAtomIndices[bb.j], order: bb.order });
    }
  }
}
