# Before you start: a rooted TV with SSH

lg-tv-home needs root access on the TV. The usual way on webOS 22 to 25:

1. **Turn off Quick Start+** (Settings, General, Devices, TV Management)
   *before* rooting. Leaving it on caused trouble on a test TV.
2. **Root the TV** with [dangbro-autoroot](https://azoffshowy.github.io/dangbro),
   opened in a browser on a laptop or phone in the same network (not in the
   TV's own browser). It installs **Homebrew Channel**. If the pairing page
   stays blank, the browser's *Local Network Access* protection is blocking it:
   in Chrome set `chrome://flags/#local-network-access-check` to Disabled, in
   Firefox set `network.lna.blocking` to false in `about:config`. Switch it
   back afterwards. Background reading: [rootmy.tv](https://rootmy.tv),
   [webosbrew.org](https://www.webosbrew.org).
3. **Right away**, open Homebrew Channel, Settings and turn on **Block system
   updates**. An LG firmware update silently removed root on a test TV.
4. **Turn on SSH** in the same settings. The first login is `root` with the
   password `alpine`.
5. **Add your SSH key.** This also switches the `alpine` password off:

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/lgtv_ed25519 -N ''
   ssh-copy-id -i ~/.ssh/lgtv_ed25519.pub root@<tv-ip>     # password: alpine
   ```

   and give the TV a short name in `~/.ssh/config`:

   ```
   Host lgtv
       HostName <tv-ip>
       User root
       IdentityFile ~/.ssh/lgtv_ed25519
       IdentitiesOnly yes
   ```

   `ssh lgtv` has to log in without asking for a password; `install.sh`
   relies on it. After a re-root or factory reset the TV gets a new host key;
   `ssh-keygen -R <tv-ip>` clears the warning.

Give the TV a fixed address in your router (a DHCP reservation) so the name
keeps working.
