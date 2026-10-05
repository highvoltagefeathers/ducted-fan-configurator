"""Local web server for the DFDC fan configurator.

    python server.py            serves on http://127.0.0.1:8765 and opens a browser
    python server.py --no-open  don't open a browser

Everything is Python standard library; the solver is the stock dfdc.exe.
"""
import json
import os
import sys
import threading
import traceback
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# the portable build runs on an embedded Python whose ._pth file fixes sys.path
# and does not add the script directory; make our own modules importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import airfoils  # noqa: E402
import dfdc_driver
import geometry

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
PORT = int(os.environ.get("FAN_PORT", "8765"))

# dfdc.exe is a single-threaded console program that writes files into its
# working directory; one run at a time keeps the parsing honest.
RUN_LOCK = threading.Lock()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=STATIC, **kw)

    def end_headers(self):
        # the UI is edited in place; never let the browser serve a stale app.js
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if args and "/api/geometry" in str(args[0]):
            return
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # ---- helpers ---------------------------------------------------------
    def _json(self, obj, status=HTTPStatus.OK):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path, download_name, ctype):
        if not os.path.isfile(path):
            return self._json({"error": "no such file"}, HTTPStatus.NOT_FOUND)
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    # ---- routes ----------------------------------------------------------
    def do_GET(self):
        if self.path == "/api/airfoils":
            return self._json(airfoils.PRESETS)
        if self.path.startswith("/api/case/"):
            rid = os.path.basename(self.path[len("/api/case/"):])
            return self._send_file(os.path.join(dfdc_driver.RUN_ROOT, rid, "result.case"), "fan.case", "text/plain")
        if self.path.startswith("/api/file/"):
            rid, _, name = self.path[len("/api/file/"):].partition("/")
            rid, name = os.path.basename(rid), os.path.basename(name)
            return self._send_file(os.path.join(dfdc_driver.RUN_ROOT, rid, name), name, "application/octet-stream")
        if self.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        try:
            req = self._body()
            if self.path == "/api/geometry":
                return self._json(geometry.build(req["geom"]))
            if self.path == "/api/step":
                import stepexport
                import tempfile
                # build the solid, return the STEP bytes; the browser chooses where to save
                with tempfile.TemporaryDirectory() as td:
                    path = os.path.join(td, "part.step")
                    with RUN_LOCK:
                        stepexport.export_step(req, path)
                    with open(path, "rb") as f:
                        data = f.read()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/step")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                return self.wfile.write(data)
            if self.path == "/api/run":
                with RUN_LOCK:
                    if req.get("mode") == "analyze":
                        res = dfdc_driver.analyze(req["config"], req.get("rotors") or [])
                    else:
                        res = dfdc_driver.design(req["config"])
                res["run_id"] = os.path.basename(res.pop("run_dir"))
                return self._json(res)
            return self._json({"error": "unknown endpoint"}, HTTPStatus.NOT_FOUND)
        except dfdc_driver.DFDCError as e:
            return self._json({"error": str(e)}, HTTPStatus.UNPROCESSABLE_ENTITY)
        except Exception as e:  # noqa: BLE001 - surface anything to the UI
            traceback.print_exc()
            return self._json({"error": f"{type(e).__name__}: {e}"},
                              HTTPStatus.INTERNAL_SERVER_ERROR)


def main():
    if not os.path.isfile(dfdc_driver.DFDC_EXE):
        print("dfdc.exe not found at", dfdc_driver.DFDC_EXE)
        sys.exit(1)
    url = f"http://127.0.0.1:{PORT}/"
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        # already running (launcher double-clicked twice): just open the page
        print("The configurator is already running at", url)
        if "--no-open" not in sys.argv:
            webbrowser.open(url)
        return
    print("DFDC fan configurator:", url)
    print("Keep this window open while you use it; close it to stop the program.")
    print("solver:", dfdc_driver.DFDC_EXE)
    if "--no-open" not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
