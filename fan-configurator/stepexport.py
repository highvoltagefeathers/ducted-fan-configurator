"""STEP export of one part (blade, stator vane or duct) with OpenCascade.

Uses the OCP bindings directly (package `cadquery-ocp`, ~150 MB) rather than
CadQuery itself, whose dependency tree (VTK, CasADi, Numba, SciPy, trame...)
is over 1 GB and none of it is needed for a loft and a STEP writer.

Geometry conventions match the 3-D viewer exactly (viewer3d.js):
  * DFDC frame: x axial downstream, r radial; blade angle beta from the plane
    of rotation; the quarter-chord line sits on the disk plane.
  * Each station's section outline (closed-TE NACA sketch of the chosen
    family, unit chord) is scaled by the chord, pitched by beta and wrapped
    onto the cylinder of its radius.
  * One origin for every part: centerbody nose tip on the axis.  STEP axes:
    X axial (downstream +), blades at (x, -r cos phi, r sin phi), the same
    handedness as the on-screen model.  Units: millimetres.

Blades are lofted through B-spline section wires (not ruled), so the surface
is a smooth skin through every DFDC station, extended 2 mm into the hub and
extrapolated to the tip radius, and closed with filled root and tip caps
(OpenCascade only caps a loft by itself when the end sections are planar).
"""
import math

ROOT_EXT_MM = 2.0      # how far the loft is buried into the hub / duct wall


def _static(cls, name):
    """OCCT static methods are bound as `Name_s` in the 7.x OCP wheels and as plain
    `Name` in the 8.x ones; resolve whichever exists."""
    fn = getattr(cls, name + "_s", None)
    return fn if fn is not None else getattr(cls, name)


# ----------------------------------------------------------------------------
# section outline and placement
# ----------------------------------------------------------------------------

def naca_outline(code, n=70, mirror=False):
    """Closed-TE NACA 4-digit outline, TE -> upper -> LE -> lower -> TE, unit chord."""
    m = int(code[0]) / 100.0
    p = int(code[1]) / 10.0
    t = max(0.02, int(code[2:]) / 100.0)
    up, lo = [], []
    for i in range(n):
        x = 0.5 * (1 - math.cos(math.pi * i / (n - 1)))
        yt = 5 * t * (0.2969 * math.sqrt(x) - 0.1260 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4)
        if m > 0 and 0 < p < 1:
            if x < p:
                yc, dyc = m / p ** 2 * (2 * p * x - x * x), 2 * m / p ** 2 * (p - x)
            else:
                yc, dyc = m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x * x), 2 * m / (1 - p) ** 2 * (p - x)
        else:
            yc, dyc = 0.0, 0.0
        th = math.atan(dyc)
        sg = -1.0 if mirror else 1.0
        up.append((x - yt * math.sin(th), sg * (yc + yt * math.cos(th))))
        lo.append((x + yt * math.sin(th), sg * (yc - yt * math.cos(th))))
    up.reverse()                              # TE -> LE
    pts = up + lo[1:]                         # ... -> TE (LE shared)
    pts[0] = (1.0, 0.0)
    pts[-1] = (1.0, 0.0)
    return pts


def _place(r, c, beta, phi0, xi, eta, x_disk):
    """Section point -> (x, y, z) in mm, wrapped on the cylinder of radius r."""
    ch = (-math.cos(beta), math.sin(beta))      # chord direction (theta, x)
    nh = (-math.sin(beta), -math.cos(beta))     # suction-side normal
    s_tan = c * ((xi - 0.25) * ch[0] + eta * nh[0])
    x = x_disk + c * ((xi - 0.25) * ch[1] + eta * nh[1])
    phi = phi0 + s_tan / r
    return (x, -r * math.cos(phi), r * math.sin(phi))


def _extrapolate(stations, r_new, i0, i1):
    (r0, c0, b0), (r1, c1, b1) = stations[i0], stations[i1]
    f = (r_new - r0) / (r1 - r0) if r1 != r0 else 0.0
    return [r_new, c0 + (c1 - c0) * f, b0 + (b1 - b0) * f]


