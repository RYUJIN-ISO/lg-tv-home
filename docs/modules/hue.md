# Philips Hue

A **Light** button at the top left that switches a Hue room between a cinema
scene and the lighting from before, plus your rooms and lights in TV Home.
Paired on the TV, no computer needed.

| | |
|---|---|
| Installer | **Philips Hue** (`LIGHT`), part of TV Home |
| Switch | Settings, **Features**, **Philips Hue** |
| On the TV | the Light app `com.iso.moviescene` (`hue.py`, `scene.sh`); settings in `/var/lib/webosbrew/hue-scene.conf` and `hue-scene.mode` |
| Removed by | unticking it in `install.sh` (removes the Light app; the pairing stays) |

Needs a Hue bridge in the same network. Other systems (Home Assistant,
Govee, Nanoleaf) are not supported yet.

## Using it

- **Light button** (top left, bulb): one press starts the cinema scene, the
  next goes back. It glows warm while cinema is on; a green ring flashes when
  it worked, a red one if the bridge didn't answer. **Hold OK** opens the
  rooms.
- Settings, **Features**, **Philips Hue**, **Rooms and lights**: your rooms
  and zones as cards, warm when on (warmer the brighter). **OK** switches a
  room, **hold OK** opens it: power, **brightness** (Left/Right in 10 %
  steps), its **scenes**, and every **light**.
- **Light button** (in the same menu): the **room**, the **cinema scene**,
  and what the next press goes **back to**: the lighting from just before
  cinema (default) or a scene you pick.
- **Pairing:** without a paired bridge, Rooms and lights finds the bridge
  (or asks for its IP) and waits up to 60 seconds for you to press the button
  on the bridge. From a computer, `TV=<tv> tools/hue-setup.sh` does the same.

A remote button can switch the light too ([Remote Buttons](remote-buttons.md),
**Light**).

## How it works

`hue.py` (Python standard library, run as root) talks to the bridge's v1 API
over HTTPS (self-signed certificate). `hue-scene.conf` holds `BRIDGE`, `KEY`,
`GROUP`, `SCENE` (cinema), `RESTORE` (a scene named "TV Home before" that
stores the lighting before cinema), `BACK` (`previous` or `scene`) and
`BACK_SCENE`. `hue-scene.mode` remembers whether cinema is on.

- **toggle**: cinema off, so (with `BACK=previous`) save the current lighting
  into the snapshot scene with `storelightstate`, then recall the cinema
  scene. Cinema on, so recall the snapshot or `BACK_SCENE`. `scene.sh` wraps
  it (the Light button, and the Philips Hue app that remote buttons open).
- **status** returns rooms and zones with their lights and scenes in one call;
  **room**, **light** and **scene** change things; **set** saves the button
  setup and creates the snapshot scene in the chosen room.
- **pair**: POST `/api` with `devicetype` until the bridge button is pressed;
  **discover** asks `discovery.meethue.com`.

The pairing key only lives on the TV, never in `setup.conf`.

Code: `apps/tv-home/modules/hue/`, `apps/hue-light/`.
