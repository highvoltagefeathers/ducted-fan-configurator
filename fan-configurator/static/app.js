/* Ducted Fan Configurator - front end.
   All aerodynamics come from dfdc.exe via the Python server; this file only
   builds the configuration, draws geometry previews and charts the results. */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const SVGNS = "http://www.w3.org/2000/svg";

// ---------------------------------------------------------------------------
// configuration schema
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  name: "My fan",
  oper: { vinf: 0, rpm: 8000, alt_km: 0, target_mode: "thrust", thrust: 300, thrust_basis: "total",
          bgam: 10, wake_len: 0.8, wake_pts: 20, viscous: true, analyze_trim: false, pitch_delta: 0 },
  geom: { fan_dia_mm: 310, hub_dia_mm: 93, tip_gap_mm: 1.0,
          duct_chord_mm: 310, duct_thickness: 12, duct_camber: 3, duct_camber_pos: 0.40, duct_stagger: 0, rotor_pos_mm: 124,
          nose_len_mm: 70, cyl_len_mm: 140, rotor_x_mm: 126, tail_len_mm: 116, tail_base_dia_mm: 28,
          stator_on: false, stator_gap_mm: 78 },
  rotor: { nblades: 5, nstations: 11, cl_hub: 0.80, cl_tip: 0.60, airfoil: { preset: "naca4412", overrides: {} } },
  stator: { nblades: 7, cl: 0.70, swirl_recovery: 100, airfoil: { preset: "naca65-410", overrides: {} } },
};

// slider definitions: [path, label, min, max, step, unit, decimals, help]
const GROUPS = [
  { id: "oper", title: "Operating point", open: true, items: [
    ["oper.vinf", "Flight speed", 0, 80, 0.5, "m/s", 1, "0 = static hover / bench test"],
    ["oper.rpm", "Rotor speed", 500, 30000, 50, "rpm", 0],
    ["oper.alt_km", "Altitude", 0, 10, 0.1, "km", 1, "ISA atmosphere"],
    ["oper.thrust", "Target thrust", 1, 5000, 1, "N", 0, "DFDC drives the loading to this total thrust"],
  ]},
  { id: "fan", title: "Rotor", open: true, items: [
    ["geom.fan_dia_mm", "Fan diameter", 60, 2400, 1, "mm", 0, "blade tip diameter"],
    ["geom.hub_dia_mm", "Hub diameter", 10, 1600, 1, "mm", 0, "centerbody diameter at the rotor"],
    ["geom.tip_gap_mm", "Tip gap", 0, 10, 0.1, "mm", 1],
    ["rotor.nblades", "Blade count", 2, 12, 1, "", 0],
    ["rotor.cl_hub", "Section lift coeff. at hub", 0.2, 1.6, 0.01, "CL", 2, "dimensionless lift coefficient the root section runs at. The thrust is fixed by the target, so a higher CL gives a NARROWER chord"],
    ["rotor.cl_tip", "Section lift coeff. at tip", 0.2, 1.6, 0.01, "CL", 2, "same at the tip; linear in between. Lower at the tip keeps the fast tip sections away from stall and compressibility"],
    ["rotor.nstations", "Radial stations", 8, 20, 1, "", 0, "blade elements used by the solver"],
  ]},
  { id: "duct", title: "Duct", open: false, items: [
    ["geom.duct_chord_mm", "Chord", 20, 3000, 1, "mm", 0],
    ["geom.duct_thickness", "Thickness", 5, 25, 0.5, "% c", 1],
    ["geom.duct_camber", "Camber", 0, 8, 0.1, "% c", 1, "camber faces the axis (suction side inward)"],
    ["geom.duct_camber_pos", "Camber position", 0.2, 0.6, 0.01, "c", 2],
    ["geom.duct_stagger", "Section angle", -8, 10, 0.1, "°", 1, "positive opens the exit (diffuser)"],
    ["geom.rotor_pos_mm", "Rotor behind duct LE", 2, 2500, 1, "mm", 0, "places the duct relative to the rotor plane"],
  ]},
  { id: "cb", title: "Centerbody", open: false, items: [
    ["geom.nose_len_mm", "Nose length", 5, 1500, 1, "mm", 0],
    ["geom.cyl_len_mm", "Cylinder length", 5, 2500, 1, "mm", 0],
    ["geom.rotor_x_mm", "Rotor plane from nose tip", 2, 3000, 1, "mm", 0, "keep it on the cylindrical section"],
    ["geom.tail_len_mm", "Tail length", 5, 2500, 1, "mm", 0],
    ["geom.tail_base_dia_mm", "Tail base diameter", 1, 1500, 1, "mm", 0],
  ]},
  { id: "stator", title: "Stator", open: false, items: [
    ["stator.nblades", "Vane count", 3, 15, 1, "", 0],
    ["geom.stator_gap_mm", "Spacing behind rotor", 2, 1500, 1, "mm", 0],
    ["stator.cl", "Section lift coeff.", 0.2, 1.4, 0.01, "CL", 2, "dimensionless; higher CL gives narrower vanes for the same swirl recovery"],
    ["stator.swirl_recovery", "Swirl recovery", 0, 120, 1, "%", 0, "stator circulation as a fraction of the rotor's"],
  ]},
  { id: "solver", title: "Solver", open: false, items: [
    ["oper.wake_len", "Wake length", 0.5, 2.0, 0.05, "D", 2, "downstream vortex wake, in duct diameters"],
    ["oper.wake_pts", "Wake points", 10, 40, 1, "", 0],
  ]},
];

