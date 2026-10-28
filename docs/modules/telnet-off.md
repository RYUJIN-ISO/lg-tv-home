# Telnet off (security)

Rooting leaves a root shell open on the network without a password
(telnet). This turns it off; SSH keeps working.

| | |
|---|---|
| Installer | **Turn off the passwordless root telnet** (`TELNET_OFF`) |
| On the TV | the file `/var/luna/preferences/webosbrew_telnet_disabled` (Homebrew Channel's own switch) |
| Undo | `uninstall.sh` asks; or `ssh <tv> rm /var/luna/preferences/webosbrew_telnet_disabled` and reboot. Unticking it in `install.sh` leaves telnet as it is |

Anyone on your network could otherwise log in to the TV as root, with no
password. Keep it off.
