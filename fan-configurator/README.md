# Ducted Fan Configurator

A browser front end for **DFDC 0.70** (Drela & Youngren's Ducted Fan Design
Code).  The Fortran solver is used exactly as shipped (`../DFDC070/bin/dfdc.exe`);
this app only writes its input file, types the keyboard session for it, and
plots what it prints.

## Run it

Double-click `start.bat`, or:

```
python server.py
```

It serves on <http://127.0.0.1:8765/> and opens your browser.  Needs Python 3.10+
(standard library only) and the DFDC executable in `../DFDC070/bin/`.

## How it works

**Design mode** (default) — you give an operating point, a target thrust, the
geometry, a blade section and a design CL.  The server then runs one DFDC
session:

| step | DFDC command | what happens |
|---|---|---|
| 1 | `THRU <N>` | rotor modelled as an actuator disk; DFDC drives the disk loading (B·Γ) until the total thrust matches |
| 2 | `NBLD`, `CL hub tip`, `DESI` | blade chord and twist designed for that loading at the requested CL, using the section's polar and DFDC's cascade correction |
| 3 | `EXEC` | the flow is re-converged with the real blades |
| 4 | `BL` (optional), `FORC`, `CPWR`, `SAVE` | wall boundary layers, force breakdown, surface pressures, and the designed blade geometry are written out |

With a stator the loading is found in a rotor-only pass first, then a second
pass adds a stator disk carrying `-swirl_recovery × B·Γ` and designs both rows.

**Analyze mode** — available after a design.  The designed blades are re-run at
whatever speed, RPM and altitude you set, with an optional pitch offset
(`PITC`) or a pitch trim to the target thrust (`THRU` with blades drives pitch;
DFDC's pitch driver can oscillate, the app warns when it does).

Geometry is generated parametrically: a NACA 4-digit duct section (camber
facing the axis) and an ellipse-cylinder-cubic centerbody.  The UI works in
millimetres (fan and hub diameters, duct chord, centerbody lengths, rotor and
stator positions); `geometry.normalize()` converts to the metres DFDC expects.

The Section tab shows a radial-in stack of every station's outline (rotation
plane horizontal, blade moving right, inflow from the top), coloured root to
tip from red to violet, plus the 2-D lift curve and drag polar of the section
model.

## Live preview

The 3-D view (`static/viewer3d.js`, Three.js r128 bundled in `static/vendor/`)
lofts the blade through the section outline at every DFDC radial station
(Catmull-Rom between stations, NACA-style outline of the chosen family, wrapped
onto the cylinder at each radius), replicates it around the hub, and revolves
the duct and centerbody.  It is pure geometry from the blade table.

With **Live solve** on (default) every slider change re-runs DFDC in the
background, one run at a time, always with the latest settings.  Geometry,
blade count, section and pitch changes update the model immediately; the
blades are re-scaled in r/R from the last design and marked *re-scaled* until
the next solve replaces them (about half a second, one second with a stator).

## Flow-separation check (not part of DFDC)

DFDC is inviscid, so a diffusing duct keeps gaining thrust no matter how badly
it would stall.  Its own BL post-process is only usable in forward flight: in
hover the march starts at the duct trailing edge on the outer surface, trips
its separation flag in the dead air there, and integrates an empirical
separated profile around the rest of the wall.

`blmarch.py` instead marches a classic integral boundary layer along the wall
velocities DFDC computed (`CPWR` output): Thwaites (laminar), Michel's
transition criterion, Head's entrainment method (turbulent) with separation at
H = 2.4.  It runs on the duct inner wall from the lip stagnation point and on
the centerbody from the nose.  Three things come out of it:

* where the wall separates (shown in red on the side view, on the Summary
  tiles, and as H / Cf curves on the Pressures tab);
* a *separation-corrected thrust*: the wall pressure downstream of separation
  is held at its separation value and the lost pressure force integrated - an
  estimate of what the inviscid solution falsely credits;
* an equivalent-cone check of the exit expansion against the conical-diffuser
  first-stall line (Kline / Reneau).

