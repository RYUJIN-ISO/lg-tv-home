# Troubleshooting

Commands below run on a computer that can `ssh <tv>` (see
[PREREQUISITES.md](PREREQUISITES.md)). None of them changes what is on
screen unless it says so.

## After a power cycle the TV says "failsafe" or "crash"

Homebrew Channel starts in failsafe mode when the TV was switched off while
its boot scripts were still running (it keeps a flag armed until the last
one has returned, plus 10 seconds). lg-tv-home's boot scripts return at once,
so a hook that waits in the foreground is the usual cause. Check which hooks
are there: `ssh <tv> ls /var/lib/webosbrew/init.d`, and see
[How it works](HOW-IT-WORKS.md#boot-scripts).

## LG's home screen shows instead of TV Home

Run `./install.sh --yes` again: it sets TV Home as the home app (with
`SET_HOME=y`). After an LG firmware update, check that Homebrew Channel's
**Block system updates** is still on.

## Voice search, casting or an input stopped working

The [tracking services](modules/tracking-services.md) block may stop
something your model needs. Lift it until the next reboot:
`ssh <tv> sh /var/lib/webosbrew/debloat.sh lift`. If that fixes it, run
`./install.sh` and keep voice / smart home, or untick the tracking services,
and please report your model.

## An app can't update, or LG's store doesn't open

That's the [privacy lock](modules/privacy-lock.md). Settings, **App Store**
opens it for 10 minutes. With a Pi-hole you don't need the lock at all.

## A logo looks wrong

[Sharp logos](LOGOS.md#a-logo-looks-wrong).

## The Plex rows don't appear

Settings, **Features**, **Plex**: is it on, and is someone signed in
(**Account**)? Check: `ssh <tv> python3
/media/developer/apps/usr/palm/applications/com.iso.atvhome/plex.py account`.
What the last OK on a card did: `ssh <tv> cat /var/lib/webosbrew/atvhome/plex-play.log`.
[Plex](modules/plex.md).

## A remote button does what LG made it do

Settings, **Features**, **Remote Buttons** must be **On**. Check the filter:
`ssh <tv> sh /var/lib/webosbrew/remote-mapper/remote-mapper.sh status`
(`active` / `inactive`). After a reboot the filter comes back about 20
seconds after boot. [Remote Buttons](modules/remote-buttons.md).

## LG's screensaver shows instead of the Picture Frame

Instead of Screensaver needs the guard: `ssh <tv> cat /tmp/atvhome-saver.log`.
LG's screensaver always shows for about 10 seconds first.
[Picture Frame](modules/picture-frame.md).

## Logs

| File on the TV | What |
|---|---|
| `/tmp/debloat.state`, `/tmp/debloat.log` | tracking services |
| `/tmp/app-trim.log` | app trimming |
| `/tmp/remote-mapper.log` | remote mapper at boot |
| `/tmp/atvhome-saver.log`, `/tmp/atvhome-events.log`, `/tmp/atvhome-frame.txt` | Picture Frame |
| `/var/lib/webosbrew/atvhome/plex-play.log` | Plex |
| `/var/log/messages` | webOS's own log (rotated every few minutes) |

## Reporting a problem

Open an issue with your TV model and webOS version (`install.sh` prints
both), what you did and what happened, and the matching log. Never post a
Plex token or the files `plex-token`, `plex-server.json`, `hue-scene.conf`.
