// vsepr-renderer.js
// ─────────────────────────────────────────────────────────────────────────────
// Draws the molecular geometry on its own canvas using the wedge/dash
// perspective convention from Chris's notes (image 5):
//
//   Solid line   = bond in the plane of the page
//   Solid wedge  = bond coming forward, out of the page (thick end at far atom)
//   Dashed wedge = bond going back, into the page
//   Double/triple bonds = parallel solid lines
//
// Lone pairs on the central atom appear as small dot-pair "ears" in the
// empty position(s) implied by the shape.
//
// Each shape has a hardcoded layout (slot list + perspective labels). This
// gives a cleaner textbook result than any auto-perspective scheme.
//
// Entry points:
//   drawVSEPRGeometry(parse, structure, vsepr, canvasEl)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// SHAPE LAYOUTS
// Each shape defines: [
//   { angle (radians), kind: 'plane'|'wedge'|'dash'|'lone', len: 1.0 = full length }
// ]
// Angles are measured in standard math convention (0 = east, counter-clockwise).
// Lone pairs on the central atom carry kind:'lone' — treated as positional
// slots, not drawn as bonds.
// ─────────────────────────────────────────────────────────────────────────────
const VSEPR_LAYOUTS = {

  // AX — diatomic, we draw the single bond horizontally
  'AX':    [ { angle: 0,                kind:'plane' } ],

  // AX₂ — linear
  'AX₂':   [ { angle: Math.PI,          kind:'plane' },
             { angle: 0,                kind:'plane' } ],

  // AXE — linear (diatomic-ish with one lone pair)
  'AXE':   [ { angle: 0,                kind:'plane' },
             { angle: Math.PI,          kind:'lone'  } ],

  // AX₃ — trigonal planar (all in plane, 120° apart, symmetric about vertical)
  'AX₃':   [ { angle: -Math.PI/2,       kind:'plane' },
             { angle:  Math.PI/6,       kind:'plane' },
             { angle:  5*Math.PI/6,     kind:'plane' } ],

  // AX₂E — bent (120°) — trigonal-planar minus one bond
  'AX₂E':  [ { angle: -Math.PI/2,       kind:'plane' },
             { angle:  Math.PI/6,       kind:'plane' },
             { angle:  5*Math.PI/6,     kind:'lone'  } ],

  // AXE₂ — linear (triatomic with 2 LP)
  'AXE₂':  [ { angle: 0,                kind:'plane' },
             { angle: Math.PI/2,        kind:'lone'  },
             { angle: -Math.PI/2,       kind:'lone'  } ],

  // AX₄ — tetrahedral (2 in-plane, 1 wedge, 1 dash)
  'AX₄':   [ { angle: -Math.PI*5/6,     kind:'plane' },   // top-left
             { angle: -Math.PI/6,       kind:'plane' },   // top-right
             { angle:  Math.PI/2 - 0.4, kind:'wedge' },   // forward, down-right
             { angle:  Math.PI/2 + 0.4, kind:'dash'  } ], // back, down-left

  // AX₃E — trigonal pyramidal (1 in-plane, 1 wedge, 1 dash, 1 lone pair up)
  'AX₃E':  [ { angle:  Math.PI,         kind:'plane' },   // left, in-plane
             { angle:  Math.PI/3,       kind:'wedge' },   // down-right forward
             { angle:  2*Math.PI/3,     kind:'dash'  },   // down-left back
             { angle: -Math.PI/2,       kind:'lone'  } ], // top: lone pair

  // AX₂E₂ — bent (109.5°) — two lone pairs visually "above" the atom
  'AX₂E₂': [ { angle:  Math.PI/2 - 0.6, kind:'plane' },   // down-right
             { angle:  Math.PI/2 + 0.6, kind:'plane' },   // down-left
             { angle: -Math.PI/2 - 0.3, kind:'lone'  },   // upper-left lone
             { angle: -Math.PI/2 + 0.3, kind:'lone'  } ], // upper-right lone

  // AXE₃ — linear with 3 LP (rare: HF with hyperlone scaffold; not common HS)
  'AXE₃':  [ { angle: 0,                kind:'plane' },
             { angle:  Math.PI*2/3,     kind:'lone'  },
             { angle:  Math.PI,         kind:'lone'  },
             { angle: -Math.PI*2/3,     kind:'lone'  } ],

  // AX₅ — trigonal bipyramidal (axial + equatorial)
  'AX₅':   [ { angle: -Math.PI/2,       kind:'plane' },   // top axial
             { angle:  Math.PI/2,       kind:'plane' },   // bottom axial
             { angle:  0,               kind:'wedge', len: 0.85 },   // forward-right
             { angle:  Math.PI*2/3,     kind:'plane', len: 0.85 },   // back-left
             { angle: -Math.PI*2/3,     kind:'plane', len: 0.85 } ], // back-right (mirror)

  // AX₄E — see-saw (trigonal-bipyramid minus one equatorial bond)
  'AX₄E':  [ { angle: -Math.PI/2,       kind:'plane' },   // top axial
             { angle:  Math.PI/2,       kind:'plane' },   // bottom axial
             { angle:  Math.PI/6,       kind:'wedge', len: 0.85 },   // forward-right
             { angle:  Math.PI - Math.PI/6, kind:'dash',  len: 0.85 }, // back-left
             { angle:  0,               kind:'lone' } ],  // the "missing" equatorial

  // AX₃E₂ — T-shape
  'AX₃E₂': [ { angle: -Math.PI/2,       kind:'plane' },   // top axial
             { angle:  Math.PI/2,       kind:'plane' },   // bottom axial
             { angle:  0,               kind:'plane' },   // one equatorial
             { angle:  Math.PI/2 + 0.6, kind:'lone' },    // two LPs in other equatorials
             { angle:  Math.PI/2 - 0.6 + Math.PI, kind:'lone' } ],

  // AX₂E₃ — linear (XeF₂)
  'AX₂E₃': [ { angle: -Math.PI/2,       kind:'plane' },
             { angle:  Math.PI/2,       kind:'plane' },
             { angle:  0,               kind:'lone'  },
             { angle:  Math.PI*2/3,     kind:'lone'  },
             { angle: -Math.PI*2/3,     kind:'lone'  } ],

  // AX₆ — octahedral (4 in plane of page + 1 wedge + 1 dash)
  'AX₆':   [ { angle: -Math.PI/2,       kind:'plane' },   // top
             { angle:  Math.PI/2,       kind:'plane' },   // bottom
             { angle:  Math.PI,         kind:'plane' },   // left
             { angle:  0,               kind:'plane' },   // right
             { angle: -Math.PI/4,       kind:'wedge', len: 0.7 },  // forward (up-right)
             { angle:  3*Math.PI/4,     kind:'dash',  len: 0.7 } ], // back (down-left)

  // AX₅E — square pyramidal
  'AX₅E':  [ { angle: -Math.PI/2,       kind:'plane' },   // top axial (apex)
             { angle:  Math.PI,         kind:'plane' },   // left equatorial
             { angle:  0,               kind:'plane' },   // right equatorial
             { angle:  Math.PI/2 - 0.3, kind:'wedge', len: 0.85 },  // forward
             { angle:  Math.PI/2 + 0.3, kind:'dash',  len: 0.85 },  // back
             { angle:  Math.PI/2,       kind:'lone' } ],  // bottom lone

  // AX₄E₂ — square planar (4 bonds in plane, 2 LPs above/below)
  'AX₄E₂': [ { angle: -Math.PI/2,       kind:'plane' },
             { angle:  Math.PI/2,       kind:'plane' },
             { angle:  Math.PI,         kind:'plane' },
             { angle:  0,               kind:'plane' },
             { angle: -Math.PI/4,       kind:'lone'  },   // LP wedge slot (forward)
             { angle:  3*Math.PI/4,     kind:'lone'  } ]  // LP dash slot (back)
};

