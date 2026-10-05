# Build a portable, no-install Windows package of the Ducted Fan Configurator.
#
#   powershell -ExecutionPolicy Bypass -File tools\build_package.ps1
#
# Produces  <sandbox>\dist\DuctedFanConfigurator\  and a dated zip next to it:
#   python\            Python 3.12 embeddable runtime + the OpenCascade bindings (STEP export)
#   fan-configurator\  this app
#   DFDC070\           DFDC 0.70 as distributed by MIT (executable, source, docs, GPL licence)
#   Start Fan Configurator.bat, README.txt, LICENSES.md
param([string]$PythonVersion = "3.12.10",
      [string]$OcpVersion = "7.9.3.1.1")    # the OpenCascade binding the exporter was tested against
$ErrorActionPreference = "Stop"

$root    = (Resolve-Path "$PSScriptRoot\..").Path            # fan-configurator
$sandbox = (Resolve-Path "$root\..").Path
$dist    = Join-Path $sandbox "dist"
$pkg     = Join-Path $dist "DuctedFanConfigurator"
$stamp   = Get-Date -Format "yyyy-MM-dd"

Write-Host "== package dir: $pkg"
if (Test-Path $pkg) { Remove-Item -Recurse -Force $pkg }
New-Item -ItemType Directory -Force $pkg | Out-Null

# ---- 1. embeddable Python ---------------------------------------------------
$zip = Join-Path $env:TEMP "python-$PythonVersion-embed-amd64.zip"
if (-not (Test-Path $zip)) {
    Write-Host "== downloading Python $PythonVersion embeddable"
    curl.exe -sSL -o $zip "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
}
Expand-Archive $zip -DestinationPath "$pkg\python" -Force
$pth = Get-ChildItem "$pkg\python\python3*._pth" | Select-Object -First 1
$pyzip = [IO.Path]::GetFileNameWithoutExtension($pth.Name) + ".zip"
@($pyzip, ".", "Lib\site-packages", "import site") | Set-Content $pth.FullName -Encoding ascii

# ---- 2. pip + OpenCascade bindings -----------------------------------------
$getpip = Join-Path $env:TEMP "get-pip.py"
if (-not (Test-Path $getpip)) { curl.exe -sSL -o $getpip "https://bootstrap.pypa.io/get-pip.py" }
$py = "$pkg\python\python.exe"
Write-Host "== installing pip + cadquery-ocp into the embedded runtime"
& $py $getpip --no-warn-script-location -q
& $py -m pip install -q --no-warn-script-location "cadquery-ocp==$OcpVersion"
& $py -c "import OCP; print('   OCP ok')"
# keep only the DLLs OCP links (drops VTK's python side, numpy, matplotlib, pip...)
Write-Host "== trimming the runtime"
& $py "$PSScriptRoot\trim_runtime.py" "$pkg\python\Lib\site-packages"
if ($LASTEXITCODE -ne 0) { throw "runtime trim failed" }
Remove-Item -Recurse -Force "$pkg\python\Scripts" -ErrorAction SilentlyContinue
Get-ChildItem "$pkg\python" -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force

# ---- 3. the app and DFDC ------------------------------------------------------
Write-Host "== copying app and DFDC"
robocopy "$root" "$pkg\fan-configurator" /E /NFL /NDL /NJH /NJS /XD runs __pycache__ tools /XF start.bat | Out-Null
robocopy "$sandbox\DFDC070" "$pkg\DFDC070" /E /NFL /NDL /NJH /NJS | Out-Null
Get-ChildItem "$pkg\DFDC070\runs" -File -Include "*.out","designed.case","s3_*" -Recurse -ErrorAction SilentlyContinue | Remove-Item -Force

# ---- 4. launcher, readme, licences -------------------------------------------
@'
@echo off
title Ducted Fan Configurator
cd /d "%~dp0fan-configurator"
"%~dp0python\python.exe" server.py
echo.
echo The configurator has stopped. Close this window.
pause >nul
'@ | Set-Content "$pkg\Start Fan Configurator.bat" -Encoding ascii