# ----------------------------------------------------------------------------
# OpenCascade helpers
# ----------------------------------------------------------------------------

def _point_harray(n):
    """Handle-array of gp_Pnt: OCCT <= 7.9 names it TColgp_HArray1OfPnt, OCCT 8 uses
    the templated OCP.collections.HArray1_gp_Pnt."""
    try:
        from OCP.TColgp import TColgp_HArray1OfPnt
        return TColgp_HArray1OfPnt(1, n)
    except ImportError:
        from OCP.collections import HArray1_gp_Pnt
        return HArray1_gp_Pnt(1, n)


def _spline_edge(pts, t0=None, t1=None):
    """B-spline edge through 3-D points, optional end tangents (unit vectors)."""
    from OCP.gp import gp_Pnt, gp_Vec
    from OCP.GeomAPI import GeomAPI_Interpolate
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge
    arr = _point_harray(len(pts))
    for i, p in enumerate(pts, 1):
        arr.SetValue(i, gp_Pnt(*p))
    interp = GeomAPI_Interpolate(arr, False, 1e-6)
    if t0 is not None and t1 is not None:
        interp.Load(gp_Vec(*t0), gp_Vec(*t1), True)
    interp.Perform()
    return BRepBuilderAPI_MakeEdge(interp.Curve()).Edge()


def _unit(a, b):
    v = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    n = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2) or 1.0
    return (v[0] / n, v[1] / n, v[2] / n)


