#!/bin/sh
# Light button / Philips Hue app: switches between the cinema scene and the
# "back to" target (previous lighting or a chosen scene). Prints "movie" or
# "restored". All logic and settings live in hue.py (Settings, Hue on TV Home).
exec python3 "$(dirname "$0")/hue.py" toggle
