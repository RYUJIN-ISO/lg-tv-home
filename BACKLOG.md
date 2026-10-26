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

**Recovery, when wanted:** the originals still exist (the two photos in
`~/Projects/lg-tv-rooted/wallpapers/photos-2026-10-26/tv/`, simsim in the
TV's `wallpapers/originals/`). Copy them back and turn each cut into a
stored crop: the script `find_crop.py` in `~/Projects/lg-tv-rooted/wallpapers/`
(arguments: original, cut) finds where the cut sits inside the original and
prints the crop (`{x, y, w, r}`). Working copies are in `restore/` next to it.

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
