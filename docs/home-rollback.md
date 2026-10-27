# Rollback del botón Home

Cómo devolver la TV a su estado original después de redirigir el botón Home al
launcher. Aplica a la configuración documentada en [setup-tv.md](setup-tv.md)
ejecutada con el runner de [scripts/tv-runner](../scripts/tv-runner).

## Qué cambió exactamente

El `apply` toca solo estas dos cosas (verificado con read-back en el momento
del cambio):

| Valor | Antes | Después |
| --- | --- | --- |
| Operación `main` (fila de `/opt/dbspace/user/5001/.appsvc.db`) | `com.samsung.tv.csfs` | tu app id de launcher |
| `db/appfw/home_appid` (vconf) | `com.samsung.tv.csfs` | tu app id de launcher |

`startup_appid`, `booting_appid_backup`, `first_screen/type` y `auto_start` se
reescriben **con el mismo valor que ya tenían** — el helper los toca pero no
los cambia. Arranque en frío, fuentes, volumen, menús: sin cambios.

## Camino 1 — restore del helper (el normal)

Si el helper sigue en la TV y la conexión de desarrollo funciona:

```sh
export ARN0_TV_IP=<ip-de-tu-TV>
python3 scripts/tv-runner/tv-exec.py /dev/stdin <<'EOF' 2>/dev/null
dotnet /home/owner/share/tmp/sdk_tools/arn0-Arn0HomeControl.dll restore 2>&1
EOF
```

Un resultado sano imprime `ARN0_RESTORED=home=com.samsung.tv.csfs;...`.
El restore se niega a correr si algún valor cambió a algo que no es ni el
original ni el launcher — en ese caso, mira primero qué pasó.

## Camino 2 — vconf desde el repo (sin helper en la TV)

Si perdiste los ficheros del helper pero el canal de ejecución sigue vivo:

```sh
./scripts/tv-runner/restore-home-vconf.sh
```

Restaura solo `home_appid` (y verifica). **No restaura la operación `main`**,
as que solo sirve si el cambio lo hizo `vconftool` a mano y no el helper. Si
el Home sigue yendo a Samsung Home con esto, es que la operación `main` sigue
apuntando al launcher: usa el camino 1 o reinstala el helper.

## Camino 3 — reconstruir el helper

Si la TV no tiene los ficheros del helper:

1. Compila: en `scripts/tv-runner/native-tv`, `dotnet build -c Release`
   (SDK 6.0.x; produce `Arn0HomeControl.dll`, `.runtimeconfig.json`, `.deps.json`).
2. Súbelos con `scripts/tv-runner/tv-upload.py` o incrustándolos en base64 en
   un script servido por `tv-exec.py` (ver cabecera de esos scripts).
3. Ejecuta `query` (solo lectura), comprueba que los valores son los esperados,
   y entonces `restore`.

## Camino 4 — sin canal de desarrollo

Si ni `sdb` ni el canal del instalador responden:

- El launcher tiene **Settings → Samsung Home**, que abre `com.samsung.tv.csfs`
  y desde ahí se llega a los menús de la TV. No lo quites del launcher.
- No entres al menú de servicio ni hagas un factory reset por esto. El Home
  redirigido no impide usar la TV: es un reencaminamiento de un botón.

## Después de una actualización de firmware

Una actualización puede deshacer o alterar cualquiera de estos valores. Tras
actualizar: ejecuta `query` (lectura) y comprueba qué queda antes de suponer
nada. Si el Home volvió a Samsung, `apply` de nuevo tras un `verify` limpio.

## Referencia rápida de comandos del helper

| Comando | Qué hace |
| --- | --- |
| `query` | imprime los valores actuales; no escribe nada |
| `verify` | comprueba que la TV está exactamente en el baseline embebido |
| `apply` | redirige Home al launcher (exige estado original exacto; auto-restaura si falla) |
| `restore` | devuelve los dos valores a `com.samsung.tv.csfs` |
