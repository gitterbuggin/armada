#!/bin/bash
set -euxo pipefail

cp -a /ctx/system_files/. /
install -Dpm 0755 /ctx/vendor/inputplumber/inputplumber /usr/bin/inputplumber

chmod 0755 /usr/bin/steamos-update
chmod 0755 /usr/libexec/armada/*
chmod 0755 /usr/libexec/os-session-select

find /etc/NetworkManager/system-connections -name '*.nmconnection' -exec chmod 0600 {} + -exec chown root:root {} + 2>/dev/null || true

systemctl disable getty@tty1.service || true
systemctl enable sddm.service
systemctl enable seatd.service
systemctl enable inputplumber.service
systemctl enable armada-device-quirks.service
systemctl enable armada-perf-paths.service
systemctl enable armada-steamapps.service
systemctl enable armada-game-watch.service
systemctl enable armada-powerkey.service
systemctl enable tuned.service

# Sleep hangs on SM8550; suspend is redirected to fake-suspend, mask the rest.
systemctl mask systemd-hibernate.service systemd-hybrid-sleep.service systemd-suspend-then-hibernate.service
