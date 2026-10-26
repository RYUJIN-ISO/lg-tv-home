# Prerequisites: a rooted TV with SSH

lg-tv-home needs root on the TV. The usual path (2026) on webOS 22-25:

1. **Turn off Quick Start+** (Settings → General → Devices → TV Management)
   *before* rooting — leaving it on caused breakage in testing.
2. **Root** with [dangbro-autoroot](https://azoffshowy.github.io/dangbro) from
   a laptop/phone browser on the same network (not the TV's browser). It
   installs **Homebrew Channel**. If the pairing page stays blank, the browser's
   *Local Network Access* protection blocks it: Chrome
   `chrome://flags/#local-network-access-check` → Disabled, or Firefox
   `about:config` → `network.lna.blocking` → false (turn it back on afterwards).
   General background: [rootmy.tv](https://rootmy.tv), [webosbrew.org](https://www.webosbrew.org).
3. **Immediately** open Homebrew Channel → Settings → enable **Block system
   updates**. An LG firmware update silently removed root on a test TV.
4. **Enable SSH** in Homebrew Channel settings. Default login is
   `root` / `alpine`.
5. **Install your SSH key** (this also disables the `alpine` password):

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/lgtv_ed25519 -N ''
   ssh-copy-id -i ~/.ssh/lgtv_ed25519.pub root@<tv-ip>     # password: alpine
   ```

   and add an alias to `~/.ssh/config`:

   ```
   Host lgtv
       HostName <tv-ip>
       User root
       IdentityFile ~/.ssh/lgtv_ed25519
       IdentitiesOnly yes
   ```

   `ssh lgtv` must log in without a password — `install.sh` relies on it.
   SSH host keys change after every re-root/factory reset:
   `ssh-keygen -R <tv-ip>` fixes the warning.

Give the TV a fixed IP (DHCP reservation in the router) so the alias keeps
working.
