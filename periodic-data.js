// periodic-data.js
// ─────────────────────────────────────────────────────────────────────────────
// Lookup tables for every element students encounter in HS chemistry Lewis work.
//
//   valence      — number of valence electrons (H=1, He=2, rest by group)
//   en           — Pauling electronegativity (null when not defined, e.g. noble gases w/o compounds)
//   octetTarget  — default electrons needed to satisfy (duet / 6 / 8)
//   octetMax     — maximum allowed (expanded octet elements can exceed 8)
//   isMetal      — true for groups 1-2, transition metals, Al, Ga, In, Sn, Pb, Bi
//   group        — periodic-table group (for reference / debugging)
// ─────────────────────────────────────────────────────────────────────────────

const PERIODIC_DATA = {
  //            sym         valence  en      octT octM  metal group
  'H':  { symbol:'H',  valence:1, en:2.20, octetTarget:2,  octetMax:2,  isMetal:false, group:1  },
  'He': { symbol:'He', valence:2, en:null, octetTarget:2,  octetMax:2,  isMetal:false, group:18 },

  'Li': { symbol:'Li', valence:1, en:0.98, octetTarget:8,  octetMax:8,  isMetal:true,  group:1  },
  'Be': { symbol:'Be', valence:2, en:1.57, octetTarget:4,  octetMax:4,  isMetal:true,  group:2  },
  'B':  { symbol:'B',  valence:3, en:2.04, octetTarget:6,  octetMax:6,  isMetal:false, group:13 },
  'C':  { symbol:'C',  valence:4, en:2.55, octetTarget:8,  octetMax:8,  isMetal:false, group:14 },
  'N':  { symbol:'N',  valence:5, en:3.04, octetTarget:8,  octetMax:8,  isMetal:false, group:15 },
  'O':  { symbol:'O',  valence:6, en:3.44, octetTarget:8,  octetMax:8,  isMetal:false, group:16 },
  'F':  { symbol:'F',  valence:7, en:3.98, octetTarget:8,  octetMax:8,  isMetal:false, group:17 },
  'Ne': { symbol:'Ne', valence:8, en:null, octetTarget:8,  octetMax:8,  isMetal:false, group:18 },

  'Na': { symbol:'Na', valence:1, en:0.93, octetTarget:8,  octetMax:8,  isMetal:true,  group:1  },
  'Mg': { symbol:'Mg', valence:2, en:1.31, octetTarget:8,  octetMax:8,  isMetal:true,  group:2  },
  'Al': { symbol:'Al', valence:3, en:1.61, octetTarget:8,  octetMax:8,  isMetal:true,  group:13 },
  'Si': { symbol:'Si', valence:4, en:1.90, octetTarget:8,  octetMax:8,  isMetal:false, group:14 },
  'P':  { symbol:'P',  valence:5, en:2.19, octetTarget:8,  octetMax:10, isMetal:false, group:15 },
  'S':  { symbol:'S',  valence:6, en:2.58, octetTarget:8,  octetMax:12, isMetal:false, group:16 },
  'Cl': { symbol:'Cl', valence:7, en:3.16, octetTarget:8,  octetMax:12, isMetal:false, group:17 },
  'Ar': { symbol:'Ar', valence:8, en:null, octetTarget:8,  octetMax:8,  isMetal:false, group:18 },

  'K':  { symbol:'K',  valence:1, en:0.82, octetTarget:8,  octetMax:8,  isMetal:true,  group:1  },
  'Ca': { symbol:'Ca', valence:2, en:1.00, octetTarget:8,  octetMax:8,  isMetal:true,  group:2  },
  // Common transition metals (generic valence=2 placeholder — ionic charges handled by formula)
  'Sc': { symbol:'Sc', valence:3, en:1.36, octetTarget:8,  octetMax:8,  isMetal:true,  group:3  },
  'Ti': { symbol:'Ti', valence:4, en:1.54, octetTarget:8,  octetMax:8,  isMetal:true,  group:4  },
  'V':  { symbol:'V',  valence:5, en:1.63, octetTarget:8,  octetMax:8,  isMetal:true,  group:5  },
  'Cr': { symbol:'Cr', valence:6, en:1.66, octetTarget:8,  octetMax:8,  isMetal:true,  group:6  },
  'Mn': { symbol:'Mn', valence:7, en:1.55, octetTarget:8,  octetMax:8,  isMetal:true,  group:7  },
  'Fe': { symbol:'Fe', valence:2, en:1.83, octetTarget:8,  octetMax:8,  isMetal:true,  group:8  },
  'Co': { symbol:'Co', valence:2, en:1.88, octetTarget:8,  octetMax:8,  isMetal:true,  group:9  },
  'Ni': { symbol:'Ni', valence:2, en:1.91, octetTarget:8,  octetMax:8,  isMetal:true,  group:10 },
  'Cu': { symbol:'Cu', valence:1, en:1.90, octetTarget:8,  octetMax:8,  isMetal:true,  group:11 },
  'Zn': { symbol:'Zn', valence:2, en:1.65, octetTarget:8,  octetMax:8,  isMetal:true,  group:12 },
  'Ga': { symbol:'Ga', valence:3, en:1.81, octetTarget:8,  octetMax:8,  isMetal:true,  group:13 },
  'Ge': { symbol:'Ge', valence:4, en:2.01, octetTarget:8,  octetMax:8,  isMetal:false, group:14 },
  'As': { symbol:'As', valence:5, en:2.18, octetTarget:8,  octetMax:10, isMetal:false, group:15 },
  'Se': { symbol:'Se', valence:6, en:2.55, octetTarget:8,  octetMax:12, isMetal:false, group:16 },
  'Br': { symbol:'Br', valence:7, en:2.96, octetTarget:8,  octetMax:12, isMetal:false, group:17 },
  'Kr': { symbol:'Kr', valence:8, en:3.00, octetTarget:8,  octetMax:8,  isMetal:false, group:18 },

  'Rb': { symbol:'Rb', valence:1, en:0.82, octetTarget:8,  octetMax:8,  isMetal:true,  group:1  },
  'Sr': { symbol:'Sr', valence:2, en:0.95, octetTarget:8,  octetMax:8,  isMetal:true,  group:2  },
  'Ag': { symbol:'Ag', valence:1, en:1.93, octetTarget:8,  octetMax:8,  isMetal:true,  group:11 },
  'Cd': { symbol:'Cd', valence:2, en:1.69, octetTarget:8,  octetMax:8,  isMetal:true,  group:12 },
  'In': { symbol:'In', valence:3, en:1.78, octetTarget:8,  octetMax:8,  isMetal:true,  group:13 },
  'Sn': { symbol:'Sn', valence:4, en:1.96, octetTarget:8,  octetMax:8,  isMetal:true,  group:14 },
  'Sb': { symbol:'Sb', valence:5, en:2.05, octetTarget:8,  octetMax:10, isMetal:false, group:15 },
  'Te': { symbol:'Te', valence:6, en:2.10, octetTarget:8,  octetMax:12, isMetal:false, group:16 },
  'I':  { symbol:'I',  valence:7, en:2.66, octetTarget:8,  octetMax:12, isMetal:false, group:17 },
  'Xe': { symbol:'Xe', valence:8, en:2.60, octetTarget:8,  octetMax:12, isMetal:false, group:18 },

  'Cs': { symbol:'Cs', valence:1, en:0.79, octetTarget:8,  octetMax:8,  isMetal:true,  group:1  },
  'Ba': { symbol:'Ba', valence:2, en:0.89, octetTarget:8,  octetMax:8,  isMetal:true,  group:2  },
  'Pb': { symbol:'Pb', valence:4, en:2.33, octetTarget:8,  octetMax:8,  isMetal:true,  group:14 },
  'Bi': { symbol:'Bi', valence:5, en:2.02, octetTarget:8,  octetMax:8,  isMetal:true,  group:15 }
};

// ── Helpers ────────────────────────────────────────────────────────────────
function getElement(sym) {
  return PERIODIC_DATA[sym] || null;
}
function isKnownElement(sym) {
  return !!PERIODIC_DATA[sym];
}
function isMetal(sym) {
  const e = PERIODIC_DATA[sym];
  return !!(e && e.isMetal);
}
function isNonmetal(sym) {
  const e = PERIODIC_DATA[sym];
  return !!(e && !e.isMetal);
}
function canExpandOctet(sym) {
  const e = PERIODIC_DATA[sym];
  return !!(e && e.octetMax > 8);
}
function valenceOf(sym) {
  const e = PERIODIC_DATA[sym];
  return e ? e.valence : 0;
}
function electronegativityOf(sym) {
  const e = PERIODIC_DATA[sym];
  return e ? e.en : null;
}
function octetTargetOf(sym) {
  const e = PERIODIC_DATA[sym];
  return e ? e.octetTarget : 8;
}
