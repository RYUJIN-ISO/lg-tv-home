# Backlog

Ideas saved for later. Nothing here is built yet.

## Crop and originals: needs proper UX design

**What happened (2026-10-26):** before version 0.23, cropping in the
Wallpaper menu cut a new file and saved it under the same name, so the
uncut picture was gone. On TV #1 that hit three pictures: Capriccio-Ruins
(3840x5120 became 3840x2160), Reclining-Youth (5079x3544 became 3840x2160)
and simsim (3840x2160 became 2560x1440). Since 0.23 a crop is only a stored
position and never changes the file, so this can't happen again. Reset
cannot bring these three back.

**Recovered (2026-10-26):** the three originals are back on TV #1 with their
cuts stored as crops (found with `find_crop.py`). simsim's camera file carries
EXIF orientation 3 (upside down); it went back as an upright copy, because the
matcher (and possibly the WebGL frame) reads raw pixels. Watch for EXIF
rotation in USB imports too.

**UX to design properly:**
- **Discoverable controls:** Reset is a pill at the end of the crop bar,
  reached only via OK; people don't find it. The crop screen needs its
  controls on screen (the crop screen's info card explains them since 0.24).
- **Clear states:** a picture card should show whether it has a crop, and
  the crop screen should make "this never changes your picture" obvious.
- **Original vs. crop:** an obvious way to see the whole picture again and
  to go back to it (Reset / "Show whole picture"), perhaps with undo.
- **Leftovers:** remove `wallpapers/originals/` and the old `orig` handling
  in `cache.js` once nothing needs them.
