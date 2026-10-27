#!/usr/bin/env bash
# sdb (Tizen, linux amd64) dentro de un contenedor Docker amd64 persistente.
# Útil en Apple Silicon sin Rosetta. Requiere: docker, imagen ubuntu:24.04 amd64.
# Uso: sdb-run.sh [args de sdb]
CONTAINER="${ARN0_SDB_CONTAINER:-sdb-host}"
docker exec -i "$CONTAINER" /usr/local/bin/sdb "$@"
