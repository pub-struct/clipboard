#!/bin/bash
# Get the focused window's stable sequence ID via GNOME Shell D-Bus (Wayland-compatible)
W=$(gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval \
  "global.display.focus_window ? String(global.display.focus_window.get_stable_sequence()) : ''" \
  2>/dev/null | grep -oP "(?<=')[0-9]+(?=')")

curl -s "http://127.0.0.1:17394/toggle?window=$W"