def _section_wire(pts, i_le):
    """Two splines (upper TE->LE, lower LE->TE) sharing the LE point and tangent:
    smooth nose, sharp trailing edge, two edges per section for the cap filler."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeWire
    t_le = _unit(pts[i_le - 1], pts[i_le + 1])
    upper = _spline_edge(pts[:i_le + 1], _unit(pts[0], pts[1]), t_le)
    lower = _spline_edge(pts[i_le:], t_le, _unit(pts[-2], pts[-1]))
    mw = BRepBuilderAPI_MakeWire(upper, lower)
    return mw.Wire()


def _edges(shape):
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopoDS import TopoDS
    out, ex = [], TopExp_Explorer(shape, TopAbs_EDGE)
    while ex.More():
        out.append(_static(TopoDS, "Edge")(ex.Current()))
        ex.Next()
    return out


def _faces(shape):
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopoDS import TopoDS
    out, ex = [], TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        out.append(_static(TopoDS, "Face")(ex.Current()))
        ex.Next()
    return out


def _volume(shape):
    from OCP.GProp import GProp_GProps
    from OCP.BRepGProp import BRepGProp
    props = GProp_GProps()
    _static(BRepGProp, "VolumeProperties")(shape, props)
    return props.Mass()


def is_valid(shape):
    from OCP.BRepCheck import BRepCheck_Analyzer
    return BRepCheck_Analyzer(shape).IsValid()


def _capped_loft(wires):
    """Smooth skin through non-planar section wires, closed with filled caps -> solid."""
    from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections
    from OCP.BRepFill import BRepFill_Filling
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Sewing, BRepBuilderAPI_MakeSolid
    from OCP.GeomAbs import GeomAbs_C0
    from OCP.TopoDS import TopoDS
    from OCP.TopAbs import TopAbs_SHELL
    from OCP.TopExp import TopExp_Explorer
    from OCP.ShapeFix import ShapeFix_Solid

    builder = BRepOffsetAPI_ThruSections(False, False)      # shell, not ruled
    builder.CheckCompatibility(False)
    for w in wires:
        builder.AddWire(w)
    builder.Build()
    faces = _faces(builder.Shape())
    for w in (wires[0], wires[-1]):                          # root and tip caps
        fill = BRepFill_Filling()
        for e in _edges(w):
            fill.Add(e, GeomAbs_C0, True)
        fill.Build()
        faces.append(fill.Face())
    sew = BRepBuilderAPI_Sewing(1e-3)
    for f in faces:
        sew.Add(f)
    sew.Perform()
    sewed = sew.SewedShape()
    if sewed.ShapeType() != TopAbs_SHELL:
        ex = TopExp_Explorer(sewed, TopAbs_SHELL)
        sewed = ex.Current()
    shell = _static(TopoDS, "Shell")(sewed)
    solid = BRepBuilderAPI_MakeSolid(shell).Solid()
    fix = ShapeFix_Solid(solid)
    fix.Perform()
    to_solid = _static(TopoDS, "Solid")
    solid = to_solid(fix.Solid())
    if _volume(solid) < 0:
        solid = to_solid(solid.Reversed())
    return solid


def blade_solid(stations_mm, naca, mirror, x_disk_mm, r_root_mm, r_tip_mm, phi0=0.0):
    """One blade: smooth loft through every station.  stations: [[r, chord, beta_deg]] in mm."""
    st = sorted([list(s) for s in stations_mm], key=lambda s: s[0])
    if r_root_mm < st[0][0]:
        st.insert(0, _extrapolate(st, r_root_mm, 0, 1))
    if r_tip_mm > st[-1][0]:
        st.append(_extrapolate(st, r_tip_mm, -2, -1))
    outline = naca_outline(naca, mirror=mirror)
    i_le = min(range(len(outline)), key=lambda i: outline[i][0])
    wires = []
    for r, c, bdeg in st:
        beta = math.radians(bdeg)
        pts = [_place(r, c, beta, phi0, xi, eta, x_disk_mm) for xi, eta in outline]
        wires.append(_section_wire(pts, i_le))
    return _capped_loft(wires)


def duct_solid(geom):
    """Duct ring: section spline (outer TE -> LE -> inner TE) closed across the TE, revolved about X."""
    from OCP.gp import gp_Pnt, gp_Ax1, gp_Dir
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire, BRepBuilderAPI_MakeFace
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeRevol
    pts = [(x * 1000.0, r * 1000.0, 0.0) for x, r in geom["duct"]]
    spline = _spline_edge(pts)
    closer = BRepBuilderAPI_MakeEdge(gp_Pnt(*pts[-1]), gp_Pnt(*pts[0])).Edge()
    wire = BRepBuilderAPI_MakeWire(spline, closer).Wire()
    face = BRepBuilderAPI_MakeFace(wire, True).Face()
    axis = gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0))
    return BRepPrimAPI_MakeRevol(face, axis, 2 * math.pi).Shape()


# ----------------------------------------------------------------------------
# public API
# ----------------------------------------------------------------------------

def build(req):
    """One solid.  req: {what: blade|stator|duct, geom, rotor:{stations,naca,xDisk}, stator:{...}}"""
    geom = req["geom"]
    what = req.get("what", "blade")
    mm = lambda v: v * 1000.0
    if what == "duct":
        return duct_solid(geom)
    if what == "stator":
        st = req.get("stator")
        if not st or geom.get("stator_hub") is None:
            raise ValueError("No stator in this design.")
        tip_gap = mm(geom["R_duct_at_rotor"] - geom["R_tip"])
        return blade_solid([[mm(r), mm(c), b] for r, c, b in st["stations"]], st.get("naca", "0010"), True,
                           mm(st["xDisk"]), mm(geom["stator_hub"]) - ROOT_EXT_MM,
                           mm(geom["stator_tip"]) + tip_gap + ROOT_EXT_MM)
    rot = req["rotor"]
    return blade_solid([[mm(r), mm(c), b] for r, c, b in rot["stations"]], rot.get("naca", "0010"), False,
                       mm(rot["xDisk"]), mm(geom["R_hub"]) - ROOT_EXT_MM, mm(geom["R_tip"]))


def write_step(shape, path):
    from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
    from OCP.Interface import Interface_Static
    from OCP.IFSelect import IFSelect_RetDone
    set_cval = _static(Interface_Static, "SetCVal")
    set_cval("write.step.unit", "MM")
    set_cval("write.step.schema", "AP214")
    writer = STEPControl_Writer()
    writer.Transfer(shape, STEPControl_AsIs)
    if writer.Write(path) != IFSelect_RetDone:
        raise RuntimeError("STEP writer failed")
    return path


def export_step(req, path):
    return write_step(build(req), path)
