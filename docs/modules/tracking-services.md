# Tracking services

Stops LG's tracking, profiling and unused background services on the TV.
Casting (AirPlay, Chromecast, screen sharing) is never touched.

| | |
|---|---|
| Installer | **Stop LG's tracking and profiling background services** (`DEBLOAT`), plus two questions: voice search (`KEEP_VOICE`), ThinQ / Google Home / Alexa (`KEEP_SMARTHOME`) |
| Switch | none: on while installed. The App Store switch lifts it until you leave the Store |
| On the TV | `/var/lib/webosbrew/debloat.sh`, its settings `debloat.conf`, `debloat-stub`; boot hook `init.d/80-debloat` |
| Removed by | unticking it in `install.sh` (`debloat.sh lift`, files and hook go; a reboot restores the rest) |

## Exactly what stops

Groups, as set in `debloat.conf` (`1` = blocked):

| Group | Blocked | When |
|---|---|---|
| `BLOCK_TRACKING` | systemd units `contentminer`, `user-context-manager`, `nudge`, `com.webos.service.pushclient`, `rdxd`, `remotelogger`, `service-logger`, `rec-info-adapter`, `rec-listmgr`; programs `/usr/sbin/uploadd`, `/usr/sbin/admanager` | on a new install (kept as you set it) |
| `BLOCK_PRELOAD` | `preload-manager` (LG starting apps at boot) | with [app trimming](app-trim.md) |
| `BLOCK_VOICE` | `voiceinput`, `voiceconductor`; program `/usr/bin/com.webos.app.voice` | unless voice search is kept |
| `BLOCK_SMARTHOME` | `google-home-controller`; programs `lg.thinqai.adapter`, `trigger_thinq`, `iot-client` | unless ThinQ / Google Home / Alexa is kept |
| `BLOCK_MISC` | `com.webos.service.mycar` (car mode), `ftms` (fitness machine Bluetooth) | on a new install (kept as you set it) |

Kept on purpose: casting, `trigger_alexa` (the Alexa button needs it on some
TVs) and `sdx` (part of the broadcast stack; its uploads are blocked by the
[privacy lock](privacy-lock.md) anyway).

Units or programs your model doesn't have are skipped. Check the state:

```bash
ssh <tv> cat /tmp/debloat.state            # applied or lifted
ssh <tv> cat /var/lib/webosbrew/debloat.conf
```

Something stopped working after it (voice, casting, an input)? Lift it until
the next reboot and report it:

```bash
ssh <tv> sh /var/lib/webosbrew/debloat.sh lift
```

## How it works

- Nothing in LG's file system changes. systemd units are stopped and masked
  with `--runtime` (`/etc` is read only, and runtime masks vanish at reboot).
- Services the system bus starts on demand get their program covered by a
  stub that exits at once (`mount --bind`), so callers fail in about 0.1 s
  instead of the bus starting them again.
- `systemctl` takes 10 to 20 seconds per call on these TVs, so applying or
  lifting takes 2 to 3 minutes. `init.d/80-debloat` starts it 45 s after
  boot in the background (Homebrew's boot scripts must return at once, see
  [How it works](../HOW-IT-WORKS.md#boot-scripts)). When two runs overlap,
  the newest wins.

**Changing groups by hand.** `install.sh` sets `BLOCK_PRELOAD`,
`BLOCK_VOICE` and `BLOCK_SMARTHOME` from your answers on every install;
everything else in `debloat.conf` (`BLOCK_TRACKING`, `BLOCK_MISC`, any line
you added) stays as you left it. A new file blocks tracking and misc too.
After editing it, apply with `ssh <tv> sh /var/lib/webosbrew/debloat.sh apply`
(or reboot).

Code: `tv/debloat.sh`, `tv/init.d/80-debloat`.
