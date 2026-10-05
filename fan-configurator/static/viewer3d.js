/* 3-D fan viewer: lofted blades (section at every radial station), stator vanes,
   and the duct / centerbody as revolved surfaces.  Pure geometry from the DFDC
   blade table - nothing aerodynamic is computed here.

   DFDC frame:  x axial (downstream +), r radial, blade angle beta measured from
   the plane of rotation (90 deg = chord along the axis).
   Three frame:  the fan axis is built along +Y, then the whole group is rotated
   so downstream points to +X on screen. */
"use strict";

class Viewer3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    container.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    this.camera.position.set(-3.2, 1.9, 3.4);
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.12;
    this.controls.target.set(0.4, 0, 0);
    this.controls.addEventListener("change", () => this.requestRender());

    this.root = new THREE.Group();          // axis along Y inside, rotated so downstream = +X
    this.root.rotation.z = -Math.PI / 2;
    this.scene.add(this.root);
    this.rotorGroup = new THREE.Group();    // spins about Y
    this.staticGroup = new THREE.Group();
    this.root.add(this.rotorGroup, this.staticGroup);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 0.8); key.position.set(-4, 5, 3); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(4, -2, -3); this.scene.add(fill);

    this.options = { duct: true, body: true, outlines: true, spin: true, ductOpacity: 0.28 };
    this.colors = {};
    this.scale = 1;
    this.spinSpeed = 0.35;        // rad/s
    this._last = performance.now();
    this._needs = true;
    this._meshes = {};

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.setTheme();
    this._loop();
  }

  // ---- housekeeping --------------------------------------------------------
  resize() {
    const w = this.container.clientWidth || 300, h = this.container.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.requestRender();
  }
  requestRender() { this._needs = true; }
  _loop() {
    requestAnimationFrame(() => this._loop());
    const now = performance.now(), dt = (now - this._last) / 1000; this._last = now;
    // blades are built with the leading edge toward +phi; a negative rotation about Y moves them that way
    if (this.options.spin && this.rotorGroup.children.length) { this.rotorGroup.rotation.y -= this.spinSpeed * dt; this._needs = true; }
    this.controls.update();
    if (this._needs) { this._needs = false; this.renderer.render(this.scene, this.camera); }
  }
  setTheme() {
    const css = getComputedStyle(document.documentElement);
    const c = k => new THREE.Color(css.getPropertyValue(k).trim() || "#888");
    this.colors = { duct: c("--s1"), body: c("--s2"), rotor: c("--s3"), stator: c("--s4"), ink: c("--ink-2") };
    for (const [k, m] of Object.entries(this._meshes)) {
      if (!m) continue;
      const col = this.colors[k.replace(/Lines$/, "")];
      if (m.material && col) m.material.color.copy(col);
      if (k.endsWith("Lines") && m.material) m.material.color.copy(col.clone().lerp(this.colors.ink, 0.35));
    }
    this.requestRender();
  }
  setOptions(o) {
    Object.assign(this.options, o);
    if (this._meshes.duct) this._meshes.duct.visible = this.options.duct;
    if (this._meshes.ductLines) this._meshes.ductLines.visible = this.options.duct;
    if (this._meshes.body) this._meshes.body.visible = this.options.body;
    for (const k of ["rotorLines", "statorLines"]) if (this._meshes[k]) this._meshes[k].visible = this.options.outlines;
    this.requestRender();
  }
  resetView() { this.camera.position.set(-3.2, 1.9, 3.4); this.controls.target.set(0.4, 0, 0); this.controls.update(); this.requestRender(); }
  _replace(key, obj, group) {
    const old = this._meshes[key];
    if (old) { group.remove(old); old.geometry?.dispose(); old.material?.dispose(); }
    this._meshes[key] = obj || null;
    if (obj) group.add(obj);
  }

  // ---- bodies of revolution -----------------------------------------------
  /** geom: {centerbody:[[x,r]], duct:[[x,r]], R_tip, x_rotor, duct_x_le, duct_x_te} */
  setGeometry(geom) {
    this.geom = geom;
    this.scale = 1 / geom.R_tip;                       // model in units of tip radius
    const s = this.scale;
    const lathe = (pts, closed) => {
      const v = pts.map(([x, r]) => new THREE.Vector2(Math.max(0, r * s), x * s));
      if (closed) v.push(v[0].clone());
      const g = new THREE.LatheGeometry(v, 96);
      g.computeVertexNormals();
      return g;
    };
    const body = new THREE.Mesh(lathe(geom.centerbody, false), new THREE.MeshStandardMaterial({ color: this.colors.body, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide }));
    body.visible = this.options.body;
    this._replace("body", body, this.staticGroup);
    const duct = new THREE.Mesh(lathe(geom.duct, true), new THREE.MeshStandardMaterial({ color: this.colors.duct, roughness: 0.5, metalness: 0.05, transparent: true, opacity: this.options.ductOpacity, side: THREE.DoubleSide, depthWrite: false }));
    duct.visible = this.options.duct; duct.renderOrder = 2;
    this._replace("duct", duct, this.staticGroup);
    // definition rings: leading edge, maximum radius, trailing edge (inner and outer)
    const d = geom.duct, le = d.reduce((a, p) => (p[0] < a[0] ? p : a)), rmax = d.reduce((a, p) => (p[1] > a[1] ? p : a));
    const te = [d[0], d[d.length - 1]];
    const ringPts = [];
    for (const [x, r] of [le, rmax, ...te]) {
      for (let i = 0; i < 96; i++) {
        const a0 = i / 96 * 2 * Math.PI, a1 = (i + 1) / 96 * 2 * Math.PI;
        ringPts.push(r * s * Math.cos(a0), x * s, r * s * Math.sin(a0), r * s * Math.cos(a1), x * s, r * s * Math.sin(a1));
      }
    }
    const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.Float32BufferAttribute(ringPts, 3));
    const rings = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: this.colors.duct, transparent: true, opacity: 0.8 }));
    rings.visible = this.options.duct;
    this._replace("ductLines", rings, this.staticGroup);
    // centre the orbit target on the duct
    const xm = (geom.duct_x_le + geom.duct_x_te) / 2 * s;
    this.controls.target.set(xm, 0, 0);
    this.requestRender();
  }

  // ---- blades --------------------------------------------------------------
  /** rows: {stations:[[r,chord,betaDeg]], nblades, naca:"4412", mirror:bool, xDisk, pitchDelta} ; key "rotor"|"stator" */
  setBlades(key, rows) {
    const group = key === "rotor" ? this.rotorGroup : this.staticGroup;
    if (!rows || !rows.stations || rows.stations.length < 2) { this._replace(key, null, group); this._replace(key + "Lines", null, group); return; }
    const s = this.scale, color = this.colors[key];
    const prof = sectionLoop(rows.naca || "0010", 40, !!rows.mirror);
    const st = resampleStations(rows.stations, 26).map(([r, c, b]) => [r * s, c * s, (b + (rows.pitchDelta || 0)) * Math.PI / 180]);
    const xDisk = rows.xDisk * s, nb = Math.max(1, rows.nblades | 0);
    const place = (r, c, beta, phi0, [xi, eta]) => {
      // chord direction (theta, x) and suction-side normal, see DESBLADE conventions
      const ch = [-Math.cos(beta), Math.sin(beta)], nh = [-Math.sin(beta), -Math.cos(beta)];
      const sTan = c * ((xi - 0.25) * ch[0] + eta * nh[0]);
      const x = xDisk + c * ((xi - 0.25) * ch[1] + eta * nh[1]);
      const phi = phi0 + sTan / r;                      // wrap the section onto the cylinder r
      return [r * Math.cos(phi), x, r * Math.sin(phi)];
    };
    const nS = st.length, nP = prof.length;
    const pos = [], idx = [];
    for (let b = 0; b < nb; b++) {
      const phi0 = b * 2 * Math.PI / nb, base = pos.length / 3;
      for (let i = 0; i < nS; i++) for (let j = 0; j < nP; j++) pos.push(...place(st[i][0], st[i][1], st[i][2], phi0, prof[j]));
      for (let i = 0; i < nS - 1; i++) for (let j = 0; j < nP; j++) {
        const a = base + i * nP + j, b2 = base + i * nP + (j + 1) % nP, c2 = a + nP, d = b2 + nP;
        idx.push(a, c2, b2, b2, c2, d);
      }
      // root and tip caps: fan from the section centroid
      for (const [i, flip] of [[0, true], [nS - 1, false]]) {
        const ci = pos.length / 3, cx = [0, 0, 0];
        for (let j = 0; j < nP; j++) for (let k = 0; k < 3; k++) cx[k] += pos[(base + i * nP + j) * 3 + k] / nP;
        pos.push(...cx);
        for (let j = 0; j < nP; j++) { const a = base + i * nP + j, b2 = base + i * nP + (j + 1) % nP; idx.push(ci, flip ? b2 : a, flip ? a : b2); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15, side: THREE.DoubleSide }));
    this._replace(key, mesh, group);

    // the "sweep": section outline at each of DFDC's radial stations
    const lp = [];
    for (let b = 0; b < nb; b++) {
      const phi0 = b * 2 * Math.PI / nb;
      for (const [r, c, bd] of rows.stations) {
        const beta = (bd + (rows.pitchDelta || 0)) * Math.PI / 180;
        const loop = prof.map(p => place(r * s, c * s, beta, phi0, p));
        for (let j = 0; j < loop.length; j++) lp.push(...loop[j], ...loop[(j + 1) % loop.length]);
      }
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: color.clone().lerp(this.colors.ink, 0.35) }));
    lines.visible = this.options.outlines;
    this._replace(key + "Lines", lines, group);
    this.requestRender();
  }
}

