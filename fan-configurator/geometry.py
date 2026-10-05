"""Parametric duct + centerbody geometry for DFDC.

All lengths in metres, the DFDC convention: x axial (downstream +), r radial.
The centerbody nose is at the origin.

Layout, from the user's parameters:

    centerbody: elliptical nose (nose_len * R_hub) -> cylinder (cyl_len * R_hub)
                -> cubic tail to a base of radius tail_base * R_hub
    rotor:      on the cylinder at fraction rotor_hub_pos along it
    duct:       NACA 4-digit section of chord duct_chord * R, placed so the
                rotor sits at fraction rotor_pos of the chord and the inner
                surface clears the blade tip by tip_gap
    stator:     stator_gap * chord downstream of the rotor
"""
import math

NOSE_PTS = 32
CYL_PTS = 14
TAIL_PTS = 26
DUCT_PTS = 70


def naca4(m, p, t, n=DUCT_PTS, closed_te=False):
    """Upper and lower surfaces of a NACA 4-digit section, LE->TE, unit chord."""
    k4 = -0.1036 if closed_te else -0.1015
    xs = [0.5 * (1 - math.cos(math.pi * i / (n - 1))) for i in range(n)]
    up, lo = [], []
    for x in xs:
        yt = 5 * t * (0.2969 * math.sqrt(x) - 0.1260 * x - 0.3516 * x ** 2
                      + 0.2843 * x ** 3 + k4 * x ** 4)
        if m > 0 and 0 < p < 1:
            if x < p:
                yc = m / p ** 2 * (2 * p * x - x * x)
                dyc = 2 * m / p ** 2 * (p - x)
            else:
                yc = m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x * x)
                dyc = 2 * m / (1 - p) ** 2 * (p - x)
        else:
            yc, dyc = 0.0, 0.0
        th = math.atan(dyc)
        up.append((x - yt * math.sin(th), yc + yt * math.cos(th)))
        lo.append((x + yt * math.sin(th), yc - yt * math.cos(th)))
    return up, lo


def _interp_r(points, x):
    """Linear interpolation of r at x on a polyline of (x, r), any x order."""
    best = None
    for (x0, r0), (x1, r1) in zip(points, points[1:]):
        lo, hi = min(x0, x1), max(x0, x1)
        if lo <= x <= hi and x1 != x0:
            r = r0 + (r1 - r0) * (x - x0) / (x1 - x0)
            best = r if best is None else max(best, r)
    return best


def centerbody(g):
    """Return centerbody points ordered TE -> nose, plus key stations."""
    R = g["fan_radius"]
    Rh = g["hub_ratio"] * R
    Ln = g["nose_len"] * Rh
    Lc = g["cyl_len"] * Rh
    Lt = g["tail_len"] * Rh
    Rb = max(0.02, g["tail_base"]) * Rh

    pts = []
    for i in range(NOSE_PTS):
        s = 0.5 * (1 - math.cos(math.pi * i / (NOSE_PTS - 1)))
        pts.append((Ln * s, Rh * math.sqrt(max(0.0, 1 - (1 - s) ** 2))))
    for i in range(1, CYL_PTS + 1):
        pts.append((Ln + Lc * i / (CYL_PTS + 1), Rh))
    for i in range(TAIL_PTS):
        s = (i + 1) / TAIL_PTS
        pts.append((Ln + Lc + Lt * s, Rh - (Rh - Rb) * (3 * s * s - 2 * s ** 3)))
    pts.reverse()
    return pts, dict(R_hub=Rh, x_cyl0=Ln, x_cyl1=Ln + Lc, x_te=Ln + Lc + Lt)


def duct(g, x_rotor):
    """Return duct points ordered outer TE -> LE -> inner TE, plus stations."""
    R = g["fan_radius"]
    c = g["duct_chord"] * R
    tip_gap = g["tip_gap_mm"] / 1000.0
    up, lo = naca4(g["duct_camber"] / 100.0, g["duct_camber_pos"],
                   g["duct_thickness"] / 100.0)
    th = math.radians(g["duct_stagger"])
    # chord direction and the "up" normal of the section, which points at the axis
    d = (math.cos(th), math.sin(th))
    nrm = (math.sin(th), -math.cos(th))
    x_le = x_rotor - g["rotor_pos"] * c * d[0]

    def place(u, v):
        return (x_le + c * (u * d[0] + v * nrm[0]), c * (u * d[1] + v * nrm[1]))

    inner = [place(u, v) for (u, v) in up]   # suction side faces the axis
    outer = [place(u, v) for (u, v) in lo]
    r_in = _interp_r(inner, x_rotor)
    if r_in is None:
        r_in = inner[0][1]
    r_le = R + tip_gap - r_in
    inner = [(x, r + r_le) for x, r in inner]
    outer = [(x, r + r_le) for x, r in outer]
    pts = list(reversed(outer)) + inner[1:]
    return pts, inner, dict(chord=c, x_le=x_le, x_te=inner[-1][0], R_tip=R)


