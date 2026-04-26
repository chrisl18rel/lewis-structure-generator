// condensed-formula-parser.js
// ─────────────────────────────────────────────────────────────────────────────
// Parses condensed structural formulas for carbon chains. Takes raw input
// like:
//   CH3CH3            → ethane (C-C)
//   CH3CH2CH3         → propane (C-C-C)
//   CH2=CH2           → ethene (C=C)
//   CH3CH=CHCH3       → 2-butene (C-C=C-C)
//   CH≡CH, CH#CH      → ethyne (C≡C)
//   CH3C≡CH, CH3C#CH  → propyne
//
// Output: a chain object compatible with chain-engine.js:
//   {
//     ok: true,
//     kind: 'chain',
//     carbons: [
//       { index: 0, hCount: 3, branches: [] },
//       { index: 1, hCount: 2, branches: [] },
//       ...
//     ],
//     chainBonds: [{ i, j, order }, ...],     // C-C backbone bonds
//     charge: 0,
//     raw: '...',
//     normalizedFormula: 'CnHm'
//   }
//
// R3a scope: straight chains only. R3b adds branches via `()`.
// ─────────────────────────────────────────────────────────────────────────────

// Tokenizer: walk the raw string, emit a list of tokens.
// Returns { ok, tokens, error? }
//
// Tokens:
//   { kind: 'carbonGroup', hCount: Number }
//   { kind: 'bond', order: 2 | 3 }
//   { kind: 'openParen' }
//   { kind: 'closeParen', mult: Number }     // post-paren multiplier baked in
//   { kind: 'substituent', type: 'halogen'|'hydroxyl'|'aminePrimary'|'amineSecondary'|'amineTertiary',
//                          symbol?: 'F'|'Cl'|'Br'|'I',
//                          count: Number }   // optional multiplicity (e.g. Cl2)
function _tokenizeCondensed(raw) {
  // Strip whitespace and hyphens — hyphens are syntactic sugar in forms
  // like CH3-O-CH3 (dimethyl ether) and CH3-COOH (acetic acid with a
  // stylistic dash). They carry no semantic meaning.
  const s = raw.replace(/[\s\-]/g, '');
  const tokens = [];
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    // Bond markers
    if (ch === '=') { tokens.push({ kind: 'bond', order: 2 }); i++; continue; }
    if (ch === '≡' || ch === '#') { tokens.push({ kind: 'bond', order: 3 }); i++; continue; }

    // Parens
    if (ch === '(') { tokens.push({ kind: 'openParen' }); i++; continue; }
    if (ch === ')') {
      i++;
      // Optional post-paren multiplier: (CH3)3 → mult=3
      const m = s.slice(i).match(/^\d+/);
      let mult = 1;
      if (m) { mult = parseInt(m[0], 10); i += m[0].length; }
      tokens.push({ kind: 'closeParen', mult });
      continue;
    }

    // Halogens (check before carbon groups because Cl starts with C)
    // Accept F, Cl, Br, I with optional count suffix (Cl2, F3, etc.)
    const halogenMatch = s.slice(i).match(/^(Cl|Br|F|I)(\d*)/);
    if (halogenMatch) {
      const sym = halogenMatch[1];
      const count = halogenMatch[2] ? parseInt(halogenMatch[2], 10) : 1;
      tokens.push({ kind: 'substituent', type: 'halogen', symbol: sym, count });
      i += halogenMatch[0].length;
      continue;
    }

    // OH (hydroxyl — alcohol substituent)
    // Match 'O' followed by 'H' and optional count. "O2H" isn't a thing; "OH" or "OH2" (rare).
    if (ch === 'O' && i + 1 < s.length && s[i + 1] === 'H') {
      const m = s.slice(i + 2).match(/^\d*/);
      const count = m[0] ? parseInt(m[0], 10) : 1;
      tokens.push({ kind: 'substituent', type: 'hydroxyl', count });
      i += 2 + (m[0] ? m[0].length : 0);
      continue;
    }

    // Bare O (ether backbone oxygen) — appears between two carbons in
    // formulas like CH3OCH3 (dimethyl ether), CH3CH2OCH3 (methyl ethyl
    // ether), or CH3-O-CH3 (same molecule, hyphen stripped at tokenization).
    // This token emits a chain atom with symbol='O', hCount=0, lonePairs=2.
    if (ch === 'O') {
      tokens.push({ kind: 'chainAtom', symbol: 'O', hCount: 0, lonePairs: 2, attachOrder: 1 });
      i++;
      continue;
    }

    // NH2 (primary amine substituent) — check before NH
    if (ch === 'N' && i + 2 < s.length && s[i + 1] === 'H' && s[i + 2] === '2') {
      // Optional post-count like (NH2)3 would be handled via parens, but
      // also accept a bare digit after for robustness (NH22 makes no sense)
      tokens.push({ kind: 'substituent', type: 'aminePrimary', count: 1 });
      i += 3;
      continue;
    }

    // NH (secondary amine — will be followed by an R group / sub-chain)
    if (ch === 'N' && i + 1 < s.length && s[i + 1] === 'H') {
      tokens.push({ kind: 'substituent', type: 'amineSecondary', count: 1 });
      i += 2;
      continue;
    }

    // N alone (tertiary amine — will be followed by two R groups via parens)
    // The parser handles the attached R groups as branches, treating the N
    // as a substituent-with-branches.
    if (ch === 'N') {
      tokens.push({ kind: 'substituent', type: 'amineTertiary', count: 1 });
      i++;
      continue;
    }

    // Leading H (only at position 0) — represents an extra H on the next
    // carbon. Used for textbook formaldehyde (HCHO) and formic acid (HCOOH).
    if (ch === 'H' && i === 0) {
      tokens.push({ kind: 'extraH' });
      i++;
      continue;
    }

    // ── R4b + R4c-1 functional-group tokens ──────────────────────────────
    // Longest patterns first so COOH doesn't match as CO+OH, CONH2 doesn't
    // match as CO+NH2, etc. Priority: CONH2 > COOH > CONH > CHO > CN > CON > CO.
    if (s.slice(i, i + 5) === 'CONH2') {
      // Primary amide: carbon with =O + NH2
      tokens.push({ kind: 'carbonGroup', hCount: 0, fgPreAttached: ['carbonyl', 'aminePrimary'] });
      i += 5;
      continue;
    }
    if (s.slice(i, i + 4) === 'COOH') {
      // Carboxylic acid: emit a carbonGroup(0H) with pre-attached =O and -OH
      tokens.push({ kind: 'carbonGroup', hCount: 0, fgPreAttached: ['carbonyl', 'hydroxyl'] });
      i += 4;
      continue;
    }
    // Ester linkage: COO followed by a new carbon (not H, which would be
    // carboxylic acid). Emits TWO tokens:
    //   1. carbonGroup with pre-attached =O (the carbonyl carbon)
    //   2. chainAtom with symbol='O' (the bridge oxygen)
    // The next token will be the following carbon, connected to the bridge O.
    if (s.slice(i, i + 3) === 'COO' &&
        (s[i + 3] === 'C' || s[i + 3] === '(')) {
      tokens.push({ kind: 'carbonGroup', hCount: 0, fgPreAttached: ['carbonyl'] });
      tokens.push({ kind: 'chainAtom', symbol: 'O', hCount: 0, lonePairs: 2, attachOrder: 1 });
      i += 3;
      continue;
    }
    if (s.slice(i, i + 4) === 'CONH') {
      // Secondary amide: carbon with =O + NHR. The NH consumes 1 following R group.
      tokens.push({ kind: 'carbonGroup', hCount: 0, fgPreAttached: ['carbonyl', 'amineSecondary'] });
      i += 4;
      continue;
    }
    if (s.slice(i, i + 3) === 'CHO') {
      // Aldehyde: emit a carbonGroup(1H) with pre-attached =O
      tokens.push({ kind: 'carbonGroup', hCount: 1, fgPreAttached: ['carbonyl'] });
      i += 3;
      continue;
    }
    if (s.slice(i, i + 3) === 'CON' &&
        (s[i + 3] === '(' || s[i + 3] === undefined)) {
      // Tertiary amide: carbon with =O + NR2. The N consumes 2 following R groups.
      // Only matches when followed by '(' (for R groups) or end of string.
      tokens.push({ kind: 'carbonGroup', hCount: 0, fgPreAttached: ['carbonyl', 'amineTertiary'] });
      i += 3;
      continue;
    }
    // Nitrile CN — only valid at chain end or as terminal FG. Distinct from
    // the CN of cyanide ion (handled elsewhere via polyatomic lookup).
    if (s[i] === 'C' && s[i + 1] === 'N' &&
        (s[i + 2] === undefined || s[i + 2] === ')')) {
      // Nitrile: emit a carbonGroup(0H) with pre-attached ≡N
      tokens.push({ kind: 'carbonGroup', hCount: 0, fgPreAttached: ['nitrile'] });
      i += 2;
      continue;
    }
    // Ketone CO must be followed by another C (new chain carbon) — else reject.
    if (s[i] === 'C' && s[i + 1] === 'O' &&
        (s[i + 2] === 'C' || s[i + 2] === '(' || s[i + 2] === '=')) {
      // Ketone carbonyl: emit a carbonGroup(0H) with pre-attached =O
      tokens.push({ kind: 'carbonGroup', hCount: 0, fgPreAttached: ['carbonyl'] });
      i += 2;
      continue;
    }

    // Carbon-group: 'C' optionally followed by 'H' and optional digit count
    if (ch === 'C') {
      let j = i + 1;
      let hCount = 0;
      if (j < s.length && s[j] === 'H') {
        j++;
        // Optional digit(s) after H
        const m = s.slice(j).match(/^\d+/);
        if (m) {
          hCount = parseInt(m[0], 10);
          j += m[0].length;
        } else {
          hCount = 1;                     // 'CH' with no digit means 1 H
        }
      }
      tokens.push({ kind: 'carbonGroup', hCount });
      i = j;
      continue;
    }

    // Anything else is unexpected at this phase (R4a = hydrocarbons + halogens + OH + amines)
    return {
      ok: false,
      error: `Unexpected character "${ch}" at position ${i}. Supported: C, H, F, Cl, Br, I, O (in OH), N (in NH2/NH/N), bonds (= ≡ #), and parens.`
    };
  }
  return { ok: true, tokens };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse a tokenized condensed formula into a chain descriptor.
