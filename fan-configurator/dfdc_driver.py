"""Drive the unmodified DFDC 0.70 executable from Python.

The solver is never re-implemented here.  Each run writes a .case file, feeds
dfdc.exe a scripted keyboard session on stdin (graphics off), and parses the
text it prints plus the files it writes (CPWR pressure dump, SAVE case file).

Two session types:

  design   rotor given as an actuator disk.  THRU drives the disk loading
           (B*Gamma) to the target thrust, DESI then designs blade chord and
           twist for the chosen CL and section, EXEC re-converges with the
           real blades.  With a stator the loading is found first in a
           rotor-only pass, then a second pass adds a stator disk carrying
           the opposite circulation and designs both rows.

  analyze  rotor (and stator) given as blade geometry from a previous design.
           EXEC converges the case; THRU instead trims blade pitch to a thrust.
"""
import os
import re
import subprocess
import time
import uuid

import airfoils
import blmarch
import geometry

HERE = os.path.dirname(os.path.abspath(__file__))
DFDC_EXE = os.path.normpath(os.path.join(HERE, "..", "DFDC070", "bin", "dfdc.exe"))
RUN_ROOT = os.path.join(HERE, "runs")

NUM = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[EeDd][-+]?\d+)?"


class DFDCError(Exception):
    pass


# ----------------------------------------------------------------------------
# case file
# ----------------------------------------------------------------------------

def _aero_block(aero):
    a = aero
    return (
        "AERO\n"
        "!  #sections\n     1\n"
        "!  Xisection\n   0.0000\n"
        "!  A0deg        dCLdA        CLmax         CLmin\n"
        f"  {a['a0deg']:.4f}  {a['dclda']:.4f}  {a['clmax']:.4f}  {a['clmin']:.4f}\n"
        "!  dCLdAstall   dCLstall      Cmconst         Mcrit\n"
        f"  {a['dclda_stall']:.4f}  {a['dcl_stall']:.4f}  {a['cmconst']:.4f}  {a['mcrit']:.4f}\n"
        "!  CDmin        CLCDmin        dCDdCL^2\n"
        f"  {a['cdmin']:.5f}  {a['clcdmin']:.4f}  {a['dcdcl2']:.5f}\n"
        "!  REref        REexp\n"
        f"  {a['reref']:.5E}  {a['reexp']:.4f}\n"
        "ENDAERO\n\n"
    )


def _actdisk_block(xdisk, nrp, stations):
    s = f"ACTDISK\n!  Xdisk       NRPdef\n  {xdisk:.5f}  {nrp}\n!  #stations\n  {len(stations)}\n!  r  BGam\n"
    for r, bg in stations:
        s += f"  {r:.6f}  {bg:.5f}\n"
    return s + "ENDACTDISK\n\n"


def _rotor_block(xdisk, nblades, nrp, stations):
    s = (f"ROTOR\n!   Xdisk        Nblds       NRPdef\n  {xdisk:.5f}  {nblades}  {nrp}\n"
         f"!  #stations\n  {len(stations)}\n!     r        Chord         Beta\n")
    for r, ch, beta in stations:
        s += f"  {r:.6f}  {ch:.6f}  {beta:.4f}\n"
    return s + "ENDROTOR\n\n"


def _stations(r0, r1, n):
    return [r0 + (r1 - r0) * i / (n - 1) for i in range(n)]


def write_case(cfg, geom, disks, title="Fan configurator case"):
    """disks: list of dicts {kind: 'actdisk'|'rotor', x, aero, stations, nblades, rpm}."""
    op = cfg["oper"]
    atm = geometry.isa(op["alt_km"])
    vinf = op["vinf"]
    vref = vinf if vinf >= 5.0 else 50.0
    rpms = "  ".join(f"{d['rpm']:.2f}" for d in disks)
    s = (f"DFDC Version  0.70\n{title}\n\n"
         "OPER\n!  Vinf  Vref  RPM...\n"
         f"  {vinf:.4f}  {vref:.4f}  {rpms}\n"
         "!  Rho  Vso  Rmu  Alt\n"
         f"  {atm['rho']:.5f}  {atm['vso']:.3f}  {atm['rmu']:.5E}  {op['alt_km']:.3f}\n"
         "!  XDwake  Nwake\n"
         f"  {op['wake_len']:.3f}  {int(op['wake_pts'])}\n"
         "!  Lwkrlx\n  F\nENDOPER\n\n")
    for d in disks:
        s += _aero_block(d["aero"])
        if d["kind"] == "actdisk":
            s += _actdisk_block(d["x"], d["nrp"], d["stations"])
        else:
            s += _rotor_block(d["x"], d["nblades"], d["nrp"], d["stations"])
    s += f"GEOM\n{title}\n"
    for x, r in geom["centerbody"]:
        s += f"  {x:.6f}  {r:.6f}\n"
    s += "  999.0 999.0\n"
    for x, r in geom["duct"]:
        s += f"  {x:.6f}  {r:.6f}\n"
    s += "ENDGEOM\n"
    return s, vref, atm