const AERO_FIELDS = [
  ["a0deg", "α zero-lift", "°", 2], ["dclda", "dCL/dα", "/rad", 2], ["clmax", "CL max", "", 2], ["clmin", "CL min", "", 2],
  ["cdmin", "CD min", "", 4], ["clcdmin", "CL at CD min", "", 2], ["dcdcl2", "dCD/dCL²", "", 4],
  ["mcrit", "M crit", "", 2], ["cmconst", "Cm", "", 3], ["reref", "Re ref", "", 0], ["reexp", "Re exponent", "", 2],
  ["dclda_stall", "post-stall slope", "/rad", 2], ["dcl_stall", "stall width ΔCL", "", 2],
];

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
const state = {
  config: load("fan.config") || deepClone(DEFAULT_CONFIG),
  mode: "design",
  airfoils: [],
  geom: null,
  result: null,
  rotors: load("fan.rotors") || null,
  rotorsGeom: load("fan.rotorsGeom") || null,   // hub/tip radii the saved blades were designed for
  live: load("fan.live") ?? true,
  activeTab: "summary",
  viewer: null,
  stale: false,
};

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
function load(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function getPath(obj, path) { return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setPath(obj, path, v) { const ks = path.split("."); const last = ks.pop(); ks.reduce((o, k) => (o[k] ??= {}), obj)[last] = v; }
function fmt(v, d = 2) { if (v == null || Number.isNaN(v)) return "–"; return Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }); }
function fmtSig(v, s = 3) { if (v == null) return "–"; const a = Math.abs(v); if (a === 0) return "0"; const d = Math.max(0, s - 1 - Math.floor(Math.log10(a))); return fmt(v, Math.min(d, 6)); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function el(tag, attrs = {}, children = []) {
  const e = tag.startsWith("svg:") ? document.createElementNS(SVGNS, tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.setAttribute("class", v);
    else if (k === "html") e.innerHTML = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v != null) e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null) e.append(c);
  return e;
}
async function postJSON(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({ error: "bad response" }));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}
let toastTimer;
function toast(msg, err = false, ms = 4000) {
  const t = $("#toast"); t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ---------------------------------------------------------------------------
// controls
// ---------------------------------------------------------------------------
function buildControls() {
  const host = $("#controls");
  host.innerHTML = "";
  for (const g of GROUPS) {
    const body = el("div", { class: "group-body" });
    if (g.id === "oper") {
      body.append(selectRow("Thrust basis", "oper.thrust_basis",
        [["total", "Total (duct + rotor)"], ["rotor", "Rotor only"]]));
      body.append(el("div", { id: "analyze-opts" }, [
        switchRow("Trim pitch to target thrust", "oper.analyze_trim"),
        sliderRow(["oper.pitch_delta", "Pitch offset", -15, 15, 0.1, "°", 1, "added to every blade angle before solving"]),
      ]));
      body.append(switchRow("Wall boundary layer (viscous drag)", "oper.viscous"));
    }
    for (const it of g.items) body.append(sliderRow(it));
    if (g.id === "fan") body.append(airfoilPicker("rotor"));
    if (g.id === "stator") {
      body.prepend(switchRow("Add a stator row", "geom.stator_on"));
      body.append(airfoilPicker("stator"));
      body.append(el("p", { class: "note", text: "Stator vanes are designed to cancel the rotor's swirl. DFDC treats them with a mirrored polar, so the reported vane angles are measured from the section's zero-lift line." }));
    }
    if (g.id === "solver") body.append(el("p", { class: "note", text: "Defaults from the DFDC manual: 0.75–2 diameters of wake, 20 points. Longer wakes converge more slowly." }));
    const d = el("details", { class: "group", open: g.open ? "" : null }, [
      el("summary", {}, [g.title, el("span", { class: "hint", id: "hint-" + g.id })]), body]);
    host.append(d);
  }
  refreshControlState();
}

function sliderRow([path, label, min, max, step, unit, dec, help]) {
  const v = getPath(state.config, path);
  const range = el("input", { type: "range", min, max, step, value: v });
  const num = el("input", { type: "number", min, max, step, value: Number(v).toFixed(dec) });
  const row = el("div", { class: "ctl", "data-path": path, title: help || null }, [
    el("label", { text: label }), el("div", { class: "val" }, [num, el("span", { class: "unit", text: unit })]), range]);
  const commit = (val, fromRange) => {
    val = Math.min(max, Math.max(min, Number(val)));
    if (Number.isNaN(val)) return;
    setPath(state.config, path, val);
    if (fromRange) num.value = val.toFixed(dec); else range.value = val;
    onConfigChange(path);
  };
  range.addEventListener("input", () => commit(range.value, true));
  num.addEventListener("change", () => commit(num.value, false));
  return row;
}
function switchRow(label, path) {
  const inp = el("input", { type: "checkbox" });
  inp.checked = !!getPath(state.config, path);
  inp.addEventListener("change", () => { setPath(state.config, path, inp.checked); onConfigChange(path); });
  return el("div", { class: "row", "data-path": path }, [el("label", { text: label }), el("label", { class: "switch" }, [inp])]);
}
function selectRow(label, path, options) {
  const sel = el("select", {}, options.map(([v, t]) => el("option", { value: v, text: t })));
  sel.value = getPath(state.config, path);
  sel.addEventListener("change", () => { setPath(state.config, path, sel.value); onConfigChange(path); });
  return el("div", { class: "row", "data-path": path }, [el("label", { text: label }), sel]);
}

function airfoilPicker(which) {
  const spec = state.config[which].airfoil;
  const sel = el("select", {}, state.airfoils.map(a => el("option", { value: a.id, text: a.name })));
  sel.value = spec.preset;
  const card = el("div", { class: "airfoil-card" });
  const grid = el("div", { class: "aero-grid" });
  const details = el("details", {}, [el("summary", { class: "note", text: "Section polar parameters (editable)" }), grid,
    el("div", { style: "margin-top:6px" }, [el("button", { class: "small-btn", text: "Reset to preset", onclick: () => { spec.overrides = {}; refresh(); onConfigChange(which + ".airfoil"); } })])]);
  const refresh = () => {
    const p = state.airfoils.find(a => a.id === spec.preset) || state.airfoils[0];
    card.innerHTML = "";
    card.append(sectionSVG(p.naca, 110, 44), el("div", {}, [el("div", { class: "af-name", text: p.name + " · " + p.family }), el("div", { class: "af-note", text: p.note })]));
    grid.innerHTML = "";
    for (const [k, lab, unit, dec] of AERO_FIELDS) {
      const val = spec.overrides[k] ?? p.aero[k];
      const inp = el("input", { type: "number", step: "any", value: dec ? Number(val).toFixed(dec) : val, class: spec.overrides[k] != null ? "changed" : "" });
      inp.addEventListener("change", () => {
        const n = Number(inp.value);
        if (Number.isNaN(n)) return;
        if (Math.abs(n - p.aero[k]) < 1e-12) delete spec.overrides[k]; else spec.overrides[k] = n;
        inp.className = spec.overrides[k] != null ? "changed" : "";
        onConfigChange(which + ".airfoil");
      });
      grid.append(el("label", {}, [lab + (unit ? " (" + unit + ")" : ""), inp]));
    }
  };
  sel.addEventListener("change", () => { spec.preset = sel.value; spec.overrides = {}; refresh(); onConfigChange(which + ".airfoil"); });
  refresh();
  return el("div", { style: "display:grid;gap:8px" }, [
    el("div", { class: "row" }, [el("label", { text: which === "rotor" ? "Blade section" : "Vane section" }), sel]), card, details]);
}

function refreshControlState() {
  const design = state.mode === "design";
  const statorOn = !!state.config.geom.stator_on;
  $("#analyze-opts").hidden = design;
  for (const p of ["rotor.cl_hub", "rotor.cl_tip", "rotor.nstations", "stator.cl", "stator.swirl_recovery", "stator.nblades", "rotor.nblades"])
    $(`[data-path="${p}"]`)?.classList.toggle("disabled", !design);
  $(`[data-path="oper.thrust"]`)?.classList.toggle("disabled", !design && !state.config.oper.analyze_trim);
  $(`[data-path="oper.pitch_delta"]`)?.classList.toggle("disabled", !!state.config.oper.analyze_trim);
  for (const p of ["stator.nblades", "geom.stator_gap", "stator.cl", "stator.swirl_recovery"])
    $(`[data-path="${p}"]`)?.classList.toggle("disabled", !statorOn || !design);
  $("#legend-stator").style.display = statorOn ? "" : "none";
  const sb = $('.step-btn[data-what="stator"]'); if (sb) sb.hidden = !statorOn;
  $("#hint-stator").textContent = statorOn ? state.config.stator.nblades + " vanes" : "off";
  $("#hint-fan").textContent = `${state.config.rotor.nblades} blades · Ø ${fmt(state.config.geom.fan_dia_mm, 0)} mm`;
  $("#hint-oper").textContent = `${fmt(state.config.oper.rpm, 0)} rpm · ${fmt(state.config.oper.vinf, 0)} m/s`;
  $("#analyze-tab").disabled = !state.rotors;
  $("#analyze-tab").title = state.rotors ? "Re-run the designed blades at other conditions" : "Run a design first";
}

function onConfigChange(path) {
  save("fan.config", state.config);
  refreshControlState();
  if (path.startsWith("geom.")) {
    updatePreview();                       // redraws 2-D and 3-D bodies, re-scales blades
    if (state.rotors && path !== "geom.stator_on") $("#analyze-tab").title = "Geometry changed since the design - blades will be re-used as-is";
  } else {
    update3DBlades();                      // blade count, section, pitch offset: instant
  }
  if (path.endsWith("airfoil") || path.startsWith("rotor.") || path.startsWith("stator.")) renderSectionTab();
  if (path !== "oper.thrust_basis" || state.mode === "design") markStale();
  scheduleLiveSolve();
}

// ---------------------------------------------------------------------------
// live solving: keep DFDC running in the background while sliders move.
// One run at a time; if settings changed during a run, run once more.
// ---------------------------------------------------------------------------
let liveTimer = null, liveQueued = false, liveBusy = false, lastErr = "";
function scheduleLiveSolve() {
  if (!state.live) return;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { liveQueued = true; if (!liveBusy) liveLoop(); }, 120);
}
async function liveLoop() {
  liveBusy = true;
  while (liveQueued) { liveQueued = false; await run(true); }
  liveBusy = false;
}
function markStale() { state.stale = true; updateBladeStatus(); }
function updateBladeStatus() {
  const p = $("#blade-status");
  if (!state.rotors) { p.textContent = "no design yet"; p.className = "pill"; return; }
  if (state.stale) { p.textContent = state.live ? "re-scaled from last design · solving…" : "re-scaled from last design · run DFDC"; p.className = "pill stale"; return; }
  p.textContent = `blades from DFDC · ${state.rotors[0].stations.length} stations`; p.className = "pill good";
}
function setStatus(txt) { $("#solve-status").textContent = txt; }

// ---------------------------------------------------------------------------
// geometry preview
// ---------------------------------------------------------------------------
let geomSeq = 0;
const updatePreview = debounce(async () => {
  const seq = ++geomSeq;
  try {
    const g = await postJSON("/api/geometry", { geom: state.config.geom });
    if (seq !== geomSeq) return;           // a newer request is in flight
    state.geom = g;
    drawPreview();
  } catch (e) { toast("Geometry: " + e.message, true); }
}, 60);

/** Push the current blade geometry into the 3-D view.  Blades come from the last
    DFDC design; if the hub/tip radii have moved since, they are re-scaled in
    r/R (chord scaled with tip radius) until the next solve replaces them. */
