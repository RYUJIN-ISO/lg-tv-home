# Picture Frame Overlay (com.iso.frameoverlay)

The Picture Frame in an **overlay window**, over the app on screen. Used by
`framesaver.py` ("Instead of Screensaver") while music plays (Spotify and the
like): launching TV Home would push the music app into the background, where
it stops; an overlay leaves it in front, so the music goes on.

There is no code of its own here. `stage_frame_overlay` (lib/common.sh)
copies the staged TV Home (a web app can't load files from another app's
folder) with this app's `appinfo.json` and `FRAME_ONLY = true` added to the
page, which makes app.js skip the home screen and start the frame as soon as
the pictures are in. `cache/` is a link to TV Home's (`link_frame_overlay`).
The frame ending closes the overlay. install.sh installs it with every TV
Home update while the Picture Frame module is on; removing the module
removes it.