# ----------------------------------------------------------------------------
# running
# ----------------------------------------------------------------------------

def _run(case_text, commands, workdir, timeout=240):
    if not os.path.isfile(DFDC_EXE):
        raise DFDCError(f"dfdc.exe not found at {DFDC_EXE}")
    os.makedirs(workdir, exist_ok=True)
    case_path = os.path.join(workdir, "case.case")
    with open(case_path, "w", encoding="ascii") as f:
        f.write(case_text)
    script = "\n".join(["plop", "g", "", *commands, "quit", ""]) + "\n"
    with open(os.path.join(workdir, "session.txt"), "w") as f:
        f.write(script)
    t0 = time.time()
    try:
        proc = subprocess.run([DFDC_EXE, "case.case"], input=script, cwd=workdir,
                              capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b"")
        if isinstance(out, bytes):
            out = out.decode("utf-8", "replace")
        raise DFDCError("DFDC did not finish within %d s (not converging?)\n\n%s"
                        % (timeout, out[-4000:]))
    with open(os.path.join(workdir, "stdout.txt"), "w") as f:
        f.write(proc.stdout)
    return proc.stdout, time.time() - t0


# ----------------------------------------------------------------------------
# parsing
# ----------------------------------------------------------------------------

def _f(s):
    return float(s.replace("D", "E").replace("d", "e"))


def _grab(text, label, default=None):
    m = re.search(re.escape(label) + r"\s*:?\s*(" + NUM + ")", text)
    return _f(m.group(1)) if m else default


def parse_summaries(out):
    """Every 'DFDC  Case:' summary block in the output, in order."""
    blocks = re.split(r"\n =+\n DFDC  Case:", out)[1:]
    results = []
    for b in blocks:
        b = b.split("\n.OPER")[0]
        tot_txt = b.split("Disk #")[0]
        tot = dict(
            thrust=_grab(tot_txt, "Thrust(N)"), power=_grab(tot_txt, "Power(W)"),
            efficiency=_grab(tot_txt, "Efficiency"), t_visc=_grab(tot_txt, "Tvisc (N)"),
            p_visc=_grab(tot_txt, "Pvisc(W)"), induced_eff=_grab(tot_txt, "Induced Eff"),
            t_duct=_grab(tot_txt, "Tduct(N)"), torque=_grab(tot_txt, "torQue(N-m)"),
            ideal_eff=_grab(tot_txt, "Ideal Eff"), area=_grab(tot_txt, "Area"),
            radius=_grab(tot_txt, "Radius"), omega=_grab(tot_txt, "Omega"),
            ct=_grab(tot_txt, "Ct"), cp=_grab(tot_txt, "Cp"), j=_grab(tot_txt, "J"),
            tc=_grab(tot_txt, "Tc"), pc=_grab(tot_txt, "Pc"),
            ct0=_grab(tot_txt, "CT0"), cp0=_grab(tot_txt, "CP0"), fom=_grab(tot_txt, "FOM"),
            vinf=_grab(tot_txt, "Vinf(m/s)"), rho=_grab(tot_txt, "rho(kg/m3)"),
            vsound=_grab(tot_txt, "Vsound(m/s)"),
        )
        disks = []
        for dtxt in b.split("Disk #")[1:]:
            head = dtxt.split("\n", 1)[0]
            m = re.match(r"\s*(\d+)\s+(.*?)\s*$", head)
            d = dict(index=int(m.group(1)), label=m.group(2).strip())
            d["bladed"] = "Bladed" in d["label"]
            d["nblades"] = int(_grab(dtxt, "# blades", 0) or 0)
            d["rpm"] = _grab(dtxt, "RPM")
            d["thrust"] = _grab(dtxt, "Thrust(N)")
            d["power"] = _grab(dtxt, "Power(W)")
            d["torque"] = _grab(dtxt, "torQue(N-m)")
            d["t_visc"] = _grab(dtxt, "Tvisc (N)")
            d["radius"] = _grab(dtxt, "radius(m)")
            d["r_hub"] = _grab(dtxt, "hub rad.(m)")
            d["va_avg"] = _grab(dtxt, "VAavg (m/s)")
            d["sigma"] = _grab(dtxt, "Sigma")
            d["ct"] = _grab(dtxt, "Ct")
            d["cp"] = _grab(dtxt, "Cp")
            rows = []
            for line in dtxt.splitlines():
                tk = line.split()
                if not tk or not re.fullmatch(r"\d+", tk[0]):
                    continue
                stalled = "s" in tk          # DFDC appends an 's' after CL at stalled stations
                tk = [t for t in tk if t != "s"]
                try:
                    v = [_f(t) for t in tk]
                except ValueError:
                    continue
                if len(v) == 4:
                    rows.append(dict(i=int(v[0]), r_R=v[1], mach=v[2], bgam=v[3]))
                elif len(v) == 9:
                    rows.append(dict(i=int(v[0]), r_R=v[1], c_R=v[2], beta=v[3], cl=v[4],
                                     cd=v[5], re=v[6] * 1e3, mach=v[7], bgam=v[8],
                                     stalled=stalled))
            d["rows"] = rows
            disks.append(d)
        results.append(dict(total=tot, disks=disks))
    return results


