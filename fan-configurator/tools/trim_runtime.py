"""Trim the embedded runtime of the portable package to what STEP export needs.

`cadquery-ocp` declares VTK (and through it numpy, matplotlib, pillow...) as
dependencies, ~450 MB, but the OCP binary itself only links a handful of VTK
DLLs and OCP/__init__.py merely adds the vtk.libs folder to the DLL search
path.  This script keeps the transitive closure of DLLs that OCP.pyd imports
(scanned from the PE import tables) and deletes everything else, then proves
the result by importing OCP and writing a STEP file.

Run with the package's own python:  python/python.exe trim_runtime.py <site-packages>
"""
import os
import re
import shutil
import struct
import sys

KEEP_TOP = {"OCP", "cadquery_ocp.libs", "vtk.libs"}
DLL_DIRS = ("vtk.libs", "cadquery_ocp.libs")


def pe_imports(path):
    """DLL names in a PE file's import table (plus delay-load table)."""
    with open(path, "rb") as f:
        data = f.read()
    try:
        pe = struct.unpack_from("<I", data, 0x3C)[0]
        nsec = struct.unpack_from("<H", data, pe + 6)[0]
        opt = pe + 24
        magic = struct.unpack_from("<H", data, opt)[0]
        dd_off = opt + (0x70 if magic == 0x20B else 0x60)
        sec_off = opt + struct.unpack_from("<H", data, pe + 20)[0]
        sections = []
        for i in range(nsec):
            s = sec_off + i * 40
            va, vsz, raw, rawsz = (struct.unpack_from("<I", data, s + 12)[0], struct.unpack_from("<I", data, s + 8)[0],
                                   struct.unpack_from("<I", data, s + 20)[0], struct.unpack_from("<I", data, s + 16)[0])
            sections.append((va, max(vsz, rawsz), raw))

        def rva(r):
            for va, sz, raw in sections:
                if va <= r < va + sz:
                    return raw + (r - va)
            return None

        names = set()
        for idx, entry_size, name_field in ((1, 20, 12), (13, 32, 4)):     # import dir, delay-load dir
            drva, dsz = struct.unpack_from("<II", data, dd_off + idx * 8)
            off = rva(drva) if drva else None
            if off is None:
                continue
            while True:
                entry = data[off:off + entry_size]
                if len(entry) < entry_size or not any(entry):
                    break
                nrva = struct.unpack_from("<I", entry, name_field)[0]
                noff = rva(nrva)
                if noff is not None:
                    end = data.index(b"\0", noff)
                    names.add(data[noff:end].decode("ascii", "ignore").lower())
                off += entry_size
        return names
    except Exception:
        # fall back to a string scan if the PE parse fails
        return set(m.lower() for m in re.findall(rb"[A-Za-z0-9_.\-]+\.dll", data) for m in [m.decode("ascii", "ignore")])


def main(site):
    pyd = next(p for p in os.listdir(os.path.join(site, "OCP")) if p.endswith(".pyd"))
    pyd = os.path.join(site, "OCP", pyd)
    available = {}
    for d in DLL_DIRS:
        dd = os.path.join(site, d)
        if os.path.isdir(dd):
            for fn in os.listdir(dd):
                if fn.lower().endswith(".dll"):
                    available[fn.lower()] = os.path.join(dd, fn)
    need, queue = set(), [n for n in pe_imports(pyd) if n in available]
    while queue:
        n = queue.pop()
        if n in need:
            continue
        need.add(n)
        queue.extend(m for m in pe_imports(available[n]) if m in available and m not in need)

    removed = 0
    for name, path in available.items():
        if name not in need:
            removed += os.path.getsize(path)
            os.remove(path)
    for entry in os.listdir(site):
        if entry in KEEP_TOP:
            continue
        p = os.path.join(site, entry)
        if os.path.isdir(p):
            removed += sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(p) for f in fs)
            shutil.rmtree(p, ignore_errors=True)
        else:
            removed += os.path.getsize(p)
            os.remove(p)
    kept = sum(os.path.getsize(available[n]) for n in need)
    print(f"kept {len(need)} DLLs ({kept / 1e6:.0f} MB), removed {removed / 1e6:.0f} MB")

    # prove it still works
    sys.path.insert(0, site)
    import OCP  # noqa: F401
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
    from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
    from OCP.BRepFill import BRepFill_Filling  # noqa: F401  (cap filler)
    from OCP.GeomAPI import GeomAPI_Interpolate  # noqa: F401
    w = STEPControl_Writer()
    w.Transfer(BRepPrimAPI_MakeBox(1.0, 2.0, 3.0).Shape(), STEPControl_AsIs)
    test = os.path.join(os.environ.get("TEMP", "."), "trim_check.step")
    w.Write(test)
    ok = os.path.getsize(test) > 1000
    os.remove(test)
    print("OCP import + STEP write:", "ok" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(os.path.abspath(sys.argv[1])))