function update3DBlades() {
  const v = state.viewer, g = state.geom; if (!v || !g) return;
  const cfg = state.config, rotors = state.rotors || [], rg = state.rotorsGeom;
  const rescale = (stations, hub0, tip0, hub1, tip1) => {
    if (hub0 == null || tip0 == null || hub1 == null || tip1 == null) return stations;
    const k = tip1 / tip0;
    return stations.map(([r, c, b]) => [hub1 + (r - hub0) / (tip0 - hub0) * (tip1 - hub1), c * k, b]);
  };
  const preset = id => state.airfoils.find(a => a.id === id) || state.airfoils[0] || { naca: "0010" };
  const pitch = state.mode === "analyze" && !cfg.oper.analyze_trim ? cfg.oper.pitch_delta || 0 : 0;
  const rot = rotors[0];
  const rotRows = rot && rot.kind === "rotor" ? {
    stations: rescale(rot.stations, rg?.R_hub, rg?.R_tip, g.R_hub, g.R_tip),
    nblades: state.mode === "design" ? cfg.rotor.nblades : rot.nblades,
    naca: preset(cfg.rotor.airfoil.preset).naca, xDisk: g.x_rotor, pitchDelta: pitch,
  } : null;
  v.setBlades("rotor", rotRows);
  const st = rotors[1];
  const stRows = cfg.geom.stator_on && st && st.kind === "rotor" && g.stator_hub != null ? {
    stations: rescale(st.stations, rg?.stator_hub, rg?.stator_tip, g.stator_hub, g.stator_tip),
    nblades: state.mode === "design" ? cfg.stator.nblades : st.nblades,
    naca: preset(cfg.stator.airfoil.preset).naca, xDisk: g.x_stator, mirror: true,
  } : null;
  v.setBlades("stator", stRows);
  updateBladeStatus();
  state.bladeRows = { rotor: rotRows, stator: stRows };
}

/** STEP export of one part (blade, stator vane or duct) exactly as the 3-D view shows it.
    Asks where to save first (native dialog where the browser supports it), then builds. */
async function exportStep(what, btn) {
  const rows = state.bladeRows || {}, g = state.geom;
  if (!g || (what !== "duct" && !rows.rotor)) { toast("Run a design first - there is nothing to export yet.", true); return; }
  if (what === "stator" && !rows.stator) { toast("No stator in this design.", true); return; }
  const base = (state.config.name || "fan").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "fan";
  const suggested = `${base}_${what}.step`;
  // 1. ask for the location while the click is still a user gesture
  let handle = null;
  if (window.showSaveFilePicker) {
    try {
      handle = await window.showSaveFilePicker({ suggestedName: suggested,
        types: [{ description: "STEP file", accept: { "application/step": [".step", ".stp"] } }] });
    } catch (e) { if (e.name === "AbortError") return; handle = null; }
  }
  // 2. build the part
  const label = btn.textContent; btn.disabled = true; btn.textContent = "Building…";
  try {
    const req = { what, geom: g,
      rotor: rows.rotor ? { stations: rows.rotor.stations.map(([r, c, b]) => [r, c, b + (rows.rotor.pitchDelta || 0)]), naca: rows.rotor.naca, xDisk: rows.rotor.xDisk } : null,
      stator: rows.stator ? { stations: rows.stator.stations, naca: rows.stator.naca, xDisk: rows.stator.xDisk } : null };
    const resp = await fetch("/api/step", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
    if (!resp.ok) { const err = await resp.json().catch(() => ({})); throw new Error(err.error || resp.statusText); }
    const blob = await resp.blob();
    // 3. save
    if (handle) {
      const w = await handle.createWritable(); await w.write(blob); await w.close();
      toast(`Saved ${handle.name} (${(blob.size / 1024).toFixed(0)} kB)`, false, 6000);
    } else {
      const url = URL.createObjectURL(blob);
      const a = el("a", { href: url, download: suggested }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast(`Downloaded ${suggested}`);
    }
  } catch (e) { toast("STEP export failed: " + e.message.split("\n")[0], true, 8000); }
  finally { btn.disabled = false; btn.textContent = label; }
}

function drawPreview() {
  const g = state.geom; if (!g) return;
  if (state.viewer) { state.viewer.setGeometry(g); update3DBlades(); }
  const svg = $("#preview"); svg.innerHTML = "";
  const W = svg.clientWidth || 800, H = svg.clientHeight || 300;
  const allX = g.centerbody.concat(g.duct).map(p => p[0]);
  const rmax = Math.max(...g.duct.map(p => p[1]));
  const xmin = Math.min(...allX), xmax = Math.max(...allX);
  const padX = (xmax - xmin) * 0.08;
  const s = Math.min((W - 24) / (xmax - xmin + 2 * padX), (H - 40) / (2 * rmax * 1.08));
  const ox = W / 2 - ((xmin + xmax) / 2) * s, oy = H / 2;
  const X = x => ox + x * s, Y = r => oy - r * s;
  const path = (pts, mirror) => pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(mirror ? -p[1] : p[1]).toFixed(1)).join(" ");

  const add = (tag, attrs) => svg.append(el("svg:" + tag, attrs));
  // axis line
  add("line", { x1: X(xmin - padX), x2: X(xmax + padX), y1: oy, y2: oy, stroke: "var(--axis)", "stroke-dasharray": "6 4" });
  // centerbody (closed through the axis)
  const cb = g.centerbody;
  const cbPath = path(cb, false) + " " + cb.slice().reverse().map(p => "L" + X(p[0]).toFixed(1) + " " + Y(-p[1]).toFixed(1)).join(" ") + " Z";
  add("path", { d: cbPath, fill: "var(--s2)", "fill-opacity": .22, stroke: "var(--s2)", "stroke-width": 1.5 });
  // duct, both halves
  for (const m of [false, true]) add("path", { d: path(g.duct, m) + " Z", fill: "var(--s1)", "fill-opacity": .22, stroke: "var(--s1)", "stroke-width": 1.5 });
  // rotor and stator planes, with blade footprints if a design exists
  const disk = (x, rh, rt, color, dash, rotor) => {
    for (const m of [1, -1]) {
      add("line", { x1: X(x), x2: X(x), y1: Y(m * rh), y2: Y(m * rt), stroke: color, "stroke-width": 2.5, "stroke-dasharray": dash, "stroke-linecap": "round" });
      if (rotor && rotor.stations.length) {
        // quarter-chord line on the disk plane, same convention as the 3-D model and the section stack
        const st = rotor.stations.map(([r, c, b]) => [r, c * Math.sin(b * Math.PI / 180)]);
        const d = st.map((p, i) => (i ? "L" : "M") + X(x - 0.25 * p[1]).toFixed(1) + " " + Y(m * p[0]).toFixed(1)).join(" ")
          + st.slice().reverse().map(p => "L" + X(x + 0.75 * p[1]).toFixed(1) + " " + Y(m * p[0]).toFixed(1)).join(" ") + " Z";
        add("path", { d, fill: color, "fill-opacity": .55, stroke: color, "stroke-width": 1 });
      }
    }
  };
  const rotors = state.rotors || [];
  // separated wall segments from the last solve (only while the geometry still matches it)
  const bl = !state.stale && state.result && state.result.bl;
  if (bl) for (const w of [bl.duct_inner, bl.centerbody]) {
    if (!w || !w.separated) continue;
    for (const m of [1, -1]) {
      const d = w.x.map((x, i) => (w.state[i] === "sep" ? [x, w.r[i]] : null)).filter(Boolean)
        .map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(m * p[1]).toFixed(1)).join(" ");
      add("path", { d, fill: "none", stroke: "var(--crit)", "stroke-width": 4, "stroke-linecap": "round", opacity: .9 });
    }
    add("text", { x: X(w.x_sep), y: Y(w.r[w.i_sep]) - 8, "text-anchor": "middle", fill: "var(--crit)", "font-size": 11, "font-weight": 600, "font-family": "var(--font)", text: "separation" });
  }
  disk(g.x_rotor, g.R_hub, g.R_tip, "var(--s3)", null, rotors[0]);
  if (state.config.geom.stator_on && g.stator_hub != null && g.stator_tip != null)
    disk(g.x_stator, g.stator_hub, g.stator_tip, "var(--s4)", "5 4", rotors[1]);
  // dimension callouts
  const label = (x, y, t, anchor = "middle") => add("text", { x, y, "text-anchor": anchor, fill: "var(--muted)", "font-size": 11, "font-family": "var(--font)", text: t });
  label(X(g.x_rotor), Y(rmax) - 6, "rotor");
  if (state.config.geom.stator_on) label(X(g.x_stator), Y(-rmax) + 14, "stator");
  label(X(g.duct_x_le) - 4, oy + 4, "LE", "end");
  label(X(g.duct_x_te) + 4, oy + 4, "TE", "start");
  const D = g.R_tip * 2;
  $("#preview-dims").textContent = `Ø ${fmt(D * 1000, 0)} mm fan · duct chord ${fmt(g.duct_chord * 1000, 0)} mm · length ${fmt(Math.max(g.cb_x_te, g.duct_x_te) * 1000, 0)} mm · hub Ø ${fmt(g.R_hub * 2000, 0)} mm · rotor plane at ¼ chord`;
  const w = $("#preview-warn"); w.hidden = !g.warnings.length; w.textContent = g.warnings.join("  ");
}

