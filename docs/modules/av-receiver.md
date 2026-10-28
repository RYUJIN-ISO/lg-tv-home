# AV receiver button

A button at the top left that sends the sound to an AV receiver or soundbar
on HDMI eARC with one press, and wakes it.

| | |
|---|---|
| Installer | **AV receiver button** (`AVR`), part of TV Home |
| Switch | Settings, **Features**, **AV receiver button** (on when chosen in the installer) |
| On the TV | nothing beyond TV Home itself (the switch is `avrButton` in the config) |
| Removed by | unticking it in `install.sh` |

## Using it

Press the speaker button at the top left. TV Home shows whether the TV
switched the sound output.

## Why

When a receiver switches itself off, the TV falls back to its own speakers
and stays there. Choosing HDMI eARC again in LG's sound menu takes several
clicks; this is one.

## How it works

It calls the same thing as LG's sound output menu:
`luna://com.webos.service.apiadapter/audio/changeSoundOutput
{"output": "external_arc"}`. Selecting eARC makes the TV ask the receiver
over HDMI-CEC to come on.

Code: `apps/tv-home/modules/avr/`.
