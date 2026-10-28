# Plex

Continue Watching from your Plex server above the apps (and new titles
below them, if you like). OK resumes right where you stopped, without
waiting for Plex to start.

| | |
|---|---|
| Installer | **Plex** (`PLEX`), part of TV Home |
| Switch | Settings, **Features**, **Plex** |
| On the TV | `plex.py`, `devtools.py` in TV Home's app folder; the hidden helper app `com.iso.plexlink`; sign-in files in `/var/lib/webosbrew/atvhome/` (`plex-token`, `plex-server.json`, `plex-client-id`, root only) |
| Removed by | unticking it in `install.sh` (removes the helper app; the sign-in stays until you sign out) |

For anyone with a Plex account that can use a Plex server (their own, or one
someone shared with them). The Plex app from LG's store should be installed
too; TV Home falls back to it.

## Using it

- **Sign in:** Settings, **Features**, **Plex**, **Account** shows a code.
  Open **plex.tv/link** on a phone or computer and enter it; the rows appear
  a few seconds later. Each TV signs in on its own and shows up as "TV Home"
  in your Plex account's devices. Nobody copies a password or token.
- **Continue Watching** sits above the apps, with a progress bar and the
  time left. **Up** from the first app row reaches it, **Left/Right** move
  along it, **OK** starts it where you stopped.
- **New in your libraries** (off by default) shows unwatched new titles
  below the apps; **OK** opens the title's page in Plex.
- The **Plex** tile opens Plex at once: TV Home keeps it started in the
  background (about 115 MB).

Settings, **Features**, **Plex**:

| Setting | What it does |
|---|---|
| **Account** | Sign in, or see who is signed in and sign out |
| **Continue Watching** / **New in your libraries** | Show or hide each row |
| **Show Continue Watching** | **Always**; **When Plex is selected**: the row fades in only while the Plex tile has the focus, like the Apple TV's top shelf (the Plex tile has to be in the first row); **On Up**: hidden until Up from the first row moves into it |
| **Keep Plex ready** | Keeps Plex started in the background (on). Off frees the memory |
| **Libraries** | Which libraries the rows show (all movie and show libraries by default) |
| **Refresh now** | Fetches the rows now (otherwise every time TV Home appears, at most once a minute) |

## How it works

**Signing in.** `plex.py signin` asks plex.tv for a PIN (`POST
/api/v2/pins`), the TV shows its code, and `plex.py signin-check` polls
`/api/v2/pins/<id>` every 3 seconds until the code was entered; then the PIN
carries a token for this TV. Each TV has its own random client id (made
once, in `plex-client-id`), so every TV is its own device under the account,
named "TV Home" plus the id's last 4 characters, and can be removed there.
Next to the id the file keeps hashes of the TV's LAN and Wi-Fi addresses
(never sent anywhere): when the data folder was copied from another TV, none
matches, so the id is replaced and the copied sign-in dropped. Signing out
forgets the id too.

The token is in `plex-token` (root only, mode 600); it never reaches the web
page or a picture URL. Keys from the server (items, libraries) must be
numbers, anything else is skipped, because they end up in file names and in
TV Home's root shell commands.

**Finding the server.** `plex.tv/api/v2/resources` lists the servers the
account can use: its own first, else one shared with it, direct connections
before relays. The working address, its token, id and name are cached for 6
hours in `plex-server.json` (mode 600) and looked up again when the address
stops answering. A shared server answers with the signed-in person's own
Continue Watching.

**Rows.** `plex.py` reads `/hubs/continueWatching` (and the libraries'
`recentlyAdded` when that row is on), saves the pictures scaled by the server
into the app's `cache/plex/`, and writes `cache/plex/rows.json`. The page
shows that file at once, then runs `plex.py refresh` and swaps in its answer,
every time TV Home appears (at most once a minute), so what you just watched
is at the front.

**Opening Plex at a title.** The store app (`cdp-30`) is a small encrypted
loader for the Plex web app, and that web app ignores launch parameters, so
deep links can't work. Instead:

1. `apps/plex-link` (`com.iso.plexlink`, hidden from the app list) is a
   developer mode app that only loads the same Plex web app. It shares the
   Plex sign-in with the store app (same origin, same storage).
2. Developer mode apps can be inspected over the TV's DevTools port
   (`127.0.0.1:9998`); store apps can't.
3. `plex.py play <id>` / `open <id>` launches plexlink, waits until Plex has
   drawn its screen and is signed in, then calls Plex's own
   `appController.processDeepLink` with the item (and its resume offset)
   through `devtools.py`, a small standard library DevTools client. The
   result of the last call is in `/var/lib/webosbrew/atvhome/plex-play.log`.
4. If any of this fails, Plex stays on its home screen; if plexlink is
   missing, the store app opens.

Plex's code is minified and changes with updates, so the script finds the
module that exports Plex's service container by its source text, not its
number, and only after Plex has drawn its first screen (touching it earlier
leaves a black screen).

**Keeping Plex ready.** A few seconds after TV Home is shown, `plex.py
preload` launches plexlink with the app manager's `"preload": "full"` mode
(started hidden), only when someone is signed in and it isn't running yet.
App trimming never closes `com.iso.*` apps.

**Checking it** (nothing on screen changes): `ssh <tv> python3
/media/developer/apps/usr/palm/applications/com.iso.atvhome/plex.py account`
prints the account and server name, `... plex.py refresh` the rows. Never
`cat` the token files.

Code: `apps/tv-home/modules/plex/`, `apps/plex-link/`.
