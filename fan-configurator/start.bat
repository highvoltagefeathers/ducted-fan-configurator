@echo off
rem Launch the DFDC fan configurator (local web app) and open a browser.
cd /d "%~dp0"
set PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe
if not exist "%PY%" set PY=python
"%PY%" server.py %*
