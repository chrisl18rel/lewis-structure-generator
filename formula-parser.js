// formula-parser.js
// ─────────────────────────────────────────────────────────────────────────────
// Parses chemistry formulas with optional charge notations and nested groups.
//
//  Returns:
//   { ok:true, type:'covalent'|'ionic', atoms:[{symbol,count}], charge:Number,
//     raw:String, normalizedFormula:String }
//   { ok:false, error:String }
//
// Charge syntaxes accepted:
//   NH4{+1}  NH4{+}  NH4^+  NH4^+1  NH4+  NH4+1  NH4 1+
//   NO3{-1}  NO3^-   SO4{-2}  SO4^2-  PO4{-3}
//   H2O   (no charge → 0)
//
// Grouping (parentheses and brackets):
//   Ca(OH)2   Mg(NO3)2   Al2(SO4)3   [Cu(NH3)4]Cl2
//
// Ionic vs covalent (per plan):
//   ionic    if formula is exactly one metal + one nonmetal (no charge)
//   covalent otherwise
//   user can override via sidebar bond-type button
// ─────────────────────────────────────────────────────────────────────────────

function parseFormula(rawInput, overrideType /* 'auto'|'covalent'|'ionic' */ = 'auto') {
  if (!rawInput || typeof rawInput !== 'string') {
    return { ok:false, error:'Empty formula.' };
  }
  let s = rawInput.trim();
  if (!s) return { ok:false, error:'Empty formula.' };

  // Normalize subscript digits just in case (₀-₉ → 0-9)
  const subMap = { '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9' };
  s = s.replace(/[₀-₉]/g, ch => subMap[ch] || ch);
  // Normalize superscript digits (⁰-⁹) and ⁺ ⁻
  const supMap = { '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9','⁺':'+','⁻':'-' };
  s = s.replace(/[⁰-⁹⁺⁻]/g, ch => supMap[ch] || ch);

  // ── 1. Extract charge ───────────────────────────────────────────────
  let charge = 0;
  let body   = s;

  // {+1}  {-2}  {+}  {-}
  let m = body.match(/\{\s*([+\-])\s*(\d*)\s*\}\s*$/);
  if (m) {
    const sign = m[1] === '+' ? 1 : -1;
    const mag  = m[2] ? parseInt(m[2],10) : 1;
    charge = sign * mag;
    body = body.slice(0, m.index).trim();
  }
  // ^+  ^-  ^+2  ^-3  ^2+  ^2-
  if (!m) {
    m = body.match(/\^\s*(?:([+\-])(\d*)|(\d+)([+\-]))\s*$/);
    if (m) {
      if (m[1]) {
        const sign = m[1]==='+'?1:-1;
        const mag  = m[2] ? parseInt(m[2],10) : 1;
        charge = sign * mag;
      } else {
        const mag  = parseInt(m[3],10);
        const sign = m[4]==='+'?1:-1;
        charge = sign * mag;
      }
      body = body.slice(0, m.index).trim();
    }
  }
  // Trailing charge patterns we still accept WITHOUT braces / caret:
  //   "NH4+"        → +1   (bare single sign)
  //   "NH4-"        → −1
  //   "NH4+1"       → +1   (sign followed by magnitude)
  //   "NH4-2"       → −2
  //   "SO4 2+"      → +2   (magnitude then sign, REQUIRES a space)
  //   "SO4 2-"      → −2
  // Critical rule: any digit *before* the sign stays part of the formula
  // (it's a subscript). The sign+magnitude pattern takes ONLY the chars
  // from the sign onward.
  if (!m) {
    // Pattern A: sign (+ optional magnitude) at end. Do NOT consume digits before.
    m = body.match(/([+\-])(\d*)\s*$/);
    if (m) {
      const sign = m[1] === '+' ? 1 : -1;
      const mag  = m[2] ? parseInt(m[2],10) : 1;
      charge = sign * mag;
      body   = body.slice(0, m.index).trimEnd();
    }
  }
  if (!m) {
    // Pattern B: explicit space-separated magnitude+sign, e.g. "SO4 2+"
    m = body.match(/\s+(\d+)\s*([+\-])\s*$/);
    if (m) {
      const mag  = parseInt(m[1],10);
      const sign = m[2]==='+'?1:-1;
      charge = sign * mag;
      body = body.slice(0, m.index).trimEnd();
    }
  }

  // ── 2. Tokenize element symbols + counts ──────────────────────────
  // Supports nested groups:  Ca(OH)2, Mg(NO3)2, Al2(SO4)3, [Cu(NH3)4]Cl2
  // Both ( ) and [ ] are accepted as grouping characters.
  const bodyClean = body.replace(/\s+/g, '');
  if (!bodyClean) return { ok:false, error:'No formula body found.' };

  // ── 2a. Chain-syntax short-circuit ────────────────────────────────
  // If the body looks like a condensed structural formula (CH3CH3,
  // CH2=CH2, CH≡CH, etc.) AND charge is 0, route to the chain parser.
  // Chains in ionic or charged context are out of R3 scope.
  if (charge === 0 &&
      typeof isCondensedChainSyntax === 'function' &&
      isCondensedChainSyntax(bodyClean)) {
    const chainParsed = parseCondensedFormula(bodyClean);
    if (chainParsed.ok) {
      // Wrap the chain descriptor in the shape that downstream code
      // expects (type='covalent', atoms array for compatibility, etc.)
      return _wrapChainAsParsedFormula(chainParsed, rawInput);
    }
    // If the chain parser fails, fall through to stoichiometric — the
    // input may have looked chain-like but been something else.
  }

  const parseResult = _parseFormulaBody(bodyClean, 0);
  if (!parseResult.ok) return { ok:false, error: parseResult.error };
  if (parseResult.endIndex !== bodyClean.length) {
    return { ok:false, error:`Unparsed trailing input: "${bodyClean.slice(parseResult.endIndex)}"` };
  }
  const rawAtoms = parseResult.atoms;

  // ── 3. Merge duplicate symbols (CH3CH3 → C2H6) ─────────────────────
  const merged = {};
  const order  = [];
  for (const a of rawAtoms) {
    if (merged[a.symbol] === undefined) { merged[a.symbol] = 0; order.push(a.symbol); }
    merged[a.symbol] += a.count;
  }
  const atoms = order.map(sym => ({ symbol: sym, count: merged[sym] }));

  // ── 4. Decide ionic vs covalent ────────────────────────────────────
  let type;
  if (overrideType === 'covalent') type = 'covalent';
  else if (overrideType === 'ionic') type = 'ionic';
  else {
    // Auto rules:
    //  - any non-zero charge      → covalent (polyatomic ion)
    //  - contains a known polyatomic ion (e.g. NH4, OH, NO3, SO4, PO4, CO3,
    //    ClO3, etc.) AND a metal → ionic. This covers Ca(OH)2, (NH4)2SO4,
    //    Mg(NO3)2, Al2(SO4)3, NaHCO3, K3PO4, etc.
    //  - exactly 2 distinct elements, one metal one nonmetal, neutral → ionic
    //  - otherwise                 → covalent
    const hasPolyatomicIon = _bodyContainsKnownPolyatomicIon(bodyClean);
    const hasMetal         = atoms.some(a => isMetal(a.symbol));
    // Cationic polyatomic ions (NH4+, H3O+) play the "metal" role for
    // ionic-compound auto-detection: (NH4)2SO4 is an ionic salt.
    const hasCationicPoly  = _bodyContainsCationicPolyatomicIon(bodyClean);

    if (charge !== 0) {
      type = 'covalent';
    } else if (hasPolyatomicIon && (hasMetal || hasCationicPoly)) {
      type = 'ionic';
    } else if (atoms.length === 2) {
      const a = atoms[0], b = atoms[1];
      if ((isMetal(a.symbol) && isNonmetal(b.symbol)) ||
          (isMetal(b.symbol) && isNonmetal(a.symbol))) {
        type = 'ionic';
      } else {
        type = 'covalent';
      }
    } else {
      type = 'covalent';
    }
  }

  // ── 4a. Stoichiometric hydrocarbon → chain ────────────────────────
  // If the input is covalent, neutral, and pure CnHm with n ≥ 2 matching
  // a straight-chain hydrocarbon pattern (alkane, alkene, alkyne), route
  // to the chain parser so we get correct structure rather than a
  // single-central-atom build that can't support chains.
  //
  // CH4 (n=1) stays on the regular covalent path — it's a single-
  // central-atom molecule.
  if (charge === 0 && type === 'covalent' && atoms.length === 2 &&
      typeof stoichiometricHydrocarbonToChain === 'function') {
    const cGroup = atoms.find(a => a.symbol === 'C');
    const hGroup = atoms.find(a => a.symbol === 'H');
    if (cGroup && hGroup && atoms.length === 2 && cGroup.count >= 2) {
      const chainAttempt = stoichiometricHydrocarbonToChain(cGroup.count, hGroup.count, rawInput);
      if (chainAttempt.ok) {
        return _wrapChainAsParsedFormula(chainAttempt, rawInput);
      }
      // If it doesn't match any chain pattern, fall through to covalent
      // (e.g. C2H8 would fail validation; the Lewis engine will then
      // give its own error.)
    }
  }

  // ── 4b. Bounce multi-carbon organic formulas with heteroatoms ─────
  // The flat Lewis engine assumes a single central atom surrounded by
  // terminals. Formulas like C6H12O6 (glucose), C2H6O (ethanol typed
  // as a stoichiometric formula), or CH3COOH typed as C2H4O2 fall
  // outside that model and would render as a meaningless single-C
  // starburst with all 24 atoms radiating outward.
  //
  // Pure CnHm formulas were already routed above. Anything left with
  // ≥2 carbons AND a non-C, non-H atom needs either a condensed
  // structural formula (e.g., CH3CH2OH) or the Ring Structures tab
  // (which supports glucose by name). Surface a clear message instead
  // of letting the user hit the starburst.
  if (charge === 0 && type === 'covalent') {
    const cGroup = atoms.find(a => a.symbol === 'C');
    const hasHeteroatom = atoms.some(a => a.symbol !== 'C' && a.symbol !== 'H');
    if (cGroup && cGroup.count >= 2 && hasHeteroatom) {
      return {
        ok: false,
        error:
          'Multi-carbon organic formulas need a condensed structural form ' +
          '(e.g. CH3CH2OH for ethanol, CH3COOH for acetic acid) or the ' +
          'Ring Structures tab. For sugars, switch to Ring Structures and ' +
          'type the name (e.g. "glucose", "alpha-glucose").'
      };
    }
  }

  // ── 5. Normalized string (for display) ────────────────────────────
  const normalizedFormula =
    atoms.map(a => a.symbol + (a.count > 1 ? a.count : '')).join('') +
    (charge !== 0
      ? (charge > 0 ? `^+${charge}` : `^-${Math.abs(charge)}`)
      : '');

  // ── 6. Extract top-level units (polyatomic-ion support) ───────────
  // Parses the body again, this time preserving group boundaries so the
  // ionic engine can identify polyatomic ions like (OH), (NO3), (NH4).
  //
  // Each top-level unit is either:
  //   { kind: 'atom',       symbol, count }   — bare element outside any group
  //   { kind: 'polyatomic', formula, count, ionData? }
  //                                           — parenthesized group; ionData
  //                                             is populated if it matches a
  //                                             known polyatomic ion
  //
  // IMPORTANT: for covalent molecular compounds (SO3, CO2, P2O5), the
  // greedy polyatomic matcher in _extractTopLevelUnits can produce false
  // positives — SO3 matches sulfite (SO3²⁻), CO2 may match peroxide (O2).
  // These aren't ionic compounds, so we flatten any polyatomic units back
  // into plain atoms when (a) the final type is covalent AND (b) the raw
  // body has no parentheses (so the user didn't actually write a group).
  let units = _extractTopLevelUnits(bodyClean);
  const hasParens = /[(\[]/.test(bodyClean);
  if (type === 'covalent' && !hasParens) {
    units = _flattenUnits(units);
  }

  return {
    ok: true,
    type,
    atoms,
    units,
    charge,
    raw: rawInput,
    normalizedFormula
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tokenize a formula body into element-boundary positions. Returns an
// array of { start, end, kind, text } where kind is 'element', 'digits',
// 'openGroup', 'closeGroup'. Element boundaries are the positions we care
// about when scanning for polyatomic-ion substrings.
// ─────────────────────────────────────────────────────────────────────────────
function _boundaryTokens(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '(' || ch === '[') { out.push({start:i,end:i+1,kind:'openGroup'}); i++; continue; }
    if (ch === ')' || ch === ']') { out.push({start:i,end:i+1,kind:'closeGroup'}); i++; continue; }
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[0-9]/.test(s[j])) j++;
      out.push({start:i,end:j,kind:'digits',text:s.slice(i,j)});
      i = j; continue;
    }
    if (/[A-Z]/.test(ch)) {
      let j = i + 1;
      if (j < s.length && /[a-z]/.test(s[j])) j++;
      out.push({start:i,end:j,kind:'element',text:s.slice(i,j)});
      i = j; continue;
    }
    i++;    // skip unknown
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// True if the formula body contains a cationic polyatomic ion (NH4+, H3O+).
// ─────────────────────────────────────────────────────────────────────────────
function _bodyContainsCationicPolyatomicIon(s) {
  if (typeof lookupPolyatomicIon !== 'function') return false;

  // Check parenthesized groups first
  const groupRe = /[(\[]([^()\[\]]+)[)\]]/g;
  let m;
  while ((m = groupRe.exec(s)) !== null) {
    const ion = lookupPolyatomicIon(m[1]);
    if (ion && ion.charge > 0) return true;
  }

  // Check unparenthesized: scan boundary token positions
  return _scanBoundariesForIon(s, ion => ion.charge > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick scan: does the formula body contain at least one polyatomic ion?
// Checks both parenthesized groups (Ca(OH)2) and unparenthesized tails
// (NaHCO3, K3PO4, Na2SO4 — where the ion is written without parens because
// its multiplier is 1). Used for auto-detection of ionic compounds.
// ─────────────────────────────────────────────────────────────────────────────
function _bodyContainsKnownPolyatomicIon(s) {
  if (typeof lookupPolyatomicIon !== 'function') return false;

  // 1. Parenthesized / bracketed groups (supports multiplier)
  const groupRe = /[(\[]([^()\[\]]+)[)\]]/g;
  let m;
  while ((m = groupRe.exec(s)) !== null) {
    if (lookupPolyatomicIon(m[1])) return true;
  }

  // 2. Unparenthesized: scan at element boundaries
  return _scanBoundariesForIon(s, () => true);
}

// Shared scan: walk boundary tokens, try to match polyatomic ion keys at
// each element-token start position. `predicate` filters which ions count.
function _scanBoundariesForIon(s, predicate) {
  if (typeof knownPolyatomicIonKeys !== 'function') return false;
  const tokens = _boundaryTokens(s);
  const keys = knownPolyatomicIonKeys().slice().sort((a,b) => b.length - a.length);

  // Build concatenation string of each possible "token-aligned tail"
  for (let ti = 0; ti < tokens.length; ti++) {
    if (tokens[ti].kind !== 'element') continue;
    const startAt = tokens[ti].start;
    // For each key, see if the substring starting at `startAt` equals the key
    // AND either (a) ends at a natural token boundary (digits, open-group,
    // end-of-string, or close-bracket) — avoids partial matches like
    // "CO3" inside "CO32" (which would be CO₃ followed by the digit "2"...
    // which is actually what we want). Check that the char just AFTER the
    // key match is NOT a lowercase letter (which would make it part of
    // another element symbol).
    for (const key of keys) {
      if (s.slice(startAt, startAt + key.length) !== key) continue;
      const afterIdx = startAt + key.length;
      const afterCh  = s[afterIdx] || '';
      if (/[a-z]/.test(afterCh)) continue;   // partial match inside an element name
      const ion = lookupPolyatomicIon(key);
      if (ion && predicate(ion)) return true;
    }
  }
  return false;
}
// ─────────────────────────────────────────────────────────────────────────────
// Walk the top-level structure of a formula body, returning an array of
// units (atoms or parenthesized groups / recognized polyatomic ions).
//
// Does NOT recurse into groups for further decomposition — each group is
// treated as one "unit" at this level. Greedy-matches known polyatomic
// ions at element boundaries even without parentheses, so NaHCO3 splits
// into [Na, HCO3] and K3PO4 splits into [K3, PO4].
// ─────────────────────────────────────────────────────────────────────────────
function _extractTopLevelUnits(s) {
  const units = [];
  const hasPoly = typeof knownPolyatomicIonKeys === 'function';
  const polyKeys = hasPoly
    ? knownPolyatomicIonKeys().slice().sort((a,b) => b.length - a.length)
    : [];

  let i = 0;
  while (i < s.length) {
    const ch = s[i];

    // Parenthesized group
    if (ch === '(' || ch === '[') {
      const openCh  = ch;
      const closeCh = ch === '(' ? ')' : ']';
      let depth = 1;
      let j = i + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === openCh) depth++;
        else if (s[j] === closeCh) depth--;
        if (depth > 0) j++;
      }
      if (depth !== 0) break;
      const inner = s.slice(i + 1, j);
      i = j + 1;
      let mult = 1;
      const num = s.slice(i).match(/^\d+/);
      if (num) { mult = parseInt(num[0], 10); i += num[0].length; }
      const ionData = hasPoly ? lookupPolyatomicIon(inner) : null;
      units.push({ kind: 'polyatomic', formula: inner, count: mult, ionData });
      continue;
    }

    // Element symbol — FIRST check if an unparenthesized polyatomic key
    // starts here. Greedy on length; only accept if the match ends at a
    // valid boundary (end-of-string, digit, or open-bracket).
    if (/[A-Z]/.test(ch)) {
      let matchedPoly = null;
      for (const key of polyKeys) {
        if (s.slice(i, i + key.length) !== key) continue;
        const afterCh = s[i + key.length] || '';
        if (/[a-z]/.test(afterCh)) continue;   // lowercase follow means we're mid-element
        matchedPoly = key;
        break;
      }
      if (matchedPoly) {
        i += matchedPoly.length;
        let mult = 1;
        const num = s.slice(i).match(/^\d+/);
        if (num) { mult = parseInt(num[0], 10); i += num[0].length; }
        units.push({
          kind:    'polyatomic',
          formula: matchedPoly,
          count:   mult,
          ionData: lookupPolyatomicIon(matchedPoly)
        });
        continue;
      }

      // Fallback: single element atom
      let sym = ch;
      let j = i + 1;
      if (j < s.length && /[a-z]/.test(s[j])) { sym += s[j]; j++; }
      let count = 1;
      const num = s.slice(j).match(/^\d+/);
      if (num) { count = parseInt(num[0], 10); j += num[0].length; }
      units.push({ kind: 'atom', symbol: sym, count });
      i = j;
      continue;
    }

    i++;
  }
  return units;
}

// ── Utility: pretty print charge as a superscript-ready string ────────────
function chargeString(charge) {
  if (!charge) return '';
  const mag  = Math.abs(charge);
  const sign = charge > 0 ? '+' : '−';
  return mag === 1 ? sign + '1' : sign + mag;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recursive-descent parser for formula body (no charge — that's already stripped).
//
// Grammar:
//   formula  := ( group | atom )+
//   group    := '(' formula ')' digits?    |    '[' formula ']' digits?
//   atom     := ElementSymbol digits?
//
// Returns:
//   { ok:true,  atoms:[{symbol,count}], endIndex:Number }
//   { ok:false, error:String }
//
// Atoms returned as a flat list WITH duplicates allowed; caller merges them.
// ─────────────────────────────────────────────────────────────────────────────
function _parseFormulaBody(s, startIndex, depth = 0) {
  if (depth > 8) return { ok:false, error:'Formula nesting too deep.' };

  const atoms = [];
  let i = startIndex;

  while (i < s.length) {
    const ch = s[i];

    // Close a group → hand control back to caller
    if (ch === ')' || ch === ']') {
      return { ok:true, atoms, endIndex:i };
    }

    // Open a group
    if (ch === '(' || ch === '[') {
      const closer = ch === '(' ? ')' : ']';
      const inner  = _parseFormulaBody(s, i + 1, depth + 1);
      if (!inner.ok) return inner;
      if (s[inner.endIndex] !== closer) {
        return { ok:false,
          error: `Mismatched bracket — expected "${closer}" at position ${inner.endIndex}.` };
      }
      if (inner.atoms.length === 0) {
        return { ok:false, error:`Empty group at position ${i}.` };
      }
      i = inner.endIndex + 1;

      // Optional multiplier after the closing bracket
      let mult = 1;
      const numMatch = s.slice(i).match(/^\d+/);
      if (numMatch) {
        mult = parseInt(numMatch[0], 10);
        if (mult < 1) return { ok:false, error:'Group multiplier cannot be zero.' };
        i += numMatch[0].length;
      }
      for (const a of inner.atoms) {
        atoms.push({ symbol: a.symbol, count: a.count * mult });
      }
      continue;
    }

    // Element symbol: uppercase letter + optional lowercase
    if (/[A-Z]/.test(ch)) {
      let sym = ch;
      if (i + 1 < s.length && /[a-z]/.test(s[i + 1])) {
        sym += s[i + 1];
        i += 2;
      } else {
        i += 1;
      }
      if (!isKnownElement(sym)) {
        return { ok:false, error:`Unknown element: "${sym}"` };
      }
      // Optional subscript
      let count = 1;
      const numMatch = s.slice(i).match(/^\d+/);
      if (numMatch) {
        count = parseInt(numMatch[0], 10);
        if (count < 1) return { ok:false, error:`Subscript on ${sym} cannot be zero.` };
        i += numMatch[0].length;
      }
      atoms.push({ symbol: sym, count });
      continue;
    }

    // Anything else is a parse error
    return { ok:false, error:`Unexpected character "${ch}" at position ${i}.` };
  }

  return { ok:true, atoms, endIndex:i };
}


// ─────────────────────────────────────────────────────────────────────────────
// Flatten any polyatomic units back into their constituent atoms. Used for
// covalent molecular compounds (SO3, CO2) where the greedy polyatomic
// matcher produced a false-positive group match that shouldn't propagate.
// ─────────────────────────────────────────────────────────────────────────────
function _flattenUnits(units) {
  const out = [];
  for (const u of units) {
    if (u.kind === 'atom') { out.push(u); continue; }
    // Polyatomic — parse its inner formula as plain atoms
    const sub = _parseFormulaBody(u.formula, 0);
    if (!sub.ok) { out.push(u); continue; }      // fall back to original unit on failure
    for (const a of sub.atoms) {
      out.push({ kind: 'atom', symbol: a.symbol, count: a.count * u.count });
    }
  }
  // Merge adjacent same-symbol atoms
  const merged = [];
  for (const u of out) {
    const last = merged[merged.length - 1];
    if (last && last.kind === 'atom' && last.symbol === u.symbol) {
      last.count += u.count;
    } else {
      merged.push({ ...u });
    }
  }
  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wrap a chain descriptor (from condensed-formula-parser.js or
// stoichiometricHydrocarbonToChain) in the shape the rest of the
// pipeline expects from parseFormula. This keeps chain handling
// transparent to callers that only check `type` and `atoms`.
// ─────────────────────────────────────────────────────────────────────────────
function _wrapChainAsParsedFormula(chainDesc, rawInput) {
  // Build atoms[] in the same "symbol + count" format other callers expect
  const cCount = chainDesc.carbons.length;
  let hCount = 0;
  for (const c of chainDesc.carbons) hCount += c.hCount;
  const atomsByGroup = [];
  if (cCount > 0) atomsByGroup.push({ symbol: 'C', count: cCount });
  if (hCount > 0) atomsByGroup.push({ symbol: 'H', count: hCount });

  // Units — treat each carbon-group as an atom unit; mainly for display
  const units = atomsByGroup.map(a => ({ kind: 'atom', symbol: a.symbol, count: a.count }));

  return {
    ok:                true,
    type:              'covalent',
    atoms:             atomsByGroup,
    units,
    charge:            chainDesc.charge || 0,
    raw:               rawInput,
    normalizedFormula: chainDesc.normalizedFormula,
    // Chain-specific fields for downstream engines
    isChainInput:      true,
    chainDescriptor:   chainDesc
  };
}
