"""Saved designs and reloadable runs.

Every solver run leaves a bundle (run.json) in its runs/<id>/ folder: the
slider settings, the mode, the blades that were fed in, and the full result.
runs/ is pruned to the last few, so a design worth keeping is copied with a
name into designs/<slug>/, which is never pruned.  Both kinds load the same
way: the bundle puts the UI back exactly as it was, results included, without
re-running DFDC.
"""
import json
import os
import re
import shutil
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DESIGN_ROOT = os.path.join(HERE, "designs")
RUN_FILES = ("case.case", "result.case", "stdout.txt", "session.txt", "cp.out")


def slug(name):
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", (name or "").strip()).strip("-.").lower()
    return s[:60] or "design"


def _summary(bundle):
    cfg = bundle.get("config") or {}
    res = bundle.get("result") or {}
    tot = res.get("total") or {}
    disks = res.get("disks") or []
    return dict(
        thrust=tot.get("thrust"), power=tot.get("power"), fom=tot.get("fom"), efficiency=tot.get("efficiency"),
        fan_dia_mm=(cfg.get("geom") or {}).get("fan_dia_mm"), nblades=(cfg.get("rotor") or {}).get("nblades"),
        rpm=(cfg.get("oper") or {}).get("rpm"), vinf=(cfg.get("oper") or {}).get("vinf"),
        stator=bool((cfg.get("geom") or {}).get("stator_on")),
        section=((cfg.get("rotor") or {}).get("airfoil") or {}).get("preset"),
        separated=bool(((res.get("bl") or {}).get("duct_inner") or {}).get("separated")),
        warnings=len(res.get("warnings") or []),
        bladed=bool(disks and disks[0].get("bladed")),
    )


def write_run_bundle(run_dir, mode, config, input_rotors, result):
    """Called after every solve so the run can be reloaded later."""
    bundle = dict(kind="run", name=config.get("name", "Fan"), note="", saved=time.strftime("%Y-%m-%dT%H:%M:%S"),
                  mode=mode, config=config, input_rotors=input_rotors or [], result=result)
    with open(os.path.join(run_dir, "run.json"), "w") as f:
        json.dump(bundle, f)
    return bundle


def _index_entry(kind, ident, bundle):
    return dict(kind=kind, id=ident, name=bundle.get("name"), note=bundle.get("note", ""),
                saved=bundle.get("saved"), mode=bundle.get("mode"), summary=_summary(bundle))


def list_runs(run_root):
    out = []
    if not os.path.isdir(run_root):
        return out
    for rid in sorted(os.listdir(run_root), reverse=True):
        p = os.path.join(run_root, rid, "run.json")
        if os.path.isfile(p):
            try:
                with open(p) as f:
                    b = json.load(f)
                out.append(_index_entry("run", rid, b))
            except (OSError, ValueError):
                continue
    return out


def list_designs():
    out = []
    if not os.path.isdir(DESIGN_ROOT):
        return out
    for d in os.listdir(DESIGN_ROOT):
        p = os.path.join(DESIGN_ROOT, d, "design.json")
        if os.path.isfile(p):
            try:
                with open(p) as f:
                    b = json.load(f)
                out.append(_index_entry("design", d, b))
            except (OSError, ValueError):
                continue
    out.sort(key=lambda e: e.get("saved") or "", reverse=True)
    return out


def load(kind, ident, run_root):
    ident = os.path.basename(ident)
    if kind == "design":
        p = os.path.join(DESIGN_ROOT, ident, "design.json")
    else:
        p = os.path.join(run_root, ident, "run.json")
    if not os.path.isfile(p):
        raise FileNotFoundError(f"no such {kind}: {ident}")
    with open(p) as f:
        bundle = json.load(f)
    logp = os.path.join(os.path.dirname(p), "dfdc_log.txt")
    if "log" not in (bundle.get("result") or {}) and os.path.isfile(logp):
        with open(logp, errors="replace") as f:
            bundle["result"]["log"] = f.read()
    return bundle


def save_design(name, note, mode, config, input_rotors, result, run_root, overwrite=False):
    """Copy the current state (and the DFDC files of its run) into designs/<slug>/."""
    ident = slug(name)
    d = os.path.join(DESIGN_ROOT, ident)
    if os.path.isdir(d) and not overwrite:
        raise FileExistsError(ident)
    os.makedirs(d, exist_ok=True)
    result = dict(result or {})
    log = result.pop("log", None)
    bundle = dict(kind="design", name=name.strip() or ident, note=(note or "").strip(),
                  saved=time.strftime("%Y-%m-%dT%H:%M:%S"), mode=mode, config=config,
                  input_rotors=input_rotors or [], result=result)
    with open(os.path.join(d, "design.json"), "w") as f:
        json.dump(bundle, f, indent=1)
    if log:
        with open(os.path.join(d, "dfdc_log.txt"), "w") as f:
            f.write(log)
    rid = result.get("run_id")
    if rid:
        src = os.path.join(run_root, os.path.basename(rid))
        for fn in RUN_FILES:
            if os.path.isfile(os.path.join(src, fn)):
                shutil.copy2(os.path.join(src, fn), os.path.join(d, fn))
    return _index_entry("design", ident, bundle)


def delete_design(ident):
    d = os.path.join(DESIGN_ROOT, os.path.basename(ident))
    if not os.path.isfile(os.path.join(d, "design.json")):
        raise FileNotFoundError(ident)
    shutil.rmtree(d)
