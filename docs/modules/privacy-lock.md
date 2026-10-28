# Privacy lock

Blocks LG's ad, tracking and ACR (automatic content recognition) servers on
the TV itself. LG's app store shares servers with them, so the store is
locked too; an **App Store** switch opens it for 10 minutes when apps need
updating.

| | |
|---|---|
| Installer | **Privacy lock** (`ADBLOCK`) |
| Switch | none: it is on while installed. Settings, **App Store** opens the store for 10 minutes |
| On the TV | the list `/var/lib/webosbrew/lg-ad-block-hosts.txt`, boot hook `init.d/60-lg-ad-block`, `/var/lib/webosbrew/store-mode.sh`; without TV Home also the small **App-Updates** app (`com.iso.appupdates`) |
| Removed by | unticking it in `install.sh`: the list's lines leave `/etc/hosts` at once, the files and the hook go |

## Do you need it?

**With a Pi-hole, AdGuard Home or a similar network-wide block: no.** Your
network already blocks these servers for every device, and leaving the lock
out keeps LG's store working without the switch. The installer's preset
**p) Pi-hole user** is everything but this module. The separate
[tracking services](tracking-services.md) module still helps: it stops the
services on the TV instead of only blocking where they send to.

## What is blocked

The **base ("safe") list** of
[hugobatista/lg-tv-ad-block](https://github.com/hugobatista/lg-tv-ad-block)
(file `list`), downloaded fresh by `install.sh`: LG's ad servers, ACR
(LG's viewing data), telemetry and log uploads. Its `list-store` variant is
deliberately not used: it would break the store for good.

See exactly what your TV blocks:

```bash
ssh <tv> cat /var/lib/webosbrew/lg-ad-block-hosts.txt
```

Every entry is there twice, as `0.0.0.0` (IPv4) and `::` (IPv6), because apps
otherwise reach blocked hosts over IPv6 (AAAA records).

## The App Store switch

Settings, **App Store** (and the App-Updates app on TVs without TV Home):

1. `store-mode.sh on` copies `/etc/hosts`, strips it back to the stock part
   (everything above Homebrew's marker line), and starts a 10 minute timer.
   It also lifts the [tracking services](tracking-services.md) block, because
   the store and updates may need LG's services.
2. LG's store opens.
3. `store-mode.sh off`, or the timer, restores both. So does a reboot.

`store-mode.sh status` prints `blocked` or `open <seconds left>`.

## How it works

`/etc` is read only on webOS, but Homebrew Channel puts a writable
`/etc/hosts` in place at every boot (its marker line: "This file is
dynamically regenerated on boot by webosbrew"). Homebrew then runs
`init.d/60-lg-ad-block`, which appends the list (instant). So the block lives
only until the next boot, and is added again each time; nothing in LG's file
system changes.

Code: `tv/init.d/60-lg-ad-block`, `tv/store-mode.sh`, `apps/tv-home/modules/store/`,
`apps/app-updates/`.