def normalize(g):
    """Accept the UI's millimetre parameters (or the older ratio form) and return
    the internal metre/ratio dict that centerbody() and duct() work with."""
    if "fan_dia_mm" not in g:
        return dict(g)
    R = g["fan_dia_mm"] / 2000.0
    Rh = max(1e-4, g["hub_dia_mm"] / 2000.0)
    chord = max(1e-3, g["duct_chord_mm"] / 1000.0)
    n = dict(g)
    n.update(
        fan_radius=R,
        hub_ratio=Rh / R,
        duct_chord=chord / R,
        rotor_pos=g["rotor_pos_mm"] / 1000.0 / chord,
        nose_len=g["nose_len_mm"] / 1000.0 / Rh,
        cyl_len=g["cyl_len_mm"] / 1000.0 / Rh,
        tail_len=g["tail_len_mm"] / 1000.0 / Rh,
        tail_base=g["tail_base_dia_mm"] / 1000.0 / 2.0 / Rh,
        stator_gap=g["stator_gap_mm"] / 1000.0 / chord,
        rotor_x=g["rotor_x_mm"] / 1000.0,
    )
    return n


def build(g):
    """Full geometry for a config dict.  Returns dict with point lists and stations."""
    g = normalize(g)
    cb_pts, cb = centerbody(g)
    if "rotor_x" in g:
        x_rotor = g["rotor_x"]
    else:
        x_rotor = cb["x_cyl0"] + g["rotor_hub_pos"] * (cb["x_cyl1"] - cb["x_cyl0"])
    duct_pts, inner, dk = duct(g, x_rotor)
    x_stator = x_rotor + g["stator_gap"] * dk["chord"]

    warnings = []
    r_hub_rotor = _interp_r(cb_pts, x_rotor)
    if r_hub_rotor is None or r_hub_rotor < 1e-4:
        warnings.append("Rotor plane is not on the centerbody.")
        r_hub_rotor = cb["R_hub"]
    elif x_rotor < cb["x_cyl0"] - 1e-9 or x_rotor > cb["x_cyl1"] + 1e-9:
        warnings.append("Rotor plane is off the cylindrical hub section (hub radius taken from the local profile).")
    if g["hub_ratio"] >= 0.85:
        warnings.append("Hub diameter is nearly the fan diameter.")
    if x_rotor <= dk["x_le"] + 0.02 * dk["chord"] or x_rotor >= dk["x_te"] - 0.02 * dk["chord"]:
        warnings.append("Rotor plane is outside the duct chord.")
    stator_hub = _interp_r(cb_pts, x_stator)
    stator_tip = _interp_r(inner, x_stator)
    if g.get("stator_on"):
        if stator_hub is None or stator_tip is None:
            warnings.append("Stator plane is not inside both the duct and the centerbody.")
        elif x_stator > cb["x_cyl1"]:
            warnings.append("Stator sits on the tapering tail; its hub radius is smaller than the rotor's.")
    if dk["x_te"] > cb["x_te"] + 1e-9:
        warnings.append("Duct trailing edge extends past the centerbody tail.")

    return dict(
        centerbody=cb_pts,
        duct=duct_pts,
        x_rotor=x_rotor,
        x_stator=x_stator,
        R_tip=dk["R_tip"],
        R_hub=r_hub_rotor,
        R_duct_at_rotor=dk["R_tip"] + g["tip_gap_mm"] / 1000.0,
        stator_hub=stator_hub,
        stator_tip=(stator_tip - g["tip_gap_mm"] / 1000.0) if stator_tip else None,
        duct_chord=dk["chord"],
        duct_x_le=dk["x_le"],
        duct_x_te=dk["x_te"],
        cb_x_te=cb["x_te"],
        warnings=warnings,
    )


def isa(alt_km):
    """International Standard Atmosphere: rho, speed of sound, viscosity, temperature."""
    h = alt_km * 1000.0
    T0, p0, L, g0, Rgas = 288.15, 101325.0, 0.0065, 9.80665, 287.05287
    if h < 11000:
        T = T0 - L * h
        p = p0 * (T / T0) ** (g0 / (Rgas * L))
    else:
        T = 216.65
        p11 = p0 * (T / T0) ** (g0 / (Rgas * L))
        p = p11 * math.exp(-g0 * (h - 11000) / (Rgas * T))
    rho = p / (Rgas * T)
    a = math.sqrt(1.4 * Rgas * T)
    mu = 1.458e-6 * T ** 1.5 / (T + 110.4)
    return dict(rho=rho, vso=a, rmu=mu, temp=T, pressure=p)
