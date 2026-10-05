"""Blade-section presets for DFDC's parametric aero model.

DFDC (like XROTOR) does not take airfoil coordinates for the blade.  Each
section is a parametric lift/drag model:

    CL  = dCLdA * (alpha - A0) * Prandtl-Glauert, soft-limited at CLmax/CLmin
    CD  = (CDmin + dCDdCL2 * (CL - CLCDmin)^2) * (Re/REref)^REexp  + stall + compressibility
    CM  = Cmconst

The numbers below are representative fits to published polars at the stated
reference Reynolds number.  They are good enough to compare airfoil families
inside a design study; they are not a substitute for a measured polar.  Every
value can be overridden in the UI.

Note on REexp: the source (aero.f, CLCDCM) applies (Re/REref)**REexp to CD,
so the exponent must be NEGATIVE for drag to fall with Reynolds number.  The
sample cases shipped with DFDC 0.70 use +0.35, which does the opposite.

The ``naca`` field is only used to draw a section outline in the preview.
"""

# Keys match the order DFDC reads them in the AERO block.
AERO_KEYS = [
    "a0deg", "dclda", "clmax", "clmin",
    "dclda_stall", "dcl_stall", "cmconst", "mcrit",
    "cdmin", "clcdmin", "dcdcl2",
    "reref", "reexp",
]

PRESETS = [
    {
        "id": "dfdc-default",
        "name": "DFDC default (symmetric)",
        "family": "Generic",
        "naca": "0010",
        "note": "The section model shipped with the DFDC samples, with a physical Re exponent.",
        "aero": dict(a0deg=0.0, dclda=6.28, clmax=1.5, clmin=-1.0,
                     dclda_stall=0.5, dcl_stall=0.2, cmconst=0.0, mcrit=0.70,
                     cdmin=0.012, clcdmin=0.10, dcdcl2=0.005,
                     reref=2.0e5, reexp=-0.40),
    },
    {
        "id": "naca0012",
        "name": "NACA 0012",
        "family": "NACA 4-digit",
        "naca": "0012",
        "note": "Symmetric 12% section. Benign stall, no camber - low CL/CD at design CL.",
        "aero": dict(a0deg=0.0, dclda=6.10, clmax=1.25, clmin=-1.25,
                     dclda_stall=0.5, dcl_stall=0.15, cmconst=0.0, mcrit=0.74,
                     cdmin=0.0080, clcdmin=0.0, dcdcl2=0.0070,
                     reref=5.0e5, reexp=-0.45),
    },
    {
        "id": "naca2412",
        "name": "NACA 2412",
        "family": "NACA 4-digit",
        "naca": "2412",
        "note": "Mild camber, 12% thick. Good general-purpose rotor section.",
        "aero": dict(a0deg=-2.1, dclda=6.10, clmax=1.45, clmin=-0.95,
                     dclda_stall=0.5, dcl_stall=0.15, cmconst=-0.045, mcrit=0.70,
                     cdmin=0.0078, clcdmin=0.25, dcdcl2=0.0075,
                     reref=5.0e5, reexp=-0.45),
    },
    {
        "id": "naca4412",
        "name": "NACA 4412",
        "family": "NACA 4-digit",
        "naca": "4412",
        "note": "Classic high-lift prop section. Strong camber, high CLmax, pitching moment.",
        "aero": dict(a0deg=-4.0, dclda=6.00, clmax=1.55, clmin=-0.75,
                     dclda_stall=0.5, dcl_stall=0.18, cmconst=-0.095, mcrit=0.66,
                     cdmin=0.0085, clcdmin=0.40, dcdcl2=0.0080,
                     reref=5.0e5, reexp=-0.45),
    },
    {
        "id": "clarky",
        "name": "Clark Y",
        "family": "Flat-bottom",
        "naca": "3512",
        "note": "Flat-bottomed 11.7% section used on countless propellers. Forgiving, easy to build.",
        "aero": dict(a0deg=-3.6, dclda=6.00, clmax=1.45, clmin=-0.65,
                     dclda_stall=0.5, dcl_stall=0.18, cmconst=-0.075, mcrit=0.66,
                     cdmin=0.0095, clcdmin=0.40, dcdcl2=0.0080,
                     reref=4.0e5, reexp=-0.45),
    },
    {
        "id": "naca65-410",
        "name": "NACA 65-410",
        "family": "NACA 6-series",
        "naca": "2410",
        "note": "Laminar-flow compressor/fan section. Low drag bucket around CL 0.4, higher Mcrit.",
        "aero": dict(a0deg=-2.6, dclda=6.20, clmax=1.20, clmin=-0.60,
                     dclda_stall=0.5, dcl_stall=0.12, cmconst=-0.070, mcrit=0.74,
                     cdmin=0.0062, clcdmin=0.40, dcdcl2=0.0100,
                     reref=6.0e5, reexp=-0.45),
    },
    {
        "id": "e63",
        "name": "Eppler E63",
        "family": "Low-Re",
        "naca": "5304",
        "note": "Thin, highly cambered low-Reynolds section. For small, slow fans (Re < 150k).",
        "aero": dict(a0deg=-5.5, dclda=5.80, clmax=1.35, clmin=-0.30,
                     dclda_stall=0.4, dcl_stall=0.20, cmconst=-0.120, mcrit=0.60,
                     cdmin=0.0140, clcdmin=0.60, dcdcl2=0.0120,
                     reref=1.0e5, reexp=-0.50),
    },
    {
        "id": "s1223",
        "name": "Selig S1223",
        "family": "High-lift",
        "naca": "8512",
        "note": "Very high-lift low-Re section. CLmax ~2 but large drag and pitching moment.",
        "aero": dict(a0deg=-8.5, dclda=5.90, clmax=2.00, clmin=-0.20,
                     dclda_stall=0.4, dcl_stall=0.25, cmconst=-0.250, mcrit=0.52,
                     cdmin=0.0190, clcdmin=1.00, dcdcl2=0.0150,
                     reref=2.0e5, reexp=-0.50),
    },
    {
        "id": "mh114",
        "name": "MH 114",
        "family": "Propeller",
        "naca": "5413",
        "note": "Martin Hepperle propeller section for the inner/mid blade. High CL, moderate drag.",
        "aero": dict(a0deg=-5.0, dclda=6.00, clmax=1.60, clmin=-0.50,
                     dclda_stall=0.5, dcl_stall=0.18, cmconst=-0.110, mcrit=0.64,
                     cdmin=0.0100, clcdmin=0.55, dcdcl2=0.0090,
                     reref=3.0e5, reexp=-0.45),
    },
    {
        "id": "flatplate",
        "name": "Flat plate (thin)",
        "family": "Generic",
        "naca": "0003",
        "note": "Sheet-metal or 3D-printed thin plate. Early stall, high drag - a lower bound.",
        "aero": dict(a0deg=0.0, dclda=5.50, clmax=0.80, clmin=-0.80,
                     dclda_stall=0.3, dcl_stall=0.15, cmconst=0.0, mcrit=0.70,
                     cdmin=0.0200, clcdmin=0.0, dcdcl2=0.0200,
                     reref=2.0e5, reexp=-0.30),
    },
]