// ---------------------------------------------------------------------------
// section (airfoil) geometry for drawing only
// ---------------------------------------------------------------------------
function naca4Coords(code, n = 50) {
  const m = parseInt(code[0]) / 100, p = parseInt(code[1]) / 10, t = parseInt(code.slice(2)) / 100;
  const up = [], lo = [];
  for (let i = 0; i < n; i++) {
    const x = 0.5 * (1 - Math.cos(Math.PI * i / (n - 1)));
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    let yc = 0, dyc = 0;
    if (m > 0 && p > 0) {
      if (x < p) { yc = m / p / p * (2 * p * x - x * x); dyc = 2 * m / p / p * (p - x); }
      else { yc = m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x * x); dyc = 2 * m / (1 - p) ** 2 * (p - x); }
    }
    const th = Math.atan(dyc);
    up.push([x - yt * Math.sin(th), yc + yt * Math.cos(th)]);
    lo.push([x + yt * Math.sin(th), yc - yt * Math.cos(th)]);
  }
  return up.concat(lo.reverse());
}
function sectionSVG(code, w, h, angleDeg = 0, color = "var(--s3)") {
  const svg = el("svg:svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h });
  const pts = naca4Coords(code);
  const a = -angleDeg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  const sc = w * 0.86, cx = w * 0.07, cy = h / 2;
  const d = pts.map(([x, y], i) => {
    const xr = (x - 0.5) * cs - y * sn, yr = (x - 0.5) * sn + y * cs;
    return (i ? "L" : "M") + (cx + sc * (xr + 0.5)).toFixed(1) + " " + (cy - sc * yr).toFixed(1);
  }).join(" ") + " Z";
  svg.append(el("svg:path", { d, fill: color, "fill-opacity": .25, stroke: color, "stroke-width": 1.5, "stroke-linejoin": "round" }));
  return svg;
}

// ---------------------------------------------------------------------------
// generic SVG line chart with hover
// ---------------------------------------------------------------------------
function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) { hi = lo + 1; }
  const span = hi - lo, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw)), r = raw / mag;
  const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  const t0 = Math.ceil(lo / step) * step, ticks = [];
  for (let t = t0; t <= hi + step * 1e-6; t += step) ticks.push(+t.toFixed(10));
  return ticks;
}
function lineChart(host, { title, series, xLabel, yLabel, invertY = false, height = 210, xFmt = v => fmtSig(v, 3), yFmt = v => fmtSig(v, 3), yZero = false, markers = false }) {
  const wrap = el("div", { class: "chart" });
  if (title) wrap.append(el("div", { class: "chart-title", text: title }));
  host.append(wrap);
  // draw on the next frame so a grid cell is measured after all its siblings exist
  requestAnimationFrame(() => drawLineChart(wrap, { series, xLabel, yLabel, invertY, height, xFmt, yFmt, yZero, markers }));
}
function drawLineChart(wrap, { series, xLabel, yLabel, invertY, height, xFmt, yFmt, yZero, markers }) {
  const W = Math.max(280, wrap.clientWidth || 500), H = height, m = { l: 54, r: 14, t: 10, b: 38 };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of series) for (const [x, y] of s.points) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (!Number.isFinite(x0)) { wrap.append(el("div", { class: "muted", text: "no data" })); return; }
  if (yZero) { y0 = Math.min(0, y0); y1 = Math.max(0, y1); }
  if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.06; y0 -= pad; y1 += pad;
  const xt = niceTicks(x0, x1, 6), yt = niceTicks(y0, y1, 5);
  const sx = x => m.l + (x - x0) / (x1 - x0) * (W - m.l - m.r);
  const sy = y => invertY ? m.t + (y - y0) / (y1 - y0) * (H - m.t - m.b) : H - m.b - (y - y0) / (y1 - y0) * (H - m.t - m.b);
  const svg = el("svg:svg", { viewBox: `0 0 ${W} ${H}`, height: H });
  const grid = el("svg:g", { class: "grid" }), axis = el("svg:g", { class: "axis" }), labels = el("svg:g");
  for (const t of yt) { grid.append(el("svg:line", { x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t) })); labels.append(el("svg:text", { x: m.l - 6, y: sy(t) + 4, "text-anchor": "end", text: yFmt(t) })); }
  for (const t of xt) { if (t < x0 || t > x1) continue; labels.append(el("svg:text", { x: sx(t), y: H - m.b + 16, "text-anchor": "middle", text: xFmt(t) })); }
  axis.append(el("svg:line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }));
  if (xLabel) labels.append(el("svg:text", { x: (m.l + W - m.r) / 2, y: H - 4, "text-anchor": "middle", text: xLabel }));
  if (yLabel) labels.append(el("svg:text", { x: 12, y: (m.t + H - m.b) / 2, "text-anchor": "middle", transform: `rotate(-90 12 ${(m.t + H - m.b) / 2})`, text: yLabel }));
  const sg = el("svg:g", { class: "series" });
  for (const s of series) {
    if (!s.points.length) continue;
    sg.append(el("svg:path", { d: s.points.map((p, i) => (i ? "L" : "M") + sx(p[0]).toFixed(1) + " " + sy(p[1]).toFixed(1)).join(" "), stroke: s.color }));
    if (markers) for (const p of s.points) sg.append(el("svg:circle", { cx: sx(p[0]), cy: sy(p[1]), r: 3.5, fill: s.color }));
  }
  const hover = el("svg:g", { visibility: "hidden" }, [
    el("svg:line", { class: "crosshair", y1: m.t, y2: H - m.b }), el("svg:circle", { class: "hover-pt", r: 5 })]);
  const overlay = el("svg:rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" });
  svg.append(grid, axis, labels, sg, hover, overlay);
  wrap.append(svg);
  if (series.length > 1) wrap.append(el("div", { class: "chart-legend" }, series.map(s => el("span", { class: "key" }, [el("i", { style: "background:" + s.color }), s.name]))));
  const tip = $("#tooltip");
  overlay.addEventListener("mousemove", ev => {
    const r = svg.getBoundingClientRect(), k = W / r.width;
    const mx = (ev.clientX - r.left) * k, my = (ev.clientY - r.top) * k;
    let best = null, bd = Infinity;
    for (const s of series) for (const p of s.points) { const d = (sx(p[0]) - mx) ** 2 + (sy(p[1]) - my) ** 2 * 0.5; if (d < bd) { bd = d; best = { s, p }; } }
    if (!best) return;
    hover.setAttribute("visibility", "visible");
    hover.firstChild.setAttribute("x1", sx(best.p[0])); hover.firstChild.setAttribute("x2", sx(best.p[0]));
    hover.lastChild.setAttribute("cx", sx(best.p[0])); hover.lastChild.setAttribute("cy", sy(best.p[1])); hover.lastChild.setAttribute("fill", best.s.color);
    tip.hidden = false; tip.innerHTML = `<b>${best.s.name}</b><br>${xLabel || "x"}: ${xFmt(best.p[0])}<br>${yLabel || "y"}: ${yFmt(best.p[1])}`;
    tip.style.left = (ev.clientX + 14) + "px"; tip.style.top = (ev.clientY + 14) + "px";
  });
  overlay.addEventListener("mouseleave", () => { hover.setAttribute("visibility", "hidden"); tip.hidden = true; });
}

