#!/usr/bin/env python3
# Reenvía puertos locales -> TV. Necesario porque el bridge de Docker no alcanza la LAN.
import os, socket, threading, sys
TV = os.environ.get("ARN0_TV_IP", "192.168.1.128")  # export ARN0_TV_IP=<tu TV>
PORTS = [26099, 26101, 8001]
def pipe(a, b):
    try:
        while True:
            d = a.recv(65536)
            if not d: break
            b.sendall(d)
    except OSError: pass
    finally:
        try: a.close(); b.close()
        except OSError: pass
def forward(lport):
    srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("0.0.0.0", lport)); srv.listen(16)
    print(f"{lport} -> {TV}:{lport}", flush=True)
    while True:
        c, _ = srv.accept()
        u = socket.socket(); u.settimeout(5)
        try: u.connect((TV, lport)); u.settimeout(None)
        except OSError: c.close(); continue
        threading.Thread(target=pipe, args=(c, u), daemon=True).start()
        threading.Thread(target=pipe, args=(u, c), daemon=True).start()
for p in PORTS:
    threading.Thread(target=forward, args=(p,), daemon=True).start()
print("listo", flush=True)
threading.Event().wait()