BY_ID = {p["id"]: p for p in PRESETS}


def resolve(spec):
    """spec = {"preset": id, "overrides": {...}} -> full aero dict."""
    preset = BY_ID.get(spec.get("preset", "dfdc-default"), PRESETS[0])
    aero = dict(preset["aero"])
    for k, v in (spec.get("overrides") or {}).items():
        if k in aero:
            aero[k] = float(v)
    return aero


def stator_aero(aero):
    """Aero data for a disk with negative circulation (a stator).

    DFDC does not mirror the polar for negative BGAM.  Worse, DESBLADE
    (rotoper.f) designs the row by inverting the polar at the POSITIVE design
    CL and mirroring the angle, while the analysis evaluates the same polar at
    alpha = beta - phi, i.e. at NEGATIVE CL.  Any non-zero A0 therefore makes
    design and analysis disagree by 2*dCLdA*A0 (verified on sample3: A0=+3deg
    gave CL -0.87, A0=-3deg gave -0.56 for a 0.7 design).

    The consistent encoding is A0 = 0 with limits symmetric at the section's
    own CLmax: +CLmax caps the design inversion, -CLmax caps the analysis.
    The drag bucket and Cm are mirrored.  Consequence: stator blade angles
    DFDC reports are measured from the section's zero-lift line, not its
    chord line.
    """
    f = dict(aero)
    f["a0deg"] = 0.0
    f["clmax"] = abs(aero["clmax"])
    f["clmin"] = -abs(aero["clmax"])
    f["clcdmin"] = -aero["clcdmin"]
    f["cmconst"] = -aero["cmconst"]
    return f