/** Closed NACA 4-digit outline, LE -> upper -> TE -> lower -> (back to LE), unit chord. */
function sectionLoop(code, n, mirror) {
  const m = parseInt(code[0]) / 100, p = parseInt(code[1]) / 10, t = Math.max(0.02, parseInt(code.slice(2)) / 100);
  const up = [], lo = [];
  for (let i = 0; i < n; i++) {
    const x = 0.5 * (1 - Math.cos(Math.PI * i / (n - 1)));
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    let yc = 0, dyc = 0;
    if (m > 0 && p > 0) {
      if (x < p) { yc = m / p / p * (2 * p * x - x * x); dyc = 2 * m / p / p * (p - x); }
      else { yc = m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x * x); dyc = 2 * m / (1 - p) ** 2 * (p - x); }
    }
    const th = Math.atan(dyc), sg = mirror ? -1 : 1;
    up.push([x - yt * Math.sin(th), sg * (yc + yt * Math.cos(th))]);
    lo.push([x + yt * Math.sin(th), sg * (yc - yt * Math.cos(th))]);
  }
  lo.reverse();
  return up.concat(lo.slice(1, -1));          // drop duplicated TE and LE points
}

/** Catmull-Rom resample of [r, chord, beta] stations to n points in r. */
function resampleStations(stations, n) {
  const st = stations.slice().sort((a, b) => a[0] - b[0]);
  if (st.length < 3) return st;
  const out = [], r0 = st[0][0], r1 = st[st.length - 1][0];
  const cr = (p0, p1, p2, p3, t) => 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  for (let k = 0; k < n; k++) {
    const r = r0 + (r1 - r0) * k / (n - 1);
    let i = 0; while (i < st.length - 2 && st[i + 1][0] < r) i++;
    const t = (r - st[i][0]) / (st[i + 1][0] - st[i][0]);
    const P = j => st[Math.min(st.length - 1, Math.max(0, j))];
    out.push([r, cr(P(i - 1)[1], P(i)[1], P(i + 1)[1], P(i + 2)[1], t), cr(P(i - 1)[2], P(i)[2], P(i + 1)[2], P(i + 2)[2], t)]);
  }
  return out;
}
