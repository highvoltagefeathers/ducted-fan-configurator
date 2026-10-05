# Ducted Fan Configurator

A browser front end for **DFDC 0.70**, Mark Drela and Harold Youngren's Ducted
Fan Design Code. Set up a ducted fan with sliders, let DFDC design the blades,
inspect thrust, power, blade loads and wall pressures in real time, check the
diffuser for flow separation, and export the blade, stator vane and duct as
STEP solids for CAD.

Every aerodynamic number comes from the unmodified DFDC solver; the app writes
its input, drives its menus and plots what it prints.

## Just want to run it?

Download the zip from the **Releases** page, unzip, double-click
`Start Fan Configurator.bat`. Windows 10/11, nothing to install.

## Running from source

```
cd fan-configurator
python server.py
```

Python 3.10+ (standard library only for the solver side). STEP export needs
the OpenCascade binding: `pip install cadquery-ocp`. The DFDC executable is
in `DFDC070/bin/`. Full details, design notes and caveats are in
[fan-configurator/README.md](fan-configurator/README.md).

## Layout

```
fan-configurator/   the app: server, DFDC driver, geometry, BL check, STEP export, web UI
DFDC070/            DFDC 0.70 exactly as distributed by MIT: executable, Fortran source, docs
```

## Licences

The configurator (`fan-configurator/`) is MIT licensed, see [LICENSE](LICENSE).
DFDC (`DFDC070/`) is GNU GPL v2, see `DFDC070/GNU_LICENSE_full.txt`; it is
redistributed unmodified, binary and source together, as the GPL requires.
Three.js (bundled in `fan-configurator/static/vendor`) is MIT.
