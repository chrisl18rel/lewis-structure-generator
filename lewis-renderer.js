// lewis-renderer.js
// ─────────────────────────────────────────────────────────────────────────────
// Canvas drawing for completed Lewis structures (covalent molecules,
// polyatomic ions, and ionic compounds). Replaces the Phase 3/4 stub
// renderers that were sitting in lewis-vsepr.js.
//
// Exposes three top-level drawing functions used by the controller:
//   drawCovalentStructure(parse, structure, canvasEl)
//   drawIonicCompound(parse, ionic, canvasEl)
//   drawResonanceCard(parse, structure, canvasEl, opts)   // small card variant
//
// Style goals:
//   • textbook-clean geometry — atom text centered, bonds shortened at both
//     ends so they visibly start/end at the atom's text
//   • lone pairs placed in the most-empty cardinal direction around the atom
//   • formal charges rendered in the ATOM color (not contrasting red) at a
//     small superscript offset, only when non-zero
//   • brackets drawn around ions only, sized to the molecule's real bbox
//   • the drawing uses LV_STATE for colors / sizes / toggle preferences
// ─────────────────────────────────────────────────────────────────────────────

// ── Tunables ────────────────────────────────────────────────────────────────
const LR_ENGINE_BOND_LEN = 120;          // matches lewis-engine.layoutAtoms()
const LR_BASE_BOND_PX    = 110;          // px bond length at zoom=1
const LR_MIN_MARGIN      = 28;           // px padding between structure and canvas edge

// ─────────────────────────────────────────────────────────────────────────────
// Top-level: draw a covalent structure on the main canvas.
// ─────────────────────────────────────────────────────────────────────────────
function drawCovalentStructure(parse, structure, canvasEl) {
  const canvas = canvasEl || document.getElementById('lewis-canvas');
  const ctx    = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const env = computeRenderEnv(canvas, structure);
  drawBonds(ctx, structure, env);
  drawAtomsWithLonePairs(ctx, structure, env);
  drawFormalCharges(ctx, structure, env);
  if (structure.isIon) drawMoleculeBracket(ctx, structure, env);
}