// ---------------------------------------------------------------------------
// running
// ---------------------------------------------------------------------------
async function run(quiet = false) {
  const btn = $("#run-btn");
  btn.disabled = true; btn.classList.add("busy"); btn.textContent = state.mode === "design" ? "Designing…" : "Solving…";
  setStatus("solving…");
  state.config.name = $("#case-name").value.trim() || "Fan";
  const snapshot = JSON.stringify(state.config) + state.mode;
  try {
    const t0 = performance.now();
    const res = await postJSON("/api/run", { mode: state.mode, config: deepClone(state.config), rotors: state.rotors });
    state.result = res;
    if (res.rotors && res.rotors.length && res.rotors[0].kind === "rotor") {
      state.rotors = res.rotors; save("fan.rotors", state.rotors);
      const g = res.geometry;
      state.rotorsGeom = { R_hub: g.R_hub, R_tip: g.R_tip, stator_hub: g.stator_hub, stator_tip: g.stator_tip };
      save("fan.rotorsGeom", state.rotorsGeom);
    }
    // only clear "stale" if nothing changed while DFDC was running
    if (JSON.stringify(state.config) + state.mode === snapshot) { state.stale = false; state.geom = res.geometry; drawPreview(); }
    else update3DBlades();
    renderResults();
    refreshControlState();
    const dt = ((performance.now() - t0) / 1000).toFixed(1);
    setStatus(`${dt} s · ${res.total.thrust != null ? fmt(res.total.thrust, 0) + " N" : ""}`);
    if (!quiet) toast(`DFDC finished in ${dt} s · ${res.total.thrust != null ? fmt(res.total.thrust, 0) + " N" : ""}`);
    lastErr = "";
  } catch (e) {
    const first = e.message.split("\n")[0];
    setStatus("failed");
    if (!quiet || first !== lastErr) toast(first, true, 8000);
    lastErr = first;
    $("#log").textContent = e.message; if (!quiet) showTab("log");
  } finally { btn.disabled = false; btn.classList.remove("busy"); btn.textContent = "Run DFDC"; }
}

// ---------------------------------------------------------------------------
// results
// ---------------------------------------------------------------------------
function showTab(id) {
  state.activeTab = id;
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === id));
  $$(".tab-body").forEach(b => (b.hidden = b.id !== "tab-" + id));
  if (id === "blades" || id === "pressure") renderResults(id);   // charts need a visible width
  if (id === "section") renderSectionTab();
}
function renderResults(only) {
  const r = state.result; if (!r) return;
  if (!only || only === "summary") renderSummary(r);
  if ((!only || only === "blades") && !$("#tab-blades").hidden) renderBlades(r);
  if ((!only || only === "pressure") && !$("#tab-pressure").hidden) renderPressure(r);
  if (!only) { $("#log").textContent = r.log; renderSectionTab(); }
}

function tile(label, value, unit, sub, cls = "") {
  return el("div", { class: "tile " + cls }, [el("div", { class: "tl", text: label }),
    el("div", { class: "tv", html: value + (unit ? `<small>${unit}</small>` : "") }), sub ? el("div", { class: "ts", text: sub }) : null]);
}
function renderSummary(r) {
  const t = r.total, rot = r.disks[0] || {}, st = r.disks[1];
  const cfg = state.config, hover = cfg.oper.vinf < 0.5;
  const host = $("#summary"); host.innerHTML = ""; host.hidden = false; $("#summary-empty").hidden = true;
  const R = rot.radius || r.geometry.R_tip, area = Math.PI * (R * R - (rot.r_hub || 0) ** 2);
  const tipSpeed = cfg.oper.rpm * 2 * Math.PI / 60 * R, tipMach = tipSpeed / (r.atmosphere.vso || 340);
  const target = cfg.oper.target_mode === "thrust" && (state.mode === "design" || cfg.oper.analyze_trim) ? cfg.oper.thrust : null;
  const sepLoss = r.bl && r.bl.thrust_change < -0.5 ? ` · ≈ ${fmt(r.bl.corrected_thrust, 0)} N after separation` : "";
  const tiles = el("div", { class: "tiles" }, [
    tile("Total thrust (inviscid)", fmt(t.thrust, 0), "N", (target ? `target ${fmt(target, 0)} N (${t.thrust >= target ? "+" : ""}${fmt(100 * (t.thrust - target) / target, 1)} %)` : "") + sepLoss, "hero" + (sepLoss ? " hero-warn" : "")),
    tile("Shaft power", fmt(t.power / 1000, 2), "kW", `torque ${fmt(t.torque, 1)} N·m`),
    hover ? tile("Figure of merit", fmt(t.fom, 3), "", "DFDC definition, rotor disk area") : tile("Propulsive efficiency", fmt(100 * t.efficiency, 1), "%", `T·V / P at ${fmt(cfg.oper.vinf, 1)} m/s`),
    tile("Duct thrust", fmt(t.t_duct, 0), "N", t.thrust ? `${fmt(100 * t.t_duct / t.thrust, 0)} % of total` : null),
    tile("Rotor thrust", fmt(rot.thrust, 0), "N", st ? `stator ${fmt(st.thrust, 1)} N` : null),
    tile("Power loading", fmt(t.thrust / (t.power / 1000), 1), "N/kW", `disk loading ${fmt(t.thrust / area, 0)} N/m²`),
    tile("Tip speed", fmt(tipSpeed, 0), "m/s", `Mach ${fmt(tipMach, 2)}`),
    tile("Mean axial velocity", fmt(rot.va_avg, 1), "m/s", "at the rotor disk"),
    tile("Rotor solidity", fmt(rot.sigma, 3), "", rot.rows?.length ? `tip chord ${fmt((rot.rows.at(-1).c_R || 0) * R * 1000, 1)} mm` : null),
    tile("Viscous loss", fmt(t.t_visc, 1), "N", t.p_visc != null ? `${fmt(t.p_visc, 0)} W profile power` : null),
  ]);
  host.append(tiles);
  // ---- separation / diffuser check (integral BL on DFDC's wall velocities) ----
  const bl = r.bl || {}, di = bl.duct_inner, cb = bl.centerbody, dz = bl.diffuser;
  const sepTiles = [];
  if (di) {
    const sub = di.separated ? `${fmt(di.sep_fraction * 100, 0)} % of the wall stalled · transition at ${fmt(di.x_tr * 1000, 0)} mm`
      : di.te_only ? `trailing-edge separation only · transition at ${fmt((di.x_tr ?? 0) * 1000, 0)} mm` : `attached to the exit · max H ${fmt(Math.max(...di.H), 2)}`;
    sepTiles.push(tile("Duct inner wall BL", di.separated ? `sep. ${fmt(di.x_sep * 1000, 0)}` : "attached", di.separated ? "mm" : "", sub, di.separated ? "bad" : "ok"));
  }
  if (cb) sepTiles.push(tile("Centerbody BL", cb.separated ? `sep. ${fmt(cb.x_sep * 1000, 0)}` : "attached", cb.separated ? "mm" : "",
    cb.separated ? `${fmt(cb.sep_fraction * 100, 0)} % of the body stalled` : "to the tail", cb.separated ? "warnish" : "ok"));
  if (dz) sepTiles.push(tile("Equivalent cone", fmt(dz.cone_angle, 1), "°", `AR ${fmt(dz.area_ratio, 2)} · L/R ${fmt(dz.l_over_r, 1)} · first stall ≈ ${fmt(dz.first_stall_angle, 0)}° → ${dz.verdict}`,
    dz.verdict === "fully stalled" ? "bad" : dz.verdict === "transitory stall" || dz.verdict === "marginal" ? "warnish" : "ok"));
  if (bl.thrust_change != null && Math.abs(bl.thrust_change) > 0.5)
    sepTiles.push(tile("Separation-corrected thrust", fmt(bl.corrected_thrust, 0), "N", `${fmt(bl.thrust_change, 0)} N: inviscid credit downstream of separation removed (dead-air plateau estimate)`, "bad"));
  if (sepTiles.length) {
    host.append(el("div", { class: "subhead", text: "Flow separation check" }), el("div", { class: "tiles" }, sepTiles),
      el("p", { class: "note", style: "margin:8px 0 0", text: "DFDC is inviscid: it will keep rewarding a wider diffuser no matter how badly it stalls. This check marches an integral boundary layer (Thwaites → Michel transition → Head's method, separation at H = 2.4) along the wall velocities DFDC computed, and compares the exit expansion with the conical-diffuser first-stall line. It is a diagnostic, not a coupled viscous solution." }));
  }
  if (r.forces && r.forces.elements) {
    const names = ["Centerbody", "Duct"];
    const rows = r.forces.elements.filter(e => e.index <= 2).map(e =>
      el("tr", {}, [el("td", { text: names[e.index - 1] }), el("td", { text: fmt(-e.fx, 1) }), el("td", { text: fmt(-e.fx_inv, 1) }), el("td", { text: fmt(-e.fx_vis, 2) })]));
    host.append(el("div", { class: "subhead", text: "Body forces (thrust positive)" }),
      el("table", { class: "data" }, [el("thead", {}, el("tr", {}, ["Element", "Net N", "Pressure N", "Friction N"].map(h => el("th", { text: h })))), el("tbody", {}, rows)]));
  }
  if (r.warnings.length) host.append(el("ul", { class: "warnings" }, r.warnings.map(w => el("li", { text: w }))));
  const atm = r.atmosphere;
  host.append(el("div", { class: "actions" }, [
    el("a", { href: "/api/case/" + r.run_id, download: "fan.case", text: "Download DFDC case file" }),
    el("span", { class: "muted", text: "·" }),
    el("button", { class: "small-btn", text: "Copy blade table (CSV)", onclick: () => copyBladeCSV(r) }),
    el("span", { class: "muted", style: "margin-left:auto", text: `ρ ${fmt(atm.rho, 3)} kg/m³ · a ${fmt(atm.vso, 0)} m/s · ${r.passes} DFDC pass${r.passes > 1 ? "es" : ""} · ${fmt(r.elapsed, 1)} s` }),
  ]));
}

