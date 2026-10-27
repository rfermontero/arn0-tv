# TV runner — ejecutar el helper de Home en la TV

Lo que [docs/setup-tv.md](../../docs/setup-tv.md) llama el "runner": cómo
ejecutar `native-tv/Arn0HomeControl` (adaptación de `native/Control.cs`) en una
TV concreta por la conexión de desarrollo, sin root. Probado en Tizen 9
(QN90D, firmware T-PTMDDEUC-0090-2130.0); el método es el mismo que documentan
[CleanFrame](https://github.com/nthnclrk/CleanFrame) y
[couchroot/S90D](https://github.com/splitcipher/couchroot).

## Cómo funciona

1. El shell normal de `sdb` está cerrado en retail y `sdb push` no entrega
   ficheros con este sdbd antiguo. Pero el argumento de paquete de
   `0 appinstall tpk <ruta>.tpk` pasa por la shell de la TV, y los backticks
   **sin espacios** (`${IFS}`) se expanden como UID 901 (`sdk`).
2. El payload inline (limitado a ~400 B) hace que la TV descargue el script
   real con `curl` desde un listener efímero en este ordenador y devuelva la
   salida con `curl POST`. La salida de `sdb shell` con backticks es siempre
   `closed`: no sirve como indicador de éxito.
3. El helper corre con `dotnet` de la TV (runtime 6.0.9). No puede ejecutarse
   desde `/tmp` (SMACK); se usa `/home/owner/share/tmp/sdk_tools/`.

## Puesta en marcha (una vez)

- `docker` y `python3` en este Mac; la TV en Developer Mode, misma red.
- `sdb` linux amd64 en Docker (Apple Silicon sin Rosetta):

  ```sh
  curl -LO https://download.tizen.org/sdk/tizenstudio/official/binary/sdb_4.2.36_ubuntu-64.zip
  docker run -d --name sdb-host --platform linux/amd64 ubuntu:24.04 \
    bash -c "while true; do sleep 3600; done"
  docker cp <(unzip -p sdb_4.2.36_ubuntu-64.zip data/tools/sdb) sdb-host:/usr/local/bin/sdb
  ```

- Si el bridge de Docker no alcanza la LAN: `python3 tv-forward.py` en segundo
  plano y usar el serial `host.docker.internal:26101` (los scripts lo hacen).
- Con SDK 6.0.x instalado: `dotnet build -c Release` en `native-tv/`.

## Uso

```sh
export ARN0_TV_IP=<ip-de-tu-TV>

python3 tv-exec.py <script.sh>            # ejecuta un script shell en la TV (UID 901)
python3 tv-upload.py <fichero> <destino>  # sube un fichero (fetch del TV)
```

El helper en la TV: `dotnet /home/owner/share/tmp/sdk_tools/arn0-Arn0HomeControl.dll
<query|verify|apply|restore>` — los comandos y sus garantías están en
[docs/home-rollback.md](../../docs/home-rollback.md). La subida fiable de
binarios es incrustarlos en base64 dentro de un script servido por `tv-exec.py`
(`curl -o` en la TV escribe 0 bytes con este sdbd).

## Avisos

- `tv-exec.py` ejecuta en la TV lo que le pases, como UID 901: es una llave,
  no un juguete. Los scripts de este repo con ese fin son de solo lectura
  salvo el `apply`/`restore` del helper.
- `native-tv/Control.cs` lleva embebido el baseline capturado de una TV
  concreta (valores originales y guard exacto de firmware). Si tu TV es otra,
  captura tu propio `query`, edita las constantes `Orig*` y `FirmwareGuard`,
  y recompila. No publiques el baseline de una TV que no es tuya.
- Nada de esto toca power-on (`startup_appid` se reescribe con su valor actual).