@"
DUCTED FAN CONFIGURATOR  (portable build $stamp)
================================================

A browser front end for DFDC 0.70, Mark Drela and Harold Youngren's Ducted Fan
Design Code. Set up a ducted fan with sliders, let DFDC design the blades,
inspect thrust, power, blade loads and wall pressures, and export the blade,
stator vane and duct as STEP solids for CAD.

RUN IT
------
1. Unzip this folder anywhere (a short path such as C:\DuctedFan is ideal).
2. Double-click "Start Fan Configurator.bat".
   A console window opens and your browser shows http://127.0.0.1:8765/
   Keep the console window open while you work; close it to quit.
3. Nothing is installed and nothing touches the registry; delete the folder
   to remove everything.

Requirements: 64-bit Windows 10 or 11. Edge or Chrome for the STEP save
dialog (Firefox works but saves STEP files to its download folder).

If Windows shows "Windows protected your PC" when you run the .bat for the
first time (SmartScreen, because the file came from the internet), click
"More info" then "Run anyway". If the folder came as a zip, you can also
right-click the zip before extracting, choose Properties and tick "Unblock".

WHAT IS IN HERE
---------------
fan-configurator\   the web app (Python + browser)
DFDC070\            DFDC 0.70 exactly as distributed, with source and docs
python\             a private Python runtime, used only by this app
fan-configurator\runs\   one folder per solver run (case file, log, results)

HOW IT WORKS, IN ONE PARAGRAPH
------------------------------
DFDC is an axisymmetric panel method with blade-element rotor and stator
models. The app writes DFDC's input file, drives the solver through its
keyboard menus, and plots what it prints. Design mode drives the rotor loading
to your target thrust, designs blade chord and twist for your section and lift
coefficient, then re-converges with the real blades. Every aerodynamic number
on screen is DFDC's. The app adds three things DFDC does not have: a
parametric geometry generator, a boundary-layer march that flags diffuser
separation (DFDC is inviscid and would otherwise reward a stalled diffuser),
and the STEP export. See fan-configurator\README.md for details and caveats.

LICENCES
--------
See LICENSES.md. DFDC is GNU GPL; its complete source is in DFDC070\.
"@ | Set-Content "$pkg\README.txt" -Encoding utf8

@"
# Licences

| component | licence | where |
|---|---|---|
| DFDC 0.70 (Drela & Youngren, MIT / Aerocraft) | GNU General Public License v2 | ``DFDC070/GNU_LICENSE_full.txt``; complete source in ``DFDC070/src-*`` and ``DFDC070/plotlib`` |
| Python 3.12 embeddable runtime | PSF License | ``python/LICENSE.txt`` |
| OpenCascade Technology via ``cadquery-ocp`` | LGPL 2.1 with OCCT exception | https://dev.opencascade.org/doc/overview/html/index.html#OCCT_OVW_SECTION_1_2 |
| Three.js r128 (``fan-configurator/static/vendor``) | MIT | https://github.com/mrdoob/three.js/blob/dev/LICENSE |
| Fan configurator app (``fan-configurator/``) | as stated by whoever sent you this package | |

DFDC is redistributed unmodified, binary and source together, as the GPL requires.
"@ | Set-Content "$pkg\LICENSES.md" -Encoding utf8

# ---- 5. zip -------------------------------------------------------------------
$zipOut = Join-Path $dist "DuctedFanConfigurator-$stamp.zip"
if (Test-Path $zipOut) { Remove-Item $zipOut }
Write-Host "== zipping"
Compress-Archive -Path $pkg -DestinationPath $zipOut -CompressionLevel Optimal
$mb = [math]::Round((Get-Item $zipOut).Length / 1MB, 1)
$folderMb = [math]::Round((Get-ChildItem $pkg -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 0)
Write-Host "== done: $zipOut  ($mb MB zipped, $folderMb MB unpacked)"