It is a diagnostic, not a coupled viscous solution: it tells you when the
inviscid answer has stopped being believable.

## STEP export

Three buttons in the preview toolbar (`STEP: Blade / Stator / Duct`) each
write one CAD solid of what the 3-D view shows, in millimetres
(`stepexport.py`, CadQuery / OpenCascade, `pip install cadquery`).  The
browser asks where to save and what to call it (native dialog in Edge/Chrome;
Firefox falls back to a download).

* **Blade** - one lofted blade, extended 2 mm below the hub radius so it can
  be unioned onto a hub in CAD;
* **Stator** - one vane, extended 2 mm into the hub and the duct wall;
* **Duct** - the duct ring (section spline, revolved).

No hub, no pattern: the centerbody shape and the blade count are yours to
model around the parts.

Each blade is a B-spline skin lofted through every DFDC station (section
outline of the chosen family, scaled by chord, pitched by beta, wrapped onto
the cylinder of its radius, quarter chord on the disk plane), closed with
filled root and tip caps.  The sections are the same NACA-style sketch the
viewer draws: DFDC knows the polar, not the shape, so substitute your real
section coordinates if the family sketch is not what you intend to build.

## Saving and reloading designs

Every solve leaves a reloadable bundle in `runs/<timestamp>/` (`run.json`:
sliders, mode, input blades and the full result, next to DFDC's own files).
`runs/` keeps only the last 12, so a design worth keeping gets a name:

* **Save design** (top bar) copies the current state into
  `designs/<name>/` - `design.json` plus DFDC's case file, result file and
  log. Nothing prunes that folder; delete entries from the Designs panel.
  Saving is refused while the display is out of date with the solver, so what
  you save is what you saw.
* **Designs** (top bar) lists saved designs and the recent runs. *Load* puts
  the UI back exactly as it was - sliders, blades, every result tab - without
  re-running DFDC. Change a slider afterwards and live solve makes a new run;
  the saved copy is untouched. *Save as design* on a recent run keeps it
  before it is pruned.

`designs/` is a normal folder: back it up, commit it, or copy a design folder
to someone else's install.

## Blade sections

DFDC does not take airfoil coordinates.  Each section is a parametric polar
(`AERO` block): lift slope, CLmax/CLmin with a soft stall, a quadratic drag
bucket, Reynolds and Mach corrections.  `airfoils.py` holds representative fits
for a handful of families; every value is editable in the sidebar.  Two things
learned from the source that the DFDC manual does not spell out:

* `CD *= (Re/REref)^REexp` — the exponent must be **negative**; the sample cases
  shipped with DFDC use +0.35, which makes drag rise with Re.
* For a negative-circulation disk (stator) DFDC designs with the polar at
  **+CL** and analyses it at **−CL**, so any non-zero zero-lift angle makes the
  two disagree.  The app feeds the stator a polar with A0 = 0 and symmetric
  limits; stator vane angles are therefore relative to the zero-lift line.

## Sharing it: the portable package

```
powershell -ExecutionPolicy Bypass -File tools\build_package.ps1
```

builds `..\dist\DuctedFanConfigurator\` and a dated zip (~85 MB): Python's
embeddable runtime, the OpenCascade binding trimmed to the DLLs the exporter
links (`tools\trim_runtime.py`), this app, and DFDC 0.70 with its source and
GPL licence.  Recipients unzip and double-click `Start Fan Configurator.bat`;
nothing is installed.  The binding is pinned to the version the exporter was
tested with (`-OcpVersion`); `stepexport.py` also runs on the 8.x wheels.

## Files

```
server.py        HTTP + JSON API (stdlib http.server)
dfdc_driver.py   case writer, scripted DFDC session, output parsers
geometry.py      parametric duct / centerbody, ISA atmosphere
airfoils.py      section presets
static/          the single-page UI (vanilla JS + SVG)
runs/            one folder per DFDC run (case file, session, stdout, cp.out, result.case); last 12 kept
```

Each run folder is a complete, reproducible DFDC case: `dfdc case.case < session.txt`.