// ─────────────────────────────────────────────────────────────────────────────
// Top-level draw function.
// ─────────────────────────────────────────────────────────────────────────────
function drawVSEPRGeometry(parse, structure, vsepr, canvasEl) {
  const wrap   = document.getElementById('vsepr-canvas-wrap-outer');
  const canvas = canvasEl || document.getElementById('vsepr-canvas');
  const ctx    = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Hide the whole canvas wrapper when not applicable
  if (!vsepr || !vsepr.ok || !vsepr.applicable) {
    if (wrap) wrap.style.display = 'none';
    return;
  }
  if (wrap) wrap.style.display = '';

  // Chain: delegate to a per-carbon row-layout renderer
  if (vsepr.isChain) {
    drawChainVSEPRGeometry(ctx, canvas, structure, vsepr);
    return;
  }

  // Ring: delegate to the same per-atom row-layout renderer (chain and ring
  // both produce a perCarbon array of per-atom hybridization summaries).
  if (vsepr.isRing) {
    drawChainVSEPRGeometry(ctx, canvas, structure, vsepr);
    return;
  }

  const layout = VSEPR_LAYOUTS[vsepr.axeNotation];
  if (!layout) {
    // Unknown AXE — fall back to a plain "shape name" label
    drawFallback(ctx, canvas, vsepr);
    return;
  }

  // Build a list of DRAWABLE slots by pairing each layout entry with a bonded
  // atom (kind !== 'lone') or leaving it as a lone pair visual.
  // Covalent structure bonded-atom list comes from structure.bonds:
  const centralAtom = structure.atoms.find(a => a.isCentral);

  // Bonded atoms with their bond orders
  const bondedList = [];
  for (const b of structure.bonds) {
    if (b.i === centralAtom.index) {
      bondedList.push({ atom: structure.atoms[b.j], order: b.order });
    } else if (b.j === centralAtom.index) {
      bondedList.push({ atom: structure.atoms[b.i], order: b.order });
    }
  }

  // Sort bonded atoms by electronegativity DESC so higher-EN atoms go into
  // earlier slots — gives a consistent, pleasant layout for most molecules.
  bondedList.sort((a, b) => {
    const ea = electronegativityOf(a.atom.symbol) ?? 0;
    const eb = electronegativityOf(b.atom.symbol) ?? 0;
    return eb - ea;
  });

  // Assign atoms to non-'lone' layout slots in order
  const boundSlots = layout.filter(s => s.kind !== 'lone');
  const loneSlots  = layout.filter(s => s.kind === 'lone');
  const slots = [];
  let boundIdx = 0;
  for (const s of layout) {
    if (s.kind === 'lone') {
      slots.push({ ...s, atom: null, order: 0 });
    } else {
      const binding = bondedList[boundIdx++];
      // This can occasionally be undefined if layout has more bound slots
      // than the molecule has bonds (shouldn't happen if table is correct).
      slots.push({
        ...s,
        atom:  binding ? binding.atom  : null,
        order: binding ? binding.order : 0
      });
    }
  }

  drawLayout(ctx, canvas, centralAtom, slots, vsepr);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main layout render. Draws, in order:
//   1. Bonds (plane + wedge + dash) with double/triple multiplicity
//   2. Terminal atom symbols (including lone pairs on terminal atoms)
//   3. Central atom symbol on top
//   4. Lone-pair "ears" on the central atom
//   5. Shape label + bond angle below
// ─────────────────────────────────────────────────────────────────────────────
function drawLayout(ctx, canvas, centralAtom, slots, vsepr) {
  const zoom    = LV_STATE.zoom;
  const fontPx  = LV_STATE.fontSize * zoom;
  const dotPx   = LV_STATE.dotSize  * zoom;

  // Choose a bond length that fits the canvas comfortably
  const padding = fontPx * 2.5 + 28;
  const avail   = Math.min(canvas.width, canvas.height) - padding * 2;
  const bondLen = Math.min(160 * zoom, avail / 2);

  const cx = canvas.width  / 2;
  const cy = canvas.height / 2 - fontPx * 0.6;   // leave room for label

  // ── 1. Bonds ────────────────────────────────────────────────────
  ctx.strokeStyle = LV_STATE.bondColor;
  ctx.fillStyle   = LV_STATE.bondColor;
  ctx.lineCap     = 'round';
  const baseLineW = Math.max(1.8, 2.0 * zoom);
  ctx.lineWidth   = baseLineW;

  for (const s of slots) {
    if (s.kind === 'lone' || !s.atom) continue;
    const L    = bondLen * (s.len || 1);
    const ex   = cx + Math.cos(s.angle) * L;
    const ey   = cy + Math.sin(s.angle) * L;
    // Shorten both ends so line visibly ends at atom text
    const atomPad = fontPx * 0.55;
    const ux = Math.cos(s.angle), uy = Math.sin(s.angle);
    const ax = cx + ux * atomPad,  ay = cy + uy * atomPad;
    const bx = ex - ux * atomPad,  by = ey - uy * atomPad;
    drawBond(ctx, ax, ay, bx, by, s.kind, s.order, fontPx);
  }

  // ── 2. Terminal atoms ────────────────────────────────────────────
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = `600 ${fontPx}px "Segoe UI", system-ui, sans-serif`;
  for (const s of slots) {
    if (s.kind === 'lone' || !s.atom) continue;
    const L  = bondLen * (s.len || 1);
    const tx = cx + Math.cos(s.angle) * L;
    const ty = cy + Math.sin(s.angle) * L;
    ctx.fillStyle = LV_STATE.atomColor;
    ctx.fillText(s.atom.symbol, tx, ty);
  }

  // ── 3. Central atom ──────────────────────────────────────────────
  ctx.fillStyle = LV_STATE.atomColor;
  ctx.fillText(centralAtom.symbol, cx, cy);

  // ── 4. Lone pairs on central atom ───────────────────────────────
  if (LV_STATE.showLonePairs) {
    ctx.fillStyle = LV_STATE.dotColor;
    const lpRadius  = fontPx * 1.0;
    const pairGap   = dotPx * 2.6;
    for (const s of slots) {
      if (s.kind !== 'lone') continue;
      const ccx = cx + Math.cos(s.angle) * lpRadius;
      const ccy = cy + Math.sin(s.angle) * lpRadius;
      const ux  = -Math.sin(s.angle), uy = Math.cos(s.angle);
      ctx.beginPath();
      ctx.arc(ccx + ux*pairGap/2, ccy + uy*pairGap/2, dotPx, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ccx - ux*pairGap/2, ccy - uy*pairGap/2, dotPx, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── 5. Shape label below ────────────────────────────────────────
  ctx.font      = `600 ${fontPx * 0.6}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = LV_STATE.atomColor;
  const labelY  = canvas.height - Math.max(22, fontPx * 0.9);
  ctx.fillText(
    `${vsepr.shape}   (${vsepr.axeNotation},  ${vsepr.bondAngle})`,
    canvas.width / 2, labelY
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bond drawing by kind — single-line variant; handles order > 1 by drawing
// parallel lines. Wedge and dash only make sense for single-order bonds
// (no double wedges in standard VSEPR notation).
// ─────────────────────────────────────────────────────────────────────────────
function drawBond(ctx, ax, ay, bx, by, kind, order, fontPx) {
  const zoom = LV_STATE.zoom;

  if (kind === 'wedge') {
    drawWedge(ctx, ax, ay, bx, by, fontPx * 0.35);
    return;
  }
  if (kind === 'dash') {
    drawDash(ctx, ax, ay, bx, by, fontPx * 0.35);
    return;
  }

  // 'plane': one / two / three parallel lines
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux  = dx / len, uy = dy / len;
  const px  = -uy,      py = ux;
  const doubleGap = Math.max(3, fontPx * 0.18);
  const tripleGap = Math.max(3, fontPx * 0.22);

  const drawParallel = (offset) => {
    ctx.beginPath();
    ctx.moveTo(ax + px*offset, ay + py*offset);
    ctx.lineTo(bx + px*offset, by + py*offset);
    ctx.stroke();
  };
  if (order === 1)         { drawParallel(0); }
  else if (order === 2)    { drawParallel(+doubleGap/2); drawParallel(-doubleGap/2); }
  else if (order >= 3)     { drawParallel(+tripleGap); drawParallel(0); drawParallel(-tripleGap); }
  else                     { drawParallel(0); }
}

// Solid filled triangle — thick end at (bx,by), thin end at (ax,ay)
function drawWedge(ctx, ax, ay, bx, by, thickEndWidth) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const px  = -dy / len, py = dx / len;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx + px * thickEndWidth / 2, by + py * thickEndWidth / 2);
  ctx.lineTo(bx - px * thickEndWidth / 2, by - py * thickEndWidth / 2);
  ctx.closePath();
  ctx.fill();
}

// Series of short perpendicular lines that grow toward the far atom —
// a "dashed wedge" indicating a bond going into the page.
function drawDash(ctx, ax, ay, bx, by, thickEndWidth) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux  = dx / len, uy = dy / len;
  const px  = -uy,       py = ux;
  const steps = Math.max(5, Math.round(len / 10));
  const baseLW = ctx.lineWidth;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cx = ax + ux * len * t;
    const cy = ay + uy * len * t;
    const w  = thickEndWidth * t;
    ctx.lineWidth = Math.max(1.4, baseLW);
    ctx.beginPath();
    ctx.moveTo(cx + px * w / 2, cy + py * w / 2);
    ctx.lineTo(cx - px * w / 2, cy - py * w / 2);
    ctx.stroke();
  }
  ctx.lineWidth = baseLW;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback renderer: when a shape isn't in our layout table, just show the
// shape name so the UI doesn't go blank.
// ─────────────────────────────────────────────────────────────────────────────
function drawFallback(ctx, canvas, vsepr) {
  const fontPx = LV_STATE.fontSize * LV_STATE.zoom;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = LV_STATE.atomColor;
  ctx.font         = `600 ${fontPx}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillText(vsepr.shape, canvas.width / 2, canvas.height / 2 - fontPx * 0.5);
  ctx.font         = `500 ${fontPx * 0.6}px "Segoe UI"`;
  ctx.fillStyle    = '#8a9ab8';
  ctx.fillText(
    `${vsepr.axeNotation},  ${vsepr.bondAngle}`,
    canvas.width / 2, canvas.height / 2 + fontPx * 0.4
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chain VSEPR geometry renderer — draws a small per-carbon summary row
// showing each carbon's hybridization label + geometry name. Not a
// full geometric drawing (chains have per-carbon geometry and a row
// of mini-drawings would be cluttered). Keep it readable: one line per
// carbon with hybridization + shape.
// ─────────────────────────────────────────────────────────────────────────────
function drawChainVSEPRGeometry(ctx, canvas, structure, vsepr) {
  const perCarbon = vsepr.perCarbon || [];
  if (perCarbon.length === 0) return;

  const titleSize = 18;
  const rowSize   = 15;
  const rowGap    = 6;
  const paddingY  = 20;
  const paddingX  = 20;
  const rowHeight = rowSize + rowGap;

  // Title
  ctx.fillStyle    = LV_STATE.atomColor;
  ctx.font         = `600 ${titleSize}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`Chain hybridization: ${vsepr.summaryHybridization}`, paddingX, paddingY);

  // Per-carbon list
  ctx.font = `500 ${rowSize}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = LV_STATE.atomColor;
  let y = paddingY + titleSize + rowGap * 2;
  for (const p of perCarbon) {
    const line = `C${p.carbonIdx}:  ${p.hybridLabel}  →  ${p.shape},  ${p.bondAngle}`;
    ctx.fillText(line, paddingX, y);
    y += rowHeight;
    if (y > canvas.height - paddingY) break;
  }
}