// ─────────────────────────────────────────────────────────────────────────────
// Resonance-card variant. The structure is drawn smaller and without bracket
// repetition — the main card already has the bracket/charge. Optional `opts`
// lets the caller override zoom scaling for crowded strips.
// ─────────────────────────────────────────────────────────────────────────────
function drawResonanceCard(parse, structure, canvasEl, opts = {}) {
  const zoomMul = opts.zoomMul ?? 0.55;
  // Temporarily scale LV_STATE-based sizes down so bond/font/dot are smaller
  const savedZoom = LV_STATE.zoom;
  LV_STATE.zoom = savedZoom * zoomMul;
  try {
    drawCovalentStructure(parse, structure, canvasEl);
  } finally {
    LV_STATE.zoom = savedZoom;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level: draw an ionic compound (multiple independent ions side-by-side).
// ─────────────────────────────────────────────────────────────────────────────
function drawIonicCompound(parse, ionic, canvasEl) {
  const canvas = canvasEl || document.getElementById('lewis-canvas');
  const ctx    = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const zoom   = LV_STATE.zoom;
  const fontPx = LV_STATE.fontSize * zoom;
  const dotPx  = LV_STATE.dotSize  * zoom;

  // Engine layout bbox
  const bbox = computeIonBbox(ionic.ions);

  // Scale to fit — polyatomic ions need ~3x the horizontal footprint of a
  // monatomic ion because they contain an internal Lewis structure.
  const anyPoly = ionic.ions.some(i => i.isPolyatomic);
  const perMonoW = fontPx * 3.6;
  const perPolyW = fontPx * 7.2;
  const footprint = ionic.ions.reduce((sum, i) => sum + (i.isPolyatomic ? perPolyW : perMonoW), 0);
  const neededW = Math.max(bbox.w, footprint);
  const availW  = canvas.width  - LR_MIN_MARGIN * 2;
  const availH  = canvas.height - LR_MIN_MARGIN * 2;
  const minH    = fontPx * (anyPoly ? 5 : 3);
  const scale   = Math.min(availW / neededW, availH / Math.max(bbox.h, minH));

  const cx = canvas.width  / 2 - (bbox.minX + bbox.w / 2) * scale;
  const cy = canvas.height / 2 - (bbox.minY + bbox.h / 2) * scale;

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  for (const ion of ionic.ions) {
    const px = cx + ion.x * scale;
    const py = cy + ion.y * scale;
    if (ion.isPolyatomic) {
      drawPolyatomicIon(ctx, ion, px, py, fontPx, dotPx);
    } else {
      drawSingleIon(ctx, ion, px, py, fontPx, dotPx);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// RENDER-ENVIRONMENT COMPUTATION
// ═════════════════════════════════════════════════════════════════════════════
// Figures out the bond length, atom font size, dot radius, and the transform
// that maps engine coordinates to canvas pixels — all centered and scaled so
// the whole structure fits with padding for lone pairs + brackets.
// ─────────────────────────────────────────────────────────────────────────────
function computeRenderEnv(canvas, structure) {
  const zoom   = LV_STATE.zoom;
  const fontPx = LV_STATE.fontSize * zoom;
  const dotPx  = LV_STATE.dotSize  * zoom;

  // Bond length in pixels (before fit scaling)
  const bondLenPx = LR_BASE_BOND_PX * zoom;

  // Engine coords are centered at (0,0) with ~120 units between central and
  // each terminal. We'll first scale engine→pixels by (bondLenPx / 120), then
  // apply an additional "fit" scale if the resulting structure would exceed
  // the canvas. This keeps zoom predictable while preventing overflow.
  const baseScale = bondLenPx / LR_ENGINE_BOND_LEN;

  // Compute the structure's engine-space bounding box, accounting for:
  //   - lone pairs radiating outside atom text
  //   - ion brackets
  //   - formal-charge superscripts
  const paddingEngine = (fontPx * 2 + dotPx * 2 + (structure.isIon ? fontPx : 0)) / baseScale;
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
  for (const a of structure.atoms) {
    if (a.x < minX) minX = a.x;
    if (a.x > maxX) maxX = a.x;
    if (a.y < minY) minY = a.y;
    if (a.y > maxY) maxY = a.y;
  }
  // Treat a single-atom or degenerate case sanely
  if (!isFinite(minX)) { minX = maxX = 0; minY = maxY = 0; }
  minX -= paddingEngine; maxX += paddingEngine;
  minY -= paddingEngine; maxY += paddingEngine;

  const engW = Math.max(1, maxX - minX);
  const engH = Math.max(1, maxY - minY);

  const availW = canvas.width  - LR_MIN_MARGIN * 2;
  const availH = canvas.height - LR_MIN_MARGIN * 2;
  const fitScale = Math.min(
    availW / (engW * baseScale),
    availH / (engH * baseScale),
    1
  );
  const scale = baseScale * fitScale;

  const cx = canvas.width  / 2 - (minX + engW / 2) * scale;
  const cy = canvas.height / 2 - (minY + engH / 2) * scale;

  return {
    ctx:        canvas.getContext('2d'),
    canvas,
    scale,
    cx, cy,
    fontPx:     fontPx * fitScale,
    dotPx:      dotPx  * fitScale,
    bondLenPx:  bondLenPx * fitScale,
    minX, maxX, minY, maxY,
    // engine→pixel helper
    toPx: (a) => ({ x: cx + a.x * scale, y: cy + a.y * scale })
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// BONDS
// ═════════════════════════════════════════════════════════════════════════════
// Draw each bond. Double and triple bonds are drawn as parallel lines offset
// perpendicular to the bond axis. Both ends are shortened by `atomPad` so
// they visibly end at the atom text, not pass through it.
// ─────────────────────────────────────────────────────────────────────────────
function drawBonds(ctx, structure, env) {
  const { fontPx, dotPx } = env;
  const atomPad   = fontPx * 0.55;                // gap atom-center → bond endpoint
  const bondWidth = Math.max(1.8, 2.0 * LV_STATE.zoom);
  const doubleGap = Math.max(3, fontPx * 0.18);
  const tripleGap = Math.max(3, fontPx * 0.22);

  ctx.strokeStyle = LV_STATE.bondColor;
  ctx.lineWidth   = bondWidth;
  ctx.lineCap     = 'round';

  for (const b of structure.bonds) {
    const A = env.toPx(structure.atoms[b.i]);
    const B = env.toPx(structure.atoms[b.j]);

    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    // Perpendicular unit vector
    const px = -uy, py = ux;

    const ax = A.x + ux * atomPad,  ay = A.y + uy * atomPad;
    const bx = B.x - ux * atomPad,  by = B.y - uy * atomPad;

    const drawLine = (offset) => {
      ctx.beginPath();
      ctx.moveTo(ax + px * offset, ay + py * offset);
      ctx.lineTo(bx + px * offset, by + py * offset);
      ctx.stroke();
    };
    if (b.order === 1) {
      drawLine(0);
    } else if (b.order === 2) {
      drawLine(+doubleGap / 2);
      drawLine(-doubleGap / 2);
    } else {
      drawLine(+tripleGap);
      drawLine(0);
      drawLine(-tripleGap);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ATOMS + LONE PAIRS
// ═════════════════════════════════════════════════════════════════════════════
function drawAtomsWithLonePairs(ctx, structure, env) {
  const { fontPx, dotPx } = env;

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  for (const a of structure.atoms) {
    const P = env.toPx(a);

    // Atom symbol
    ctx.fillStyle = LV_STATE.atomColor;
    ctx.font      = `600 ${fontPx}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(a.symbol, P.x, P.y);

    // Lone pairs
    if (LV_STATE.showLonePairs && a.lonePairs > 0) {
      placeLonePairs(ctx, structure, a, P, env);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lone-pair placement.
//
// Strategy:
//   1. Build a list of "occupied" angles (one per bond incident on this atom).
//   2. Take the four cardinal slots {right, down, left, up}.
//   3. Score each slot by its angular distance from the nearest bond.
//      (Larger distance = emptier = better.)
//   4. Sort slots by score descending and take the top N where N = lonePairs.
//   5. At each chosen slot, draw two dots perpendicular to the radial axis.
//
// This matches how textbooks distribute lone pairs: into the most visually
// empty region around the atom, NOT into the same cardinal slot every time.
// ─────────────────────────────────────────────────────────────────────────────
function placeLonePairs(ctx, structure, atom, P, env) {
  const { fontPx, dotPx } = env;
  const radius  = fontPx * 0.9;              // distance from atom center to dot pair center
  const pairGap = dotPx * 2.6;

  // Occupied (bond) angles from this atom's point of view
  const occupied = [];
  for (const b of structure.bonds) {
    let other = null;
    if (b.i === atom.index) other = structure.atoms[b.j];
    else if (b.j === atom.index) other = structure.atoms[b.i];
    if (!other) continue;
    const dx = other.x - atom.x, dy = other.y - atom.y;
    const L  = Math.hypot(dx, dy) || 1;
    occupied.push(Math.atan2(dy / L, dx / L));
  }

  // Candidate slots: 8 directions (more flexibility than 4 cardinal)
  const CANDIDATES = 8;
  const slots = [];
  for (let k = 0; k < CANDIDATES; k++) {
    const ang = (2 * Math.PI * k) / CANDIDATES - Math.PI / 2;  // start at north
    slots.push(ang);
  }

  // Score each slot by angular distance to nearest bond
  const scored = slots.map(ang => {
    if (occupied.length === 0) return { ang, dist: Math.PI };
    let minD = Math.PI;
    for (const o of occupied) {
      const d = Math.abs(normalizeAngle(ang - o));
      if (d < minD) minD = d;
    }
    return { ang, dist: minD };
  });

  // Sort by (distance desc, then by proximity-to-cardinal so ties prefer N/E/S/W)
  scored.sort((a, b) => {
    if (Math.abs(a.dist - b.dist) > 1e-6) return b.dist - a.dist;
    const aCard = Math.min(
      Math.abs(a.ang), Math.abs(a.ang - Math.PI / 2),
      Math.abs(a.ang + Math.PI / 2), Math.abs(a.ang - Math.PI),
      Math.abs(a.ang + Math.PI)
    );
    const bCard = Math.min(
      Math.abs(b.ang), Math.abs(b.ang - Math.PI / 2),
      Math.abs(b.ang + Math.PI / 2), Math.abs(b.ang - Math.PI),
      Math.abs(b.ang + Math.PI)
    );
    return aCard - bCard;
  });

  // Take up to lonePairs chosen slots. Enforce a minimum angular gap between
  // chosen slots to prevent two pairs landing side-by-side.
  const minSeparation = Math.PI / 4;    // ~45°
  const chosen = [];
  for (const s of scored) {
    if (chosen.length >= atom.lonePairs) break;
    const ok = chosen.every(c => Math.abs(normalizeAngle(s.ang - c.ang)) >= minSeparation);
    if (ok) chosen.push(s);
  }
  // If we still don't have enough slots (very rare — lots of bonds), relax
  while (chosen.length < atom.lonePairs) chosen.push(scored[chosen.length] || scored[0]);

  // Draw
  ctx.fillStyle = LV_STATE.dotColor;
  for (let k = 0; k < atom.lonePairs; k++) {
    const ang = chosen[k].ang;
    const cx  = P.x + Math.cos(ang) * radius;
    const cy  = P.y + Math.sin(ang) * radius;
    // Perpendicular offset so the two dots sit along the tangent
    const ux  = -Math.sin(ang), uy = Math.cos(ang);
    ctx.beginPath();
    ctx.arc(cx + ux * pairGap / 2, cy + uy * pairGap / 2, dotPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - ux * pairGap / 2, cy - uy * pairGap / 2, dotPx, 0, Math.PI * 2);
    ctx.fill();
  }
}

function normalizeAngle(a) {
  while (a >  Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ═════════════════════════════════════════════════════════════════════════════
// FORMAL CHARGES
// ═════════════════════════════════════════════════════════════════════════════
// Rendered as small superscripts up-and-to-the-right of the atom symbol,
// using the atom color (not bright red) for a clean textbook look. Skipped
// entirely when FC is 0 or the user toggled them off.
// ─────────────────────────────────────────────────────────────────────────────
function drawFormalCharges(ctx, structure, env) {
  if (!LV_STATE.showFormalCharges) return;
  const { fontPx } = env;
  const supFont    = `600 ${fontPx * 0.55}px "Segoe UI", system-ui, sans-serif`;
  const supDX      = fontPx * 0.62;
  const supDY      = fontPx * 0.55;

  ctx.fillStyle    = LV_STATE.atomColor;
  ctx.font         = supFont;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';

  for (const a of structure.atoms) {
    if (a.formalCharge === 0) continue;
    const P   = env.toPx(a);
    const txt = formalChargeString(a.formalCharge);
    ctx.fillText(txt, P.x + supDX, P.y - supDY);
  }

  // Restore center baseline
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
}

// ═════════════════════════════════════════════════════════════════════════════
// MOLECULE BRACKET (polyatomic ions)
// ═════════════════════════════════════════════════════════════════════════════
// Wraps the ENTIRE structure (atoms + visible lone pairs + formal charges)
// in a single pair of square brackets, then writes the overall charge
// outside the top-right bracket.
// ─────────────────────────────────────────────────────────────────────────────
function drawMoleculeBracket(ctx, structure, env) {
  const { fontPx, dotPx } = env;

  // Gather the furthest-out pixels we've drawn. Start with atom centers and
  // extend by (font + lone pair radius + formal charge offset).
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
  for (const a of structure.atoms) {
    const P = env.toPx(a);
    if (P.x < minX) minX = P.x;
    if (P.x > maxX) maxX = P.x;
    if (P.y < minY) minY = P.y;
    if (P.y > maxY) maxY = P.y;
  }

  // Margin: extend outward by the largest visible feature at each atom
  const featurePad = fontPx * 1.5 + dotPx * 2;
  const padX = featurePad;
  const padY = featurePad;

  const L = minX - padX, R = maxX + padX;
  const T = minY - padY, B = maxY + padY;
  const tick = Math.min(R - L, B - T) * 0.06;

  ctx.strokeStyle = LV_STATE.atomColor;
  ctx.lineWidth   = Math.max(1.4, 1.5 * LV_STATE.zoom);
  ctx.beginPath();
  ctx.moveTo(L + tick, T); ctx.lineTo(L, T); ctx.lineTo(L, B); ctx.lineTo(L + tick, B);
  ctx.moveTo(R - tick, T); ctx.lineTo(R, T); ctx.lineTo(R, B); ctx.lineTo(R - tick, B);
  ctx.stroke();

  // Overall charge at top-right, outside the bracket
  ctx.fillStyle    = LV_STATE.atomColor;
  ctx.font         = `600 ${fontPx * 0.68}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(chargeString(structure.overallCharge), R + 4, T + fontPx * 0.3);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
}

// ═════════════════════════════════════════════════════════════════════════════
// IONIC COMPOUND RENDERING
// ═════════════════════════════════════════════════════════════════════════════
function computeIonBbox(ions) {
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
  for (const ion of ions) {
    if (ion.x < minX) minX = ion.x;
    if (ion.x > maxX) maxX = ion.x;
    if (ion.y < minY) minY = ion.y;
    if (ion.y > maxY) maxY = ion.y;
  }
  if (!isFinite(minX)) { minX = maxX = 0; minY = maxY = 0; }
  return { minX, maxX, minY, maxY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function drawSingleIon(ctx, ion, px, py, fontPx, dotPx) {
  // Symbol
  ctx.fillStyle = LV_STATE.atomColor;
  ctx.font      = `600 ${fontPx}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ion.symbol, px, py);

  // Dots (anions only — cations have lost all valence)
  if (LV_STATE.showLonePairs && ion.valenceAfterTransfer > 0) {
    drawIonDotsFromArrangement(ctx, ion, px, py, fontPx, dotPx);
  }

  // Tight bracket around this ion's text + dots
  const bracketW = fontPx * (ion.valenceAfterTransfer > 0 ? 2.1 : 1.25);
  const bracketH = fontPx * (ion.valenceAfterTransfer > 0 ? 2.1 : 1.25);
  drawBracketPair(ctx, px, py, bracketW, bracketH);

  // Charge at top-right of bracket
  ctx.fillStyle    = LV_STATE.atomColor;
  ctx.font         = `600 ${fontPx * 0.68}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(chargeString(ion.charge), px + bracketW / 2 + 4, py - bracketH / 2 + fontPx * 0.3);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
}

function drawIonDotsFromArrangement(ctx, ion, px, py, fontPx, dotPx) {
  const radius  = fontPx * 0.85;
  const pairGap = dotPx * 2.6;
  // Slot order in dotArrangement: [N, E, S, W]
  const slotAngles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

  ctx.fillStyle = LV_STATE.dotColor;
  for (let i = 0; i < 4; i++) {
    const count = ion.dotArrangement[i] || 0;
    if (count === 0) continue;
    const ang = slotAngles[i];
    const bx  = px + Math.cos(ang) * radius;
    const by  = py + Math.sin(ang) * radius;
    const ux  = -Math.sin(ang), uy = Math.cos(ang);
    if (count === 1) {
      ctx.beginPath();
      ctx.arc(bx, by, dotPx, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(bx + ux * pairGap / 2, by + uy * pairGap / 2, dotPx, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx - ux * pairGap / 2, by - uy * pairGap / 2, dotPx, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBracketPair(ctx, px, py, width, height) {
  const L = px - width / 2, R = px + width / 2;
  const T = py - height / 2, B = py + height / 2;
  const tick = Math.min(width, height) * 0.18;
  ctx.strokeStyle = LV_STATE.atomColor;
  ctx.lineWidth   = Math.max(1.4, 1.5 * LV_STATE.zoom);
  ctx.beginPath();
  ctx.moveTo(L + tick, T); ctx.lineTo(L, T); ctx.lineTo(L, B); ctx.lineTo(L + tick, B);
  ctx.moveTo(R - tick, T); ctx.lineTo(R, T); ctx.lineTo(R, B); ctx.lineTo(R - tick, B);
  ctx.stroke();
}

// ─────────────────────────────────────────────────────────────────────────────
// Draw a polyatomic ion: its full internal Lewis structure, enclosed in
// square brackets, with the ion's charge at the top-right.
//
// Strategy:
//   1. Draw the internal Lewis structure into an off-screen canvas at a
//      scaled-down font size.
//   2. Stamp that off-screen canvas onto the main canvas centered at
//      (px, py), trimmed to its content bbox.
//   3. Draw square brackets around the stamped region.
//   4. Draw the charge label at top-right.
// ─────────────────────────────────────────────────────────────────────────────
function drawPolyatomicIon(ctx, ion, px, py, fontPx, dotPx) {
  const structure = ion.structure;

  // Size the off-screen canvas: generously sized relative to ion footprint
  const offW = Math.round(fontPx * 6.4);
  const offH = Math.round(fontPx * 4.4);
  const off  = document.createElement('canvas');
  off.width  = offW;
  off.height = offH;

  // Temporarily scale LV_STATE for the inner draw so the polyatomic ion
  // renders proportionally to the outer layout. Save & restore state.
  const savedZoom     = LV_STATE.zoom;
  const savedFontSize = LV_STATE.fontSize;
  const savedDotSize  = LV_STATE.dotSize;
  const innerZoom     = 0.60;
  LV_STATE.zoom       = innerZoom;
  LV_STATE.fontSize   = savedFontSize * (savedZoom / innerZoom) * 0.65;
  LV_STATE.dotSize    = savedDotSize  * (savedZoom / innerZoom) * 0.65;

  try {
    drawCovalentStructure(null, structure, off);
  } finally {
    LV_STATE.zoom     = savedZoom;
    LV_STATE.fontSize = savedFontSize;
    LV_STATE.dotSize  = savedDotSize;
  }

  // Find the painted region bbox on the off-screen canvas
  const trim = _trimCanvasBbox(off);
  if (!trim) {
    // Nothing painted — bail out gracefully
    return;
  }

  // Target draw size on the main canvas — cap width/height so very large
  // polyatomic ions (e.g. acetate) stay legible without exceeding the slot.
  const maxW = fontPx * 5.2;
  const maxH = fontPx * 3.4;
  const drawW = Math.min(trim.w, maxW);
  const drawH = Math.min(trim.h, maxH);

  // Center at (px, py)
  const dstX = px - drawW / 2;
  const dstY = py - drawH / 2;

  // Stamp the trimmed region
  ctx.drawImage(off,
    trim.x, trim.y, trim.w, trim.h,          // src
    dstX, dstY, drawW, drawH);               // dst

  // Brackets around the stamped region
  const bracketW = drawW + fontPx * 0.5;
  const bracketH = drawH + fontPx * 0.4;
  drawBracketPair(ctx, px, py, bracketW, bracketH);

  // Charge at top-right of bracket
  ctx.fillStyle    = LV_STATE.atomColor;
  ctx.font         = `600 ${fontPx * 0.68}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    chargeString(ion.charge),
    px + bracketW / 2 + 4,
    py - bracketH / 2 + fontPx * 0.3
  );
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
}

// ─────────────────────────────────────────────────────────────────────────────
// Find the non-transparent content bbox of a canvas. Returns
// { x, y, w, h } of the painted region, or null if the canvas is empty.
// ─────────────────────────────────────────────────────────────────────────────
function _trimCanvasBbox(canvas) {
  const ctx  = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const alpha = data[(y * canvas.width + x) * 4 + 3];
      if (alpha > 8) {        // tolerate slight anti-alias transparency
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  // Pad slightly so bracket doesn't clip the glyphs
  const pad = 2;
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  const w = Math.min(canvas.width  - x, maxX - minX + 1 + pad * 2);
  const h = Math.min(canvas.height - y, maxY - minY + 1 + pad * 2);
  return { x, y, w, h };
}