function copyBladeCSV(r) {
  const lines = ["disk,station,r_m,r_over_R,chord_m,beta_deg,CL,CD,Re,Mach,BGamma"];
  r.disks.forEach((d, di) => {
    const geo = (r.rotors[di] || {}).stations || [];
    d.rows.forEach((row, i) => {
      const g = geo[i] || [];
      lines.push([d.label.trim(), row.i, g[0] ?? row.r_R * d.radius, row.r_R, g[1] ?? (row.c_R || 0) * d.radius, g[2] ?? row.beta, row.cl, row.cd, row.re, row.mach, row.bgam].map(v => v == null ? "" : v).join(","));
    });
  });
  navigator.clipboard?.writeText(lines.join("\n")).then(() => toast("Blade table copied"), () => toast("Clipboard blocked", true));
}

function renderBlades(r) {
  const host = $("#tab-blades"); host.innerHTML = "";
  const disks = r.disks.filter(d => d.rows.length && d.rows[0].c_R != null);
  if (!disks.length) { host.append(el("p", { class: "muted", text: "No bladed disk in this result." })); return; }
  const colors = ["var(--s3)", "var(--s4)"];
  const views = el("div", { class: "views" });
  host.append(views);
  views.append(frontView(r, disks, colors), planformView(r, disks, colors));
  const grid = el("div", { class: "chart-grid", style: "margin-top:14px" });
  host.append(grid);
  const mk = (title, key, yLabel, opts = {}) => lineChart(grid, { title, xLabel: "r / R", yLabel, markers: true, height: 200,
    series: disks.map((d, i) => ({ name: d.label.trim(), color: colors[i], points: d.rows.map(row => [row.r_R, typeof key === "function" ? key(row, d) : row[key]]).filter(p => p[1] != null) })), ...opts });
  mk("Blade angle β", "beta", "deg", { yFmt: v => fmt(v, 0) });
  mk("Chord", (row, d) => row.c_R * d.radius * 1000, "mm", { yZero: true, yFmt: v => fmt(v, 0) });
  mk("Section lift coefficient", "cl", "CL", { yZero: true });
  mk("Section drag coefficient", "cd", "CD", { yZero: true, yFmt: v => fmt(v, 4) });
  mk("Circulation B·Γ", "bgam", "m²/s", { yZero: true });
  mk("Local Mach", "mach", "M", { yZero: true });
  mk("Reynolds number", (row) => row.re / 1e3, "Re ×10³", { yZero: true, yFmt: v => fmt(v, 0) });
  mk("Lift-to-drag", (row) => row.cd ? Math.abs(row.cl) / row.cd : null, "L/D", { yZero: true, yFmt: v => fmt(v, 0) });
  // station table
  for (const [i, d] of disks.entries()) {
    const geo = (r.rotors[i] || {}).stations || [];
    host.append(el("div", { class: "subhead", text: d.label.trim() + ` · ${d.nblades} blades` }));
    host.append(el("div", { class: "scroll-x" }, el("table", { class: "data" }, [
      el("thead", {}, el("tr", {}, ["#", "r (mm)", "r/R", "chord (mm)", "β (°)", "CL", "CD", "Re ×10³", "Mach", "B·Γ"].map(h => el("th", { text: h })))),
      el("tbody", {}, d.rows.map((row, k) => el("tr", { class: row.stalled ? "stalled" : "", title: row.stalled ? "stalled" : null }, [
        row.i, fmt((geo[k]?.[0] ?? row.r_R * d.radius) * 1000, 1), fmt(row.r_R, 3), fmt((geo[k]?.[1] ?? row.c_R * d.radius) * 1000, 1),
        fmt(geo[k]?.[2] ?? row.beta, 2), fmt(row.cl, 3) + (row.stalled ? " s" : ""), fmt(row.cd, 4), fmt(row.re / 1e3, 0), fmt(row.mach, 3), fmt(row.bgam, 2),
      ].map(v => el("td", { text: v })))))])));
  }
}

function frontView(r, disks, colors) {
  const box = el("div", { class: "view" }, [el("div", { class: "vt", text: "Looking into the inlet (rotor solid, stator outlined)" })]);
  const svg = el("svg:svg", { viewBox: "-1.25 -1.25 2.5 2.5" }); box.append(svg);
  const R = r.geometry.R_duct_at_rotor;
  const Rt = r.geometry.R_tip;
  const outerR = Math.max(...r.geometry.duct.map(p => p[1])) / Rt;
  svg.append(el("svg:circle", { r: outerR, fill: "var(--s1)", "fill-opacity": .18, stroke: "var(--s1)", "stroke-width": .015 }));
  svg.append(el("svg:circle", { r: R / Rt, fill: "var(--surface)", stroke: "var(--s1)", "stroke-width": .015 }));
  disks.forEach((d, i) => {
    const geo = (r.rotors[i] || {}).stations || [];
    if (!geo.length) return;
    const n = d.nblades || 1;
    for (let b = 0; b < n; b++) {
      const a0 = b * 2 * Math.PI / n;
      const pts = [];
      // chord projected on the rotation plane; leading edge 0.25 c ahead of the radial (pitch) axis, TE 0.75 c behind
      const side = (frac) => geo.map(([rr, c, beta]) => {
        const ang = a0 + frac * (c * Math.cos(beta * Math.PI / 180)) / rr, rn = rr / Rt;
        return [rn * Math.cos(ang), -rn * Math.sin(ang)];
      });
      const L = side(0.25), T = side(-0.75).reverse();
      const d_ = L.concat(T).map((p, k) => (k ? "L" : "M") + p[0].toFixed(4) + " " + p[1].toFixed(4)).join(" ") + " Z";
      svg.append(el("svg:path", { d: d_, fill: colors[i], "fill-opacity": i ? 0.12 : 0.6, stroke: colors[i], "stroke-width": .012, "stroke-dasharray": i ? ".03 .02" : null }));
    }
  });
  svg.append(el("svg:circle", { r: r.geometry.R_hub / Rt, fill: "var(--s2)", "fill-opacity": .35, stroke: "var(--s2)", "stroke-width": .015 }));
  return box;
}

function planformView(r, disks, colors) {
  const box = el("div", { class: "view" }, [el("div", { class: "vt", text: "Developed planform - chord laid flat against radius" })]);
  const svg = el("svg:svg", { viewBox: "0 0 100 56", preserveAspectRatio: "xMidYMid meet" }); box.append(svg);
  const Rt = r.geometry.R_tip, Rh = r.geometry.R_hub;
  let cmax = 0.001;
  disks.forEach((d, i) => { for (const s of (r.rotors[i] || {}).stations || []) cmax = Math.max(cmax, s[1]); });
  const sx = rr => 6 + (rr / Rt) * 88, sc = 24 / cmax;
  svg.append(el("svg:line", { x1: sx(0), x2: sx(1.02 * Rt), y1: 28, y2: 28, stroke: "var(--axis)", "stroke-width": .4, "stroke-dasharray": "1.5 1" }));
  svg.append(el("svg:rect", { x: sx(0), y: 28 - 4, width: sx(Rh) - sx(0), height: 8, fill: "var(--s2)", "fill-opacity": .35 }));
  svg.append(el("svg:line", { x1: sx(Rt), x2: sx(Rt), y1: 4, y2: 52, stroke: "var(--s1)", "stroke-width": .5 }));
  disks.forEach((d, i) => {
    const geo = (r.rotors[i] || {}).stations || [];
    if (!geo.length) return;
    const top = geo.map(([rr, c]) => [sx(rr), 28 - 0.25 * c * sc]), bot = geo.map(([rr, c]) => [sx(rr), 28 + 0.75 * c * sc]).reverse();   // pitch axis at quarter chord
    svg.append(el("svg:path", { d: top.concat(bot).map((p, k) => (k ? "L" : "M") + p[0].toFixed(2) + " " + p[1].toFixed(2)).join(" ") + " Z",
      fill: colors[i], "fill-opacity": i ? .12 : .55, stroke: colors[i], "stroke-width": .5, "stroke-dasharray": i ? "1.2 .8" : null }));
  });
  for (const f of [0.25, 0.5, 0.75, 1]) svg.append(el("svg:text", { x: sx(f * Rt), y: 55, "text-anchor": "middle", "font-size": 3, fill: "var(--muted)", "font-family": "var(--font)", text: f === 1 ? "tip" : f.toFixed(2) + " R" }));
  return box;
}