def parse_design_tables(out):
    """'Blades for disk N designed with B blades:' tables -> {N: rows}."""
    tables = {}
    for m in re.finditer(r"Blades for disk\s+(\d+)\s+designed with\s+(\d+)\s+blades:\n(.*?)\n\n",
                         out + "\n\n", re.S):
        rows = []
        for line in m.group(3).splitlines()[1:]:
            tk = line.split()
            if len(tk) == 9:
                try:
                    v = [_f(t) for t in tk]
                except ValueError:
                    continue
                rows.append(dict(r_R=v[0], r=v[1], chord=v[2], beta=v[3], cl=v[4],
                                 w=v[5], bgam=v[6], dclda=v[7], alpha=v[8]))
        tables[int(m.group(1))] = dict(nblades=int(m.group(2)), rows=rows)
    return tables


def parse_forces(out):
    """Last FORC listing: total and per-element Fx (inviscid + viscous)."""
    blocks = out.split("Total Forces")
    if len(blocks) < 2:
        return None
    b = blocks[-1].split("\n.OPER")[0]
    res = dict(fx=_grab(b.split("Element")[0], "Fx    ="), fx_vis=_grab(b.split("Element")[0], "Fxvis ="),
               elements=[])
    for e in b.split("Element")[1:]:
        res["elements"].append(dict(index=int(e.split()[0]), fx=_grab(e, "Fx    ="),
                                    fx_inv=_grab(e, "Fxinv ="), fx_vis=_grab(e, "Fxvis =")))
    return res


def parse_cpwr(path):
    """CPWR file: blocks of (x, y, Cp, Q) separated by blank lines, one per element."""
    if not os.path.isfile(path):
        return []
    blocks, cur = [], []
    with open(path) as f:
        for line in f:
            if line.startswith("#"):
                continue
            tk = line.split()
            if len(tk) == 4:
                cur.append([_f(t) for t in tk])
            elif cur:
                blocks.append(cur)
                cur = []
    if cur:
        blocks.append(cur)
    return blocks


def parse_saved_rotors(path):
    """ROTOR / ACTDISK blocks from a SAVEd case: list in file order."""
    if not os.path.isfile(path):
        return []
    with open(path) as f:
        text = f.read()
    disks = []
    for m in re.finditer(r"\n(ROTOR|ACTDISK)\n(.*?)\nEND\1", text, re.S):
        nums = []
        for line in m.group(2).splitlines():
            if line.strip().startswith("!") or not line.strip():
                continue
            nums.append([_f(t) for t in line.split()])
        if m.group(1) == "ROTOR":
            x, nb, nrp = nums[0]
            disks.append(dict(kind="rotor", x=x, nblades=int(nb), nrp=int(nrp),
                              stations=[[r, c, b] for r, c, b in nums[2:]]))
        else:
            x, nrp = nums[0]
            disks.append(dict(kind="actdisk", x=x, nrp=int(nrp),
                              stations=[[r, bg] for r, bg in nums[2:]]))
    return disks


