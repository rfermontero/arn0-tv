#!/bin/bash
# Restaura el estado original de Home en la TV (TQ65QN90DATXXC).
# Uso: ./restore.sh  (desde la raíz del repo; requiere .tools/tv-exec.py)
# Restaura TODAS las claves del baseline.json a sus valores capturados.
set -eu
cd "$(dirname "$0")/.."
B=backup-local/baseline.json
H=$(python3 -c "import json;print(json.load(open('$B'))['Strings']['db/appfw/home_appid'])")
S=$(python3 -c "import json;print(json.load(open('$B'))['Strings']['db/appfw/startup_appid'])")
F=$(python3 -c "import json;print(json.load(open('$B'))['Strings']['db/first_screen/type'])")
Bk=$(python3 -c "import json;print(json.load(open('$B'))['Strings']['db/appfw/booting_appid_backup'])")
A=$(python3 -c "import json;print(json.load(open('$B'))['Autostart'])")

printf 'vconftool set -t string -f db/appfw/home_appid %s;vconftool set -t string -f db/appfw/startup_appid %s;vconftool set -t string -f db/first_screen/type %s;vconftool set -t string -f db/appfw/booting_appid_backup %s;vconftool set -t int -f db/menu/smart_hub/ontvsetting/auto_start %s\n' "$H" "$S" "$F" "$Bk" "$A" > /tmp/arn0-restore.sh

python3 .tools/tv-exec.py /tmp/arn0-restore.sh 30
echo "== verificación =="
printf 'vconftool get -t string db/appfw/home_appid;vconftool get -t string db/appfw/startup_appid\n' > /tmp/arn0-verify.sh
python3 .tools/tv-exec.py /tmp/arn0-verify.sh 30