function renderPressure(r) {
  const host = $("#tab-pressure"); host.innerHTML = "";
  if (!r.cp.duct.length) { host.append(el("p", { class: "muted", text: "No pressure data." })); return; }
  host.append(el("p", { class: "note", style: "margin:0 0 8px", text: `Surface pressure coefficient referenced to ${fmt(r.vref, 0)} m/s (−Cp plotted upward, the aerodynamic convention). The duct curve runs outer surface TE → LE → inner surface TE; the jump on the inner surface is the rotor.` }));
  const grid = el("div", { class: "chart-grid" }); host.append(grid);
  const series = (key) => [
    { name: "Duct", color: "var(--s1)", points: r.cp.duct.map(p => [p[0] * 1000, p[key]]) },
    { name: "Centerbody", color: "var(--s2)", points: r.cp.centerbody.map(p => [p[0] * 1000, p[key]]) },
  ];
  lineChart(grid, { title: "Wall pressure", series: series(2), xLabel: "x (mm)", yLabel: "Cp", invertY: true, height: 280, xFmt: v => fmt(v, 0), yFmt: v => fmt(v, 2) });
  lineChart(grid, { title: "Wall velocity", series: series(3), xLabel: "x (mm)", yLabel: "m/s", height: 280, yZero: true, xFmt: v => fmt(v, 0), yFmt: v => fmt(v, 0) });
  // boundary layer along the walls (integral march on DFDC's Ue)
  const bl = r.bl || {};
  const walls = [["Duct inner wall", bl.duct_inner, "var(--s1)"], ["Centerbody", bl.centerbody, "var(--s2)"]].filter(w => w[1]);
  if (walls.length) {
    const xr = walls.flatMap(([, w]) => w.x);
    const lim = { name: "H = 2.4 separation limit", color: "var(--crit)", points: [[Math.min(...xr) * 1000, 2.4], [Math.max(...xr) * 1000, 2.4]] };
    lineChart(grid, { title: "Boundary-layer shape factor H", xLabel: "x (mm)", yLabel: "H", height: 280, yZero: true, xFmt: v => fmt(v, 0), yFmt: v => fmt(v, 1),
      series: walls.map(([n, w, c]) => ({ name: n, color: c, points: w.x.map((x, i) => [x * 1000, Math.min(w.H[i], 4)]).filter((p, i) => i >= w.i_start) })).concat([lim]) });
    lineChart(grid, { title: "Skin friction coefficient", xLabel: "x (mm)", yLabel: "Cf", height: 280, yZero: true, xFmt: v => fmt(v, 0), yFmt: v => fmt(v, 4),
      series: walls.map(([n, w, c]) => ({ name: n, color: c, points: w.x.map((x, i) => [x * 1000, Math.min(w.cf[i], 0.02)]).filter((p, i) => i >= w.i_start) })) });
    host.append(el("p", { class: "note", style: "margin:8px 0 0", text: walls.map(([n, w]) => `${n}: ${w.x_tr != null ? "transition " + fmt(w.x_tr * 1000, 0) + " mm, " : "laminar throughout, "}${w.separated ? "separates at " + fmt(w.x_sep * 1000, 0) + " mm" : w.te_only ? "trailing-edge separation only" : "attached"}`).join(" · ") + ". The H = 2.4 limit applies to the turbulent part (after transition); a laminar layer runs at H ≈ 2.6 and rises toward 3.5 before it separates or transitions." }));
  }
  const wk = r.cp.wakes || {};
  if (wk.duct || wk.centerbody) {
    lineChart(grid, { title: "Trailing wake pressure (downstream of the TEs)", xLabel: "x (mm)", yLabel: "Cp", invertY: true, height: 280, xFmt: v => fmt(v, 0), yFmt: v => fmt(v, 2),
      series: [wk.duct && { name: "Duct wake", color: "var(--s1)", points: wk.duct.map(p => [p[0] * 1000, p[2]]) },
               wk.centerbody && { name: "Centerbody wake", color: "var(--s2)", points: wk.centerbody.map(p => [p[0] * 1000, p[2]]) }].filter(Boolean) });
  }
}

// ---------------------------------------------------------------------------
// section tab: what the solver thinks the airfoil does
// ---------------------------------------------------------------------------
function clcd(aero, alphaDeg) {
  // 2-D, incompressible slice of DFDC's CLCDCM model (no cascade / Mach / Re terms)
  const a = alphaDeg * Math.PI / 180;
  const cla = aero.dclda * (a - aero.a0deg * Math.PI / 180);
  const ecmax = Math.exp(Math.min(200, (cla - aero.clmax) / aero.dcl_stall)), ecmin = Math.exp(Math.min(200, (aero.clmin - cla) / aero.dcl_stall));
  const cllim = aero.dcl_stall * Math.log((1 + ecmax) / (1 + ecmin));
  const fstall = aero.dclda_stall / aero.dclda;
  const cl = cla - (1 - fstall) * cllim;
  const dcdx = (1 - fstall) * cllim / aero.dclda;
  const cd = aero.cdmin + aero.dcdcl2 * (cl - aero.clcdmin) ** 2 + 2 * dcdx * dcdx;
  return [cl, cd];
}
/** Radial-in view: every DFDC station's section outline, stacked about the pitch
    axis (quarter chord on the disk plane), coloured root -> tip red -> violet.
    Rotation plane horizontal; the blade moves to the right, inflow comes from the top. */