//
// Supports:
//   - Straight chains: CH3CH3, CH3CH2CH3
//   - Unsaturation: CH2=CH2, CH≡CH, CH3CH=CHCH3
//   - Branches via parens: CH3CH(CH3)CH3, CH3CH(CH2CH3)CH3
//   - Paren multipliers: (CH3)4C, C(CH3)4
//   - Leading parens: (CH3)3CH attaches 3 methyls to the following CH
//
// Branch model:
//   Each carbon in `carbons` has a `branches` array. Each branch is itself
//   a mini-chain: { carbons:[...], bonds:[...] } where carbon indices are
//   local to the branch. The chain-engine will inline them during layout.
//
//   A branch's "root" is its first carbon, which is bonded to the main-
//   chain carbon it's attached to.
// ─────────────────────────────────────────────────────────────────────────────
function _parseChainFromTokens(tokens, raw) {
  // Walk tokens with an explicit cursor so we can recurse into parens
  const state = { tokens, i: 0 };
  const result = _parseSequence(state, /* isBranch */ false);
  if (!result.ok) return result;

  if (state.i < tokens.length) {
    return { ok: false, error: `Unparsed trailing tokens after position ${state.i}.` };
  }

  return {
    ok:         true,
    kind:       'chain',
    carbons:    result.carbons,
    chainBonds: result.bonds,
    charge:     0,
    raw,
    normalizedFormula: _chainNormalizedFormula(result.carbons, result.bonds)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse a sequence of tokens into a chain.
//   - When isBranch=false: parsing the main chain; leading `(` attaches
//     to the NEXT carbon (pre-attached branches); subsequent `(` attach
//     to the PREVIOUS carbon.
//   - When isBranch=true: parsing inside a paren group; no leading-paren
//     special case (we nest only 1 level deep in R3b).
//
// Returns { ok, carbons, bonds, error? }. Consumes tokens up to matching
// close-paren (if isBranch) or end of stream.
// ─────────────────────────────────────────────────────────────────────────────
function _parseSequence(state, isBranch) {
  const carbons = [];
  const bonds   = [];
  let pendingBondOrder = 1;
  let lastCarbonIdx    = -1;
  // Branches that appeared BEFORE the first carbon (leading parens).
  // These get attached to the first carbon when it's emitted.
  const preAttachedBranches = [];
  // Substituents that appeared BEFORE the first carbon (leading halogens etc.)
  // These get attached to the first carbon when it's emitted.
  const preAttachedSubstituents = [];
  // Extra H from a leading H token (e.g. HCHO, HCOOH). Added to the next
  // carbon emitted.
  let pendingExtraH = 0;

  while (state.i < state.tokens.length) {
    const t = state.tokens[state.i];

    if (t.kind === 'extraH') {
      pendingExtraH++;
      state.i++;
      continue;
    }

    if (t.kind === 'closeParen') {
      if (!isBranch) {
        return { ok: false, error: `Unexpected ")" at top level.` };
      }
      // Caller (the outer _parseSequence handling the paren) consumes this token.
      // If no carbons were emitted but there are pre-attached substituents,
      // hand them back so the caller can treat the paren contents as a
      // substituent-in-parens form.
      if (carbons.length === 0 && preAttachedSubstituents.length > 0) {
        return { ok: true, carbons, bonds, pendingSubs: preAttachedSubstituents };
      }
      return { ok: true, carbons, bonds };
    }

    if (t.kind === 'openParen') {
      state.i++;    // consume the '('
      // Recursively parse contents
      const sub = _parseSequence(state, /* isBranch */ true);
      if (!sub.ok) return sub;
      // Expect the matching closeParen
      if (state.i >= state.tokens.length || state.tokens[state.i].kind !== 'closeParen') {
        return { ok: false, error: 'Mismatched parenthesis.' };
      }
      const closeTok = state.tokens[state.i];
      state.i++;    // consume the ')'
      const mult = closeTok.mult || 1;

      // ── Substituent-in-parens path ────────────────────────────────────
      // If the paren contained only substituents and no carbons, treat the
      // contents as substituents on the surrounding carbon. This handles
      // textbook forms like CH2(OH)CH2OH, CH3CH(OH)CH3, (OH)CH2CH3.
      if (sub.carbons.length === 0 && sub.pendingSubs && sub.pendingSubs.length > 0) {
        const subs = [];
        for (let k = 0; k < mult; k++) {
          for (const s of sub.pendingSubs) subs.push(_cloneSubstituent(s));
        }
        if (lastCarbonIdx >= 0) {
          carbons[lastCarbonIdx].substituents.push(...subs);
        } else {
          preAttachedSubstituents.push(...subs);
        }
        continue;
      }

      // Otherwise it's a branch (contains carbons)
      if (lastCarbonIdx >= 0) {
        for (let k = 0; k < mult; k++) {
          carbons[lastCarbonIdx].branches.push({
            carbons: _cloneBranchCarbons(sub.carbons),
            bonds:   sub.bonds.map(b => ({ ...b }))
          });
        }
      } else {
        for (let k = 0; k < mult; k++) {
          preAttachedBranches.push({
            carbons: _cloneBranchCarbons(sub.carbons),
            bonds:   sub.bonds.map(b => ({ ...b }))
          });
        }
      }
      continue;
    }

    if (t.kind === 'bond') {
      if (lastCarbonIdx < 0) {
        return { ok: false, error: `Bond marker at the start of the formula is not allowed.` };
      }
      if (pendingBondOrder !== 1) {
        return { ok: false, error: `Two bond markers in a row is not allowed.` };
      }
      pendingBondOrder = t.order;
      state.i++;
      continue;
    }

    if (t.kind === 'carbonGroup') {
      const newIdx = carbons.length;
      const carbon = {
        index:  newIdx,
        symbol: 'C',
        hCount: t.hCount + pendingExtraH,
        lonePairs: 0,
        branches: [],
        substituents: []
      };
      pendingExtraH = 0;

      // Advance past the carbon-group token now. Any R-group consumption
      // below will advance state.i further.
      state.i++;

      // Attach any FG-pre-attached substituents (for CHO, COOH, CO, CN,
      // CONH2, CONH, CON carbons). For secondary/tertiary amides, we
      // consume R groups from the following tokens.
      if (t.fgPreAttached && t.fgPreAttached.length > 0) {
        for (const fgName of t.fgPreAttached) {
          const sub = _buildPreAttachedSubstituent(fgName);
          if (!sub) continue;

          if (fgName === 'amineSecondary') {
            const r = _consumeRGroup(state);
            if (!r.ok) return { ok: false, error: `Secondary amide: ${r.error}` };
            sub.rBranches = [r.branch];
          } else if (fgName === 'amineTertiary') {
            const r1 = _consumeRGroup(state);
            if (!r1.ok) return { ok: false, error: `Tertiary amide: ${r1.error}` };
            const r2 = _consumeRGroup(state);
            if (!r2.ok) return { ok: false, error: `Tertiary amide: ${r2.error}` };
            sub.rBranches = [r1.branch, r2.branch];
          }

          carbon.substituents.push(sub);
        }
      }

      // Attach any pre-stashed leading items to this FIRST carbon
      if (lastCarbonIdx < 0) {
        if (preAttachedBranches.length > 0) {
          carbon.branches.push(...preAttachedBranches);
          preAttachedBranches.length = 0;
        }
        if (preAttachedSubstituents.length > 0) {
          carbon.substituents.push(...preAttachedSubstituents);
          preAttachedSubstituents.length = 0;
        }
      }

      carbons.push(carbon);

      if (lastCarbonIdx >= 0) {
        bonds.push({ i: lastCarbonIdx, j: newIdx, order: pendingBondOrder });
        pendingBondOrder = 1;
      }
      lastCarbonIdx = newIdx;
      // Note: state.i already advanced above — don't advance again here
      continue;
    }

    // Non-carbon chain atom (e.g. ether O, R4c-2+ feature). Structurally
    // behaves like a carbonGroup — it's a chain atom that can bond to
    // adjacent atoms and hold its own H count and lone pairs — but it has
    // a different symbol and typically lower valence (O=2, N=3).
    if (t.kind === 'chainAtom') {
      const newIdx = carbons.length;
      const atom = {
        index:     newIdx,
        symbol:    t.symbol,
        hCount:    t.hCount || 0,
        lonePairs: t.lonePairs || 0,
        branches: [],
        substituents: []
      };

      if (lastCarbonIdx < 0) {
        if (preAttachedBranches.length > 0) {
          atom.branches.push(...preAttachedBranches);
          preAttachedBranches.length = 0;
        }
        if (preAttachedSubstituents.length > 0) {
          atom.substituents.push(...preAttachedSubstituents);
          preAttachedSubstituents.length = 0;
        }
      }

      carbons.push(atom);

      if (lastCarbonIdx >= 0) {
        bonds.push({ i: lastCarbonIdx, j: newIdx, order: pendingBondOrder });
        pendingBondOrder = 1;
      }
      lastCarbonIdx = newIdx;
      state.i++;
      continue;
    }

    if (t.kind === 'substituent') {
      state.i++;    // consume the substituent token
      const subs = _buildSubstituentsFromToken(t, state);
      if (!subs.ok) return subs;

      if (lastCarbonIdx >= 0) {
        carbons[lastCarbonIdx].substituents.push(...subs.list);
      } else {
        // Leading substituent (e.g. ClCH3): stash for the next carbon
        preAttachedSubstituents.push(...subs.list);
      }
      continue;
    }

    // Unknown token — shouldn't happen from our tokenizer
    return { ok: false, error: `Unexpected token type at position ${state.i}.` };
  }

  // End of tokens. Trailing bond marker is an error.
  if (pendingBondOrder !== 1) {
    return { ok: false, error: 'Formula ends with a bond marker but no carbon follows.' };
  }
  if (preAttachedBranches.length > 0) {
    return { ok: false, error: 'Leading paren group has no carbon to attach to.' };
  }
  if (preAttachedSubstituents.length > 0) {
    return { ok: false, error: 'Leading halogen/OH/NH2 group has no carbon to attach to.' };
  }

  return { ok: true, carbons, bonds };
}

// ─────────────────────────────────────────────────────────────────────────────
// Build a substituent for the pre-attached functional groups on CHO, COOH,
// CO, CN, CONH2, CONH, CON tokens. These are attached to the carbon
// automatically by the parser when it emits the carbon group, without
// needing a separate substituent token in the stream.
//
//   carbonyl:       =O (double bond, 2 LP)
//   hydroxyl:       -OH (single bond, 2 LP on O, 1 H)
//   nitrile:        ≡N (triple bond, 1 LP on N, 0 H)
//   aminePrimary:   -NH2 (single bond, 1 LP on N, 2 H)
//   amineSecondary: -NH- (needs 1 R group — handled by parser)
//   amineTertiary:  -N<  (needs 2 R groups — handled by parser)
// ─────────────────────────────────────────────────────────────────────────────
function _buildPreAttachedSubstituent(fgName) {
  if (fgName === 'carbonyl') {
    return {
      symbol:      'O',
      hCount:      0,
      lonePairs:   2,          // O in carbonyl has 2 lone pairs
      attachOrder: 2,          // double bond
      label:       '=O'
    };
  }
  if (fgName === 'hydroxyl') {
    return {
      symbol:      'O',
      hCount:      1,
      lonePairs:   2,
      attachOrder: 1,
      label:       'OH'
    };
  }
  if (fgName === 'nitrile') {
    return {
      symbol:      'N',
      hCount:      0,
      lonePairs:   1,          // N in nitrile has 1 lone pair (6 - 2*bond_pairs, 5-3=2 wait)
      // N has 5 valence. Triple bond (3 shared pairs, 3 bond order) = 6 bonding e⁻.
      // Octet: 8 - 6 = 2 non-bonding e⁻ = 1 lone pair. ✓
      attachOrder: 3,          // triple bond
      label:       '≡N'
    };
  }
  if (fgName === 'aminePrimary') {
    return {
      symbol:      'N',
      hCount:      2,
      lonePairs:   1,
      attachOrder: 1,
      label:       'NH2',
      rBranches:   []
    };
  }
  if (fgName === 'amineSecondary') {
    return {
      symbol:      'N',
      hCount:      1,
      lonePairs:   1,
      attachOrder: 1,
      label:       'NHR',
      // rBranches populated by the parser from following tokens
      rBranches:   null   // sentinel — parser fills this in
    };
  }
  if (fgName === 'amineTertiary') {
    return {
      symbol:      'N',
      hCount:      0,
      lonePairs:   1,
      attachOrder: 1,
      label:       'NRR',
      rBranches:   null   // sentinel — parser fills this in
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the substituent descriptor(s) for a given substituent token.
// For halogen/hydroxyl/aminePrimary this is simple: one substituent per count.
// For amineSecondary/amineTertiary we need to consume following tokens to
// get the R group(s).
// Returns { ok, list: [substituent, ...], error? }.
// ─────────────────────────────────────────────────────────────────────────────
function _buildSubstituentsFromToken(token, state) {
  const list = [];

  if (token.type === 'halogen') {
    for (let k = 0; k < token.count; k++) {
      list.push({
        symbol:      token.symbol,
        hCount:      0,
        lonePairs:   3,          // halogens have 3 LP when singly bonded
        attachOrder: 1,
        label:       token.symbol
      });
    }
    return { ok: true, list };
  }

  if (token.type === 'hydroxyl') {
    for (let k = 0; k < token.count; k++) {
      list.push({
        symbol:      'O',
        hCount:      1,
        lonePairs:   2,
        attachOrder: 1,
        label:       'OH'
      });
    }
    return { ok: true, list };
  }

  if (token.type === 'aminePrimary') {
    list.push({
      symbol:      'N',
      hCount:      2,
      lonePairs:   1,
      attachOrder: 1,
      label:       'NH2',
      rBranches:   []
    });
    return { ok: true, list };
  }

  if (token.type === 'amineSecondary') {
    // NH followed by 1 R group: either a paren-group or a bare carbon group
    const r = _consumeRGroup(state);
    if (!r.ok) return { ok: false, error: `Secondary amine: ${r.error}` };
    list.push({
      symbol:      'N',
      hCount:      1,
      lonePairs:   1,
      attachOrder: 1,
      label:       'NHR',
      rBranches:   [r.branch]
    });
    return { ok: true, list };
  }

  if (token.type === 'amineTertiary') {
    // N followed by 2 R groups
    const r1 = _consumeRGroup(state);
    if (!r1.ok) return { ok: false, error: `Tertiary amine: ${r1.error}` };
    const r2 = _consumeRGroup(state);
    if (!r2.ok) return { ok: false, error: `Tertiary amine: ${r2.error}` };
    list.push({
      symbol:      'N',
      hCount:      0,
      lonePairs:   1,
      attachOrder: 1,
      label:       'NRR',
      rBranches:   [r1.branch, r2.branch]
    });
    return { ok: true, list };
  }

  return { ok: false, error: `Unknown substituent type "${token.type}".` };
}

// ─────────────────────────────────────────────────────────────────────────────
// Consume an R group from the token stream for a secondary/tertiary amine.
// An R group is either:
//   - a parenthesized sub-chain: "(CH3)" or "(CH2CH3)" etc.
//   - a bare carbon group: "CH3" would be consumed as one carbon-group token
//     plus any following carbon-groups if that's meant as an ethyl chain.
//     For simplicity, R groups here must use parens. Bare one-carbon R is
//     accepted as a single carbonGroup token.
// ─────────────────────────────────────────────────────────────────────────────
function _consumeRGroup(state) {
  if (state.i >= state.tokens.length) {
    return { ok: false, error: 'expected R group but formula ended.' };
  }
  const t = state.tokens[state.i];
  if (t.kind === 'openParen') {
    state.i++;    // consume '('
    const sub = _parseSequence(state, /* isBranch */ true);
    if (!sub.ok) return { ok: false, error: sub.error };
    if (state.i >= state.tokens.length || state.tokens[state.i].kind !== 'closeParen') {
      return { ok: false, error: 'mismatched parenthesis in R group.' };
    }
    state.i++;    // consume ')'
    return {
      ok: true,
      branch: {
        carbons: _cloneBranchCarbons(sub.carbons),
        bonds:   sub.bonds.map(b => ({ ...b }))
      }
    };
  }
  if (t.kind === 'carbonGroup') {
    state.i++;
    return {
      ok: true,
      branch: {
        carbons: [{ index: 0, hCount: t.hCount, branches: [], substituents: [] }],
        bonds:   []
      }
    };
  }
  return { ok: false, error: `expected an R group (paren or CH… token), got "${t.kind}".` };
}

// Deep-copy branch carbons so each attached copy is independent
function _cloneBranchCarbons(carbons) {
  return carbons.map(c => ({
    index:        c.index,
    hCount:       c.hCount,
    branches:     (c.branches || []).map(b => ({
      carbons: _cloneBranchCarbons(b.carbons),
      bonds:   b.bonds.map(bb => ({ ...bb }))
    })),
    substituents: (c.substituents || []).map(s => _cloneSubstituent(s))
  }));
}

function _cloneSubstituent(s) {
  const copy = {
    symbol:      s.symbol,
    hCount:      s.hCount,
    lonePairs:   s.lonePairs,
    attachOrder: s.attachOrder,
    label:       s.label
  };
  if (s.rBranches) {
    copy.rBranches = s.rBranches.map(b => ({
      carbons: _cloneBranchCarbons(b.carbons),
      bonds:   b.bonds.map(bb => ({ ...bb }))
    }));
  }
  return copy;
}

// Build a molecular formula (CnHm plus heteroatoms) from the chain structure,
// including all branch and substituent atoms recursively.
function _chainNormalizedFormula(carbons, chainBonds) {
  const counts = {};
  function bump(sym, n) { counts[sym] = (counts[sym] || 0) + n; }
  function countFromCarbons(list) {
    for (const c of list) {
      // Use the atom's actual symbol (C by default, O for ether backbone, etc.)
      bump(c.symbol || 'C', 1);
      bump('H', c.hCount);
      for (const br of (c.branches || [])) {
        countFromCarbons(br.carbons);
      }
      for (const s of (c.substituents || [])) {
        bump(s.symbol, 1);
        if (s.hCount > 0) bump('H', s.hCount);
        for (const br of (s.rBranches || [])) {
          countFromCarbons(br.carbons);
        }
      }
    }
  }
  countFromCarbons(carbons);

  // Conventional order: C, H, then heteroatoms alphabetically
  const order = ['C', 'H'];
  const hetero = Object.keys(counts).filter(s => s !== 'C' && s !== 'H').sort();
  order.push(...hetero);

  return order
    .filter(s => counts[s] > 0)
    .map(s => s + (counts[s] > 1 ? counts[s] : ''))
    .join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Detect whether a raw input string looks like a condensed chain formula.
// Returns true for strings containing explicit chain syntax: multiple
// carbon groups, unsaturation markers, branch parens containing C,
// OR a carbon group with R4a functional-group substituents (halogens,
// OH, NH2/NH/N).
//
// Does NOT catch pure stoichiometric formulas like "C2H6" — those are
// detected separately in formula-parser.js after stoichiometric parsing.
// ─────────────────────────────────────────────────────────────────────────────
function isCondensedChainSyntax(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return false;
  // Strip hyphens before matching (CH3-O-CH3 form)
  const s = rawInput.replace(/[\s\-]/g, '');

  // Unsaturation markers are an unambiguous signal
  if (/[=≡#]/.test(s)) return true;

  // Detection regex: whole string matches only our known tokens. Rejects
  // formulas with unsupported elements (Na, Mg, S alone, P alone, etc.)
  //   Leading H  — for HCHO, HCOOH (textbook formaldehyde/formic acid)
  //   CONH2      — primary amide (check before COOH to avoid mis-matching)
  //   CONH       — secondary amide (needs following R group)
  //   CON        — tertiary amide (needs following 2 R groups)
  //   COOH       — carboxylic acid
  //   CHO        — aldehyde
  //   CN         — nitrile (only valid at end of chain)
  //   CO         — ketone carbonyl (only valid inside longer chain)
  //   C(H\d*)?   — carbon group
  //   Cl, Br, F, I with optional digits — halogens
  //   OH with optional digits — hydroxyl
  //   O          — ether/ester backbone oxygen (R4c-2+)
  //   NH2, NH, N — amines
  //   (, ), =, ≡, #, digits — syntactic
  const allowed = /^H?(?:CONH2|CONH|CON|COOH|CHO|CN|CO|C(?:H\d*)?|Cl\d*|Br\d*|F\d*|I\d*|OH\d*|O|NH2|NH|N|[=≡#()]|\d+)+$/;
  if (!allowed.test(s)) return false;

  // Explicit rejection of simple non-chain formulas that match the regex
  // but are better served by the single-central-atom engine.
  //   CO, CO2 — carbon monoxide/dioxide (NOT chains)
  //   CN alone — cyanide ion contents (handled by polyatomic path elsewhere)
  if (s === 'CO' || s === 'CO2' || s === 'CN') return false;

  // Must have either: (a) branching via parens containing a carbon, or
  // (b) 2+ carbon groups, or (c) at least one carbon group plus a
  // functional-group substituent (halogen, OH, amine), or (d) explicit
  // FG tokens like COOH/CHO/CONH2/CONH/CON/CN anywhere.
  const hasBranchWithCarbon = /\([^()]*C/.test(s);
  const carbonGroupRe = /C(?:H\d*)?/g;
  const carbonGroupCount = (s.match(carbonGroupRe) || []).length;
  const hasSubstituent = /Cl|Br|F|I|OH|NH2|NH|N/.test(s);
  const hasFGToken = /COOH|CHO|CONH2|CONH|CON|CN/.test(s);

  if (hasBranchWithCarbon) return true;
  if (carbonGroupCount >= 2) return true;
  if (carbonGroupCount >= 1 && hasSubstituent) return true;
  if (hasFGToken) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse a condensed structural formula. Public entry point.
// Returns the chain descriptor on success, or {ok:false, error} on failure.
// ─────────────────────────────────────────────────────────────────────────────
function parseCondensedFormula(rawInput) {
  if (!rawInput || typeof rawInput !== 'string' || !rawInput.trim()) {
    return { ok: false, error: 'Empty input.' };
  }
  const tok = _tokenizeCondensed(rawInput);
  if (!tok.ok) return tok;
  return _parseChainFromTokens(tok.tokens, rawInput);
}

// ─────────────────────────────────────────────────────────────────────────────
// Try to interpret a stoichiometric hydrocarbon formula (like C2H6) as a
// straight chain of the given size. Returns a chain descriptor on success.
//
// Detection rules:
//   CnH(2n+2) → alkane, all single bonds
//   CnH(2n)   → alkene: one C=C in the first position
//   CnH(2n-2) → alkyne: one C≡C in the first position
//   n ≥ 2, m even or satisfies one of the formulas above
// ─────────────────────────────────────────────────────────────────────────────
function stoichiometricHydrocarbonToChain(nC, nH, rawInput) {
  if (nC < 2) return { ok: false, error: 'Hydrocarbon chain requires at least 2 carbons.' };
  const expectedAlkane = 2 * nC + 2;
  const expectedAlkene = 2 * nC;
  const expectedAlkyne = 2 * nC - 2;

  let unsaturation = 0;                       // 0 = alkane, 1 = one double, 2 = one triple
  if (nH === expectedAlkane)       unsaturation = 0;
  else if (nH === expectedAlkene)  unsaturation = 1;
  else if (nH === expectedAlkyne)  unsaturation = 2;
  else return { ok: false, error: `C${nC}H${nH} does not match a straight-chain hydrocarbon (alkane CnH${2*nC+2}, alkene CnH${2*nC}, alkyne CnH${2*nC-2}).` };

  // Build carbons with default H counts; the bond at position 0 will take
  // the unsaturation (so ethene is CH2=CH2, ethyne is HC≡CH, etc.)
  const carbons = [];
  for (let k = 0; k < nC; k++) {
    carbons.push({ index: k, hCount: 0, branches: [] });
  }
  const chainBonds = [];
  for (let k = 0; k < nC - 1; k++) {
    chainBonds.push({ i: k, j: k + 1, order: 1 });
  }
  if (unsaturation === 1) chainBonds[0].order = 2;
  if (unsaturation === 2) chainBonds[0].order = 3;

  // Compute H counts per carbon given the backbone bonds.
  // Each carbon has 4 valence; C-C bond order(s) use some; rest go to H.
  for (const c of carbons) {
    let cBondOrderSum = 0;
    for (const b of chainBonds) {
      if (b.i === c.index || b.j === c.index) cBondOrderSum += b.order;
    }
    c.hCount = 4 - cBondOrderSum;
  }

  // Sanity check: total H should equal the input
  const hSum = carbons.reduce((s,c) => s + c.hCount, 0);
  if (hSum !== nH) {
    return { ok: false, error: `Hydrogen count mismatch: computed ${hSum}, expected ${nH}.` };
  }

  return {
    ok:         true,
    kind:       'chain',
    carbons,
    chainBonds,
    charge:     0,
    raw:        rawInput,
    normalizedFormula: `C${nC > 1 ? nC : ''}H${nH > 1 ? nH : ''}`
  };
}