# ----------------------------------------------------------------------------
# sessions
# ----------------------------------------------------------------------------

def _new_workdir():
    os.makedirs(RUN_ROOT, exist_ok=True)
    runs = sorted(d for d in os.listdir(RUN_ROOT) if os.path.isdir(os.path.join(RUN_ROOT, d)))
    for old in runs[:-12]:
        try:
            for fn in os.listdir(os.path.join(RUN_ROOT, old)):
                os.remove(os.path.join(RUN_ROOT, old, fn))
            os.rmdir(os.path.join(RUN_ROOT, old))
        except OSError:
            pass
    rid = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    return rid, os.path.join(RUN_ROOT, rid)


def _bgam_profile(disk):
    """(r/R, BGam) pairs from a parsed disk block."""
    return [(row["r_R"], row["bgam"]) for row in disk["rows"]]


def _interp(xs_ys, x):
    pts = sorted(xs_ys)
    if x <= pts[0][0]:
        return pts[0][1]
    if x >= pts[-1][0]:
        return pts[-1][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return pts[-1][1]


def _tail_commands(cfg):
    cmds = []
    if cfg["oper"].get("viscous"):
        cmds += ["bl", "bl", ""]
    cmds += ["forc", "cpwr cp.out", "", "save result.case"]
    return cmds


def _assemble(cfg, geom, out, workdir, vref, atm, elapsed, passes):
    summaries = parse_summaries(out)
    if not summaries:
        raise DFDCError("DFDC produced no converged solution.\n\n" + out[-6000:])
    final = summaries[-1]
    cp = parse_cpwr(os.path.join(workdir, "cp.out"))
    # CPWR lists: centerbody, duct, then two near-identical blocks per disk
    # (both sides of the disk singularity line, constant x) and finally the
    # trailing vortex wakes shed from the centerbody tail and the duct TE.
    wakes = [b for b in cp[2:] if b and max(p[0] for p in b) - min(p[0] for p in b) > 1e-5]
    wakes.sort(key=lambda b: b[0][1])
    wake_dict = {}
    if wakes:
        wake_dict["centerbody"] = wakes[0]
    if len(wakes) > 1:
        wake_dict["duct"] = wakes[-1]
    rotors = parse_saved_rotors(os.path.join(workdir, "result.case"))
    forces = parse_forces(out)
    warnings = list(geom["warnings"])
    if re.search(r"Mach number limited", out):
        warnings.append("Local Mach limited to 0.99 somewhere on a blade - tip speed too high.")
    if re.search(r"not converged|NOT CONVERGED", out, re.I):
        warnings.append("DFDC reported a non-converged iteration; treat results with care.")
    if "GETALF: alpha(CL) function inversion failed" in out:
        warnings.append("Blade design could not reach the requested CL at some station "
                        "(section CLmax too low for the design CL).")
    if "Driving PITCH" in out:
        db = re.findall(r"dBeta=\s*(" + NUM + ")", out.split("Driving PITCH")[-1])
        if db and abs(_f(db[-1])) > 0.5:
            warnings.append("Pitch trim to the target thrust did not converge (last step %.2f deg); "
                            "the operating point shown is the final iterate. Use a fixed pitch "
                            "offset instead." % _f(db[-1]))
    for d in final["disks"]:
        ns = sum(1 for r in d["rows"] if r.get("stalled"))
        if ns:
            warnings.append(f"{ns} of {len(d['rows'])} stations stalled on disk {d['index']} "
                            f"({d['label']}). Lower the design CL or pick a higher-CLmax section.")
    nconv = len(re.findall(r"dGTHmax", out))
    bl = viscous_check(cp, geom, atm, vref, final["total"].get("thrust"))
    if bl.get("duct_inner", {}).get("separated"):
        d = bl["duct_inner"]
        warnings.append("Duct inner wall boundary layer separates at x = %.0f mm (%.0f %% of the wall "
                        "downstream is stalled). The inviscid solution credits ~%.0f N of thrust that a "
                        "stalled diffuser will not deliver." % (d["x_sep"] * 1000, d["sep_fraction"] * 100,
                                                                -bl["thrust_change"]))
    elif bl.get("centerbody", {}).get("separated"):
        warnings.append("Centerbody tail boundary layer separates at x = %.0f mm."
                        % (bl["centerbody"]["x_sep"] * 1000))
    dz = bl.get("diffuser") or {}
    if dz.get("verdict") in ("transitory stall", "fully stalled"):
        warnings.append("Equivalent cone angle %.1f deg exceeds the conical-diffuser first-stall line "
                        "(~%.0f deg at this length): expect %s." % (dz["cone_angle"], dz["first_stall_angle"], dz["verdict"]))
    return dict(
        bl=bl,
        total=final["total"], disks=final["disks"], summaries=summaries,
        design_tables=parse_design_tables(out), forces=forces,
        cp=dict(centerbody=cp[0] if cp else [], duct=cp[1] if len(cp) > 1 else [], wakes=wake_dict),
        rotors=rotors, vref=vref, atmosphere=atm, geometry=geom,
        warnings=warnings, log=out, elapsed=elapsed, iterations=nconv, passes=passes,
        run_dir=workdir,
    )


def viscous_check(cp_blocks, geom, atm, vref, thrust):
    """Integral BL march on the duct inner wall and the centerbody, using the
    wall velocities DFDC computed (see blmarch.py), plus the diffuser rule."""
    res = dict(thrust_change=0.0, corrected_thrust=thrust)
    if len(cp_blocks) < 2:
        return res
    nu = atm["rmu"] / atm["rho"]
    q = 0.5 * atm["rho"] * vref * vref

    # duct: CPWR order is outer TE -> LE -> inner TE.  The lip stagnation point is
    # the minimum-Q point within the front 35 % of the chord.
    duct = cp_blocks[1]
    x_le, x_te = geom["duct_x_le"], geom["duct_x_te"]
    front = [i for i, p in enumerate(duct) if p[0] < x_le + 0.35 * (x_te - x_le)]
    if front:
        i_stag = min(front, key=lambda i: duct[i][3])
        inner = [(p[0], p[1], p[2], p[3]) for p in duct[i_stag:]]
        m = blmarch.march(inner, nu)
        if m:
            m["thrust_change"] = blmarch.plateau_thrust_change(inner, m["i_sep"], q, fluid_inside=True)
            res["duct_inner"] = m
            res["thrust_change"] += m["thrust_change"]

    # centerbody: CPWR order is TE -> nose; march from the nose
    body = [(p[0], p[1], p[2], p[3]) for p in reversed(cp_blocks[0])]
    m = blmarch.march(body, nu)
    if m:
        m["thrust_change"] = blmarch.plateau_thrust_change(body, m["i_sep"], q, fluid_inside=False)
        res["centerbody"] = m
        res["thrust_change"] += m["thrust_change"]

    if thrust is not None:
        res["corrected_thrust"] = thrust + res["thrust_change"]

    # equivalent conical diffuser from the rotor plane to the duct exit
    r_wall_in = geom["R_duct_at_rotor"]
    r_wall_out = geom["duct"][-1][1]
    r_hub_out = geometry._interp_r(geom["centerbody"], x_te) or 0.0
    res["diffuser"] = blmarch.diffuser_check(r_wall_in, geom["R_hub"], r_wall_out, r_hub_out,
                                             x_te - geom["x_rotor"])
    return res


def design(cfg):
    geom = geometry.build(cfg["geom"])
    if geom["stator_hub"] is None and cfg["geom"].get("stator_on"):
        raise DFDCError("Stator plane is outside the duct/centerbody; move it or disable it.")
    op, rot, st = cfg["oper"], cfg["rotor"], cfg["stator"]
    rid, workdir = _new_workdir()
    nrp = int(rot["nstations"])
    r_st = _stations(geom["R_hub"], geom["R_tip"], 10)
    rotor_aero = airfoils.resolve(rot["airfoil"])
    stator_on = bool(cfg["geom"].get("stator_on"))

    # thrust target: THRU drives B*Gamma when the rotor is an actuator disk
    target_cmds = []
    if op.get("thrust_basis") == "rotor":
        target_cmds.append("tspe")
    if op.get("target_mode", "thrust") == "thrust":
        target_cmds.append(f"thru {op['thrust']:.3f}")
    else:
        target_cmds.append("exec")
    bgam0 = op.get("bgam", 10.0) if op.get("target_mode") == "bgam" else 10.0

    rotor_disk = dict(kind="actdisk", x=geom["x_rotor"], nrp=nrp, rpm=op["rpm"],
                      aero=rotor_aero, stations=[(r, bgam0) for r in r_st])
    cl_cmd = f"cl {rot['cl_hub']:.3f} {rot['cl_tip']:.3f}"

    passes = 1
    if not stator_on:
        case, vref, atm = write_case(cfg, geom, [rotor_disk], cfg.get("name", "Fan"))
        cmds = ["oper", *target_cmds, f"nbld {int(rot['nblades'])}", cl_cmd, "desi", "exec",
                *_tail_commands(cfg)]
        out, elapsed = _run(case, cmds, workdir)
        return _assemble(cfg, geom, out, workdir, vref, atm, elapsed, passes)

    # pass 1: rotor alone, find the loading that gives the target thrust
    passes = 2
    case, vref, atm = write_case(cfg, geom, [rotor_disk], cfg.get("name", "Fan"))
    out1, el1 = _run(case, ["oper", *target_cmds], os.path.join(workdir, "pass1"))
    s1 = parse_summaries(out1)
    if not s1:
        raise DFDCError("Rotor-only pass did not converge.\n\n" + out1[-6000:])
    prof = _bgam_profile(s1[-1]["disks"][0])
    R = s1[-1]["disks"][0]["radius"] or geom["R_tip"]
    rotor_disk["stations"] = [(r, _interp(prof, r / R)) for r in r_st]

    # pass 2: add the stator carrying -k times the rotor circulation, design both rows
    k = st["swirl_recovery"] / 100.0
    rs_st = _stations(geom["stator_hub"], geom["stator_tip"], 10)
    Rs = geom["stator_tip"]
    stator_disk = dict(kind="actdisk", x=geom["x_stator"], nrp=nrp, rpm=0.0,
                       aero=airfoils.stator_aero(airfoils.resolve(st["airfoil"])),
                       stations=[(r, -k * _interp(prof, r / Rs)) for r in rs_st])
    case, vref, atm = write_case(cfg, geom, [rotor_disk, stator_disk], cfg.get("name", "Fan"))
    # the rotor is still an actuator disk here, so THRU re-drives its loading to the
    # target with the stator present (the stator keeps the pass-1 level of circulation)
    cmds = ["oper", *target_cmds,
            "2", f"nbld {int(st['nblades'])}", f"cl {st['cl']:.3f}", "desi",
            "1", f"nbld {int(rot['nblades'])}", cl_cmd, "desi",
            "exec", *_tail_commands(cfg)]
    out2, el2 = _run(case, cmds, workdir)
    res = _assemble(cfg, geom, out2, workdir, vref, atm, el1 + el2, passes)
    res["log"] = "===== PASS 1: rotor-only actuator disk =====\n" + out1 + \
                 "\n\n===== PASS 2: rotor + stator =====\n" + out2
    return res


def analyze(cfg, rotors):
    """rotors: list of saved disks (from a previous design result)."""
    geom = geometry.build(cfg["geom"])
    op, rot, st = cfg["oper"], cfg["rotor"], cfg["stator"]
    rid, workdir = _new_workdir()
    if not rotors or rotors[0]["kind"] != "rotor":
        raise DFDCError("No designed rotor to analyze - run a design first.")
    disks = []
    d0 = dict(rotors[0])
    d0.update(x=geom["x_rotor"], rpm=op["rpm"], aero=airfoils.resolve(rot["airfoil"]))
    disks.append(d0)
    if cfg["geom"].get("stator_on") and len(rotors) > 1:
        d1 = dict(rotors[1])
        d1.update(x=geom["x_stator"], rpm=0.0,
                  aero=airfoils.stator_aero(airfoils.resolve(st["airfoil"])))
        disks.append(d1)
    case, vref, atm = write_case(cfg, geom, disks, cfg.get("name", "Fan"))
    cmds = ["oper"]
    dpitch = float(op.get("pitch_delta") or 0.0)
    if abs(dpitch) > 1e-6:
        cmds.append(f"pitc {dpitch:.3f}")          # PITC adds a constant to every beta
    if op.get("analyze_trim"):
        if op.get("thrust_basis") == "rotor":
            cmds.append("tspe")
        cmds.append(f"thru {op['thrust']:.3f}")   # with blades, THRU drives pitch
    else:
        cmds.append("exec")
    cmds += _tail_commands(cfg)
    out, elapsed = _run(case, cmds, workdir)
    return _assemble(cfg, geom, out, workdir, vref, atm, elapsed, 1)