function stackView(stations, naca, mirror, pitchDelta, title) {
  const box = el("div", { class: "view stack" }, [el("div", { class: "vt", text: "Radial-in view: section at each station stacked on the pitch axis · blade moves right · inflow from top" })]);
  if (!stations || stations.length < 2) { box.append(el("p", { class: "muted", style: "padding:40px 10px", text: "Run a design to see the stacked stations." })); return box; }
  const prof = sectionLoop(naca, 60, mirror);
  const st = stations.slice().sort((a, b) => a[0] - b[0]);
  const loops = st.map(([r, c, bd]) => {
    const beta = (bd + pitchDelta) * Math.PI / 180, ch = [-Math.cos(beta), Math.sin(beta)], nh = [-Math.sin(beta), -Math.cos(beta)];
    return prof.map(([xi, eta]) => [c * 1000 * ((xi - 0.25) * ch[0] + eta * nh[0]), c * 1000 * ((xi - 0.25) * ch[1] + eta * nh[1])]);  // mm, (tangential, axial)
  });
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const L of loops) for (const [x, y] of L) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const W = 420, H = 300, m = 30;
  const sc = Math.min((W - 2 * m) / ((x1 - x0) || 1), (H - 2 * m) / ((y1 - y0) || 1));
  const cx = W / 2 - ((x0 + x1) / 2) * sc, cy = H / 2 - ((y0 + y1) / 2) * sc;
  const X = x => cx + x * sc, Y = y => cy + y * sc;                              // axial +x (downstream) = down on screen
  const svg = el("svg:svg", { viewBox: `0 0 ${W} ${H}`, style: "height:300px" });
  // pitch axis + rotation plane
  svg.append(el("svg:line", { x1: X(x0 - 10), x2: X(x1 + 10), y1: Y(0), y2: Y(0), stroke: "var(--axis)", "stroke-dasharray": "4 3" }));
  svg.append(el("svg:circle", { cx: X(0), cy: Y(0), r: 3, fill: "var(--ink-2)" }));
  const n = loops.length;
  loops.forEach((L, i) => {
    const hue = 270 * i / Math.max(1, n - 1);
    const d = L.map((p, k) => (k ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join(" ") + " Z";
    svg.append(el("svg:path", { d, fill: `hsl(${hue} 85% 55% / 0.10)`, stroke: `hsl(${hue} 85% 50%)`, "stroke-width": 1.4, "stroke-linejoin": "round" }));
  });
  const lab = (x, y, t, a = "start") => svg.append(el("svg:text", { x, y, "text-anchor": a, fill: "var(--muted)", "font-size": 11, "font-family": "var(--font)", text: t }));
  lab(W - 8, Y(0) - 5, "rotation plane →", "end");
  lab(8, 14, "inflow ↓");
  lab(W - 8, H - 8, `${n} stations · root ${fmt(st[0][0] * 1000, 0)} mm → tip ${fmt(st[n - 1][0] * 1000, 0)} mm`, "end");
  box.append(svg);
  // root -> tip legend
  const stops = Array.from({ length: 7 }, (_, i) => `hsl(${270 * i / 6} 85% 50%)`).join(",");
  box.append(el("div", { class: "stack-legend" }, [el("span", { text: "root" }), el("i", { style: `background:linear-gradient(90deg,${stops})` }), el("span", { text: "tip" })]));
  return box;
}

function renderSectionTab() {
  const host = $("#tab-section"); host.innerHTML = "";
  const which = [["rotor", "Rotor blade section", "var(--s3)"]];
  if (state.config.geom.stator_on) which.push(["stator", "Stator vane section", "var(--s4)"]);
  for (const [key, title, color] of which) {
    const spec = state.config[key].airfoil;
    const p = state.airfoils.find(a => a.id === spec.preset); if (!p) continue;
    const aero = { ...p.aero, ...spec.overrides };
    host.append(el("div", { class: "subhead", text: title + " · " + p.name }));
    const row = el("div", { class: "section-views" }); host.append(row);
    // radial-in stack of every station's outline, root (red) to tip (violet)
    const saved = (state.rotors || [])[key === "rotor" ? 0 : 1];
    const pitch = state.mode === "analyze" && !state.config.oper.analyze_trim ? state.config.oper.pitch_delta || 0 : 0;
    row.append(stackView(saved && saved.kind === "rotor" ? saved.stations : null, p.naca, key === "stator", pitch, title));
    const alphas = []; for (let a = -12; a <= 22; a += 0.5) alphas.push(a);
    const pol = alphas.map(a => [a, ...clcd(aero, a)]);
    const c1 = el("div"), c2 = el("div"); row.append(c1, c2);
    lineChart(c1, { title: "Lift curve (2-D model)", series: [{ name: p.name, color, points: pol.map(q => [q[0], q[1]]) }], xLabel: "α (deg)", yLabel: "CL", height: 200, yZero: true, xFmt: v => fmt(v, 0), yFmt: v => fmt(v, 1) });
    lineChart(c2, { title: "Drag polar (2-D model)", series: [{ name: p.name, color, points: pol.filter(q => q[2] < 0.15).map(q => [q[1], q[2]]) }], xLabel: "CL", yLabel: "CD", height: 200, yZero: true, xFmt: v => fmt(v, 1), yFmt: v => fmt(v, 3) });
  }
  host.append(el("p", { class: "note", style: "margin-top:12px", text: "DFDC does not use airfoil coordinates. Each blade section is a parametric polar (lift slope, CLmax/CLmin with a soft stall, a quadratic drag bucket, Reynolds and Mach corrections, and a cascade correction for solidity). The presets are representative fits to published data; edit the parameters in the sidebar to match a measured polar." }));
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
window.addEventListener("error", ev => { toast("Script error: " + ev.message, true, 10000); document.body.dataset.jserr = (document.body.dataset.jserr || "") + ev.message + " @" + (ev.filename || "").split("/").pop() + ":" + ev.lineno + "; "; });
window.addEventListener("unhandledrejection", ev => { document.body.dataset.jserr = (document.body.dataset.jserr || "") + "rejection: " + (ev.reason?.message || ev.reason) + "; "; });

async function boot() {
  const theme = load("fan.theme"); if (theme) document.documentElement.dataset.theme = theme;
  $("#theme-btn").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next; save("fan.theme", next); renderResults(); renderSectionTab(); state.viewer?.setTheme();
  });
  state.viewer = new Viewer3D($("#view3d"));
  for (const k of ["duct", "body", "outlines", "spin"]) $("#opt-" + k).addEventListener("change", ev => state.viewer.setOptions({ [k]: ev.target.checked }));
  $("#opt-reset").addEventListener("click", () => state.viewer.resetView());
  $$(".step-btn").forEach(b => b.addEventListener("click", () => exportStep(b.dataset.what, b)));
  $("#live-chk").checked = state.live;
  $("#live-chk").addEventListener("change", ev => { state.live = ev.target.checked; save("fan.live", state.live); updateBladeStatus(); if (state.live && state.stale) scheduleLiveSolve(); });
  state.airfoils = await (await fetch("/api/airfoils")).json();
  // migrate stale configs (ratio/metre geometry from the first version -> millimetres)
  const og = state.config.geom || {};
  if (og.fan_radius != null && og.fan_dia_mm == null) {
    const R = og.fan_radius, Rh = R * (og.hub_ratio ?? 0.3), c = (og.duct_chord ?? 2) * R;
    state.config.geom = {
      fan_dia_mm: R * 2000, hub_dia_mm: Rh * 2000, tip_gap_mm: og.tip_gap_mm ?? 1,
      duct_chord_mm: c * 1000, duct_thickness: og.duct_thickness, duct_camber: og.duct_camber, duct_camber_pos: og.duct_camber_pos,
      duct_stagger: og.duct_stagger, rotor_pos_mm: (og.rotor_pos ?? 0.4) * c * 1000,
      nose_len_mm: (og.nose_len ?? 1.5) * Rh * 1000, cyl_len_mm: (og.cyl_len ?? 3) * Rh * 1000,
      rotor_x_mm: ((og.nose_len ?? 1.5) + (og.rotor_hub_pos ?? 0.4) * (og.cyl_len ?? 3)) * Rh * 1000,
      tail_len_mm: (og.tail_len ?? 2.5) * Rh * 1000, tail_base_dia_mm: (og.tail_base ?? 0.3) * Rh * 2000,
      stator_on: og.stator_on, stator_gap_mm: (og.stator_gap ?? 0.25) * c * 1000,
    };
    for (const k in state.config.geom) if (typeof state.config.geom[k] === "number") state.config.geom[k] = +state.config.geom[k].toFixed(1);
  }
  for (const k of Object.keys(DEFAULT_CONFIG)) if (typeof DEFAULT_CONFIG[k] === "object") state.config[k] = { ...DEFAULT_CONFIG[k], ...(state.config[k] || {}) };
  // ?set=geom.stator_on:true,oper.vinf:20  and  ?theme=light  (smoke-test hooks)
  const q = new URLSearchParams(location.search);
  if (q.get("theme")) document.documentElement.dataset.theme = q.get("theme");
  for (const kv of (q.get("set") || "").split(",").filter(Boolean)) {
    const [p, v] = kv.split(":"); setPath(state.config, p, v === "true" ? true : v === "false" ? false : isNaN(+v) ? v : +v);
  }
  $("#case-name").value = state.config.name || "My fan";
  buildControls();
  $$(".mode-btn").forEach(b => b.addEventListener("click", () => {
    if (b.disabled) return;
    state.mode = b.dataset.mode; $$(".mode-btn").forEach(x => x.classList.toggle("active", x === b)); refreshControlState();
    update3DBlades(); markStale(); scheduleLiveSolve();
  }));
  $$(".tab").forEach(t => t.addEventListener("click", () => showTab(t.dataset.tab)));
  $("#run-btn").addEventListener("click", run);
  document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") run(); });
  window.addEventListener("resize", debounce(() => { drawPreview(); renderResults(state.activeTab); }, 150));
  // the 3-D card re-lays out when the sidebar/tab heights change
  $("#analyze-tab").addEventListener("click", () => update3DBlades());
  renderSectionTab();
  updateBladeStatus();
  updatePreview();
  // first visit with live solve on: design the blades straight away so the 3-D view has something real
  if (state.live && !state.rotors && !q.has("autorun")) { state.stale = true; scheduleLiveSolve(); }
  // ?autorun&tab=blades : run immediately and open a tab; &analyze re-runs the design in analyze mode
  if (q.has("autorun")) {
    await run();
    if (q.has("analyze") && state.rotors) { state.mode = "analyze"; $$(".mode-btn").forEach(x => x.classList.toggle("active", x.dataset.mode === "analyze")); refreshControlState(); await run(); }
    if (q.get("tab")) showTab(q.get("tab"));
  }
}
boot();
