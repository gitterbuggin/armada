#!/bin/bash
set -euxo pipefail

cp -a /ctx/system_files/. /
install -Dpm 0755 /packages/extest/libextest.so /usr/lib/extest/libextest.so
# SDM845 (AYN Odin) modem firmware server — WLAN fw lives on the modem DSP
install -Dpm 0755 /packages/tqftpserv/tqftpserv /usr/bin/tqftpserv

# mkbootimg must be present for on-device /KERNEL rebuilds after OTA.
install -Dpm 0755 /ctx/build_files/vendor/mkbootimg/mkbootimg.py /usr/libexec/armada/mkbootimg.py
install -Dpm 0755 /ctx/build_files/vendor/mkbootimg/gki/generate_gki_certificate.py /usr/libexec/armada/gki/generate_gki_certificate.py
sha256sum -c <<'EOF'
37d84b3d162e0bc62e36c1f4e1c63c85ea0caa9f29be023eb2f8efe006ad948c  /usr/libexec/armada/mkbootimg.py
1bb1feec68a13da18d581aa2c631798f86f6bc10b55d587b2dd31446a0f8a203  /usr/libexec/armada/gki/generate_gki_certificate.py
EOF

chmod 0755 /usr/libexec/armada/*
chmod 0755 /usr/libexec/os-session-select
chmod 0755 /usr/lib/systemd/system-shutdown/armada-blackbox.sh

sed -i '/const allPanels/,$d' /usr/share/plasma/layout-templates/org.kde.plasma.desktop.defaultPanel/contents/layout.js
sed -i '$r /usr/share/plasma/shells/org.kde.plasma.desktop/contents/updates/armada-pins.js' /usr/share/plasma/layout-templates/org.kde.plasma.desktop.defaultPanel/contents/layout.js

find /etc/NetworkManager/system-connections -name '*.nmconnection' -exec chmod 0600 {} + -exec chown root:root {} + 2>/dev/null || true

systemctl disable getty@tty1.service || true
# Bring-up default for the sdm845-odin branch: keep sshd on so every fresh
# flash is reachable over the LAN. Revert to disabled before any public image.
systemctl enable sshd.service
systemctl enable sddm.service
systemctl enable armada-session-default.service
systemctl enable seatd.service
systemctl enable armada-input-calibration.service
systemctl enable armada-controller-type.service
systemctl enable inputplumber.service
systemctl enable armada-device-quirks.service
systemctl enable armada-fixups.service
# SDM845/Odin Wi-Fi chain (units are ConditionPathExists-gated to sdm845)
systemctl enable rmtfs.service
systemctl enable tqftpserv.service
systemctl enable odin-modem-start.service
systemctl enable armada-audio-awake.service
systemctl enable armada-installer-visibility.service
systemctl enable armada-steamapps.service
systemctl enable armada-powerd.service
systemctl enable armada-scx.service
systemctl enable armada-control.service
systemctl enable armada-steamos-manager.service
systemctl --global enable armada-steamos-manager.service
systemctl enable armada-bootimg-sync.service
# Eagerly finalize staged bootc deployments on the Odin (its unclean shutdown
# truncates bootc's ExecStop finalizer, so upgrades never land otherwise). Both
# this .path and armada-bootimg-sync are ConditionPathExists-gated: the Odin
# takes finalize-staged and skips bootimg-sync; SM8550 does the reverse.
systemctl enable armada-finalize-staged.path
# Odin only (self-gated): re-assert the GRUB `devicetree` BLS key that ostree
# drops on `bootc upgrade`, so the kernel's own DTB (787 GPU OPP + panel/gamepad/
# audio) is loaded instead of U-Boot's minimal one.
systemctl enable armada-odin-bls-dtb.service
systemctl enable armada-flatpak-setup.service
systemctl enable armada-waydroid-input.path
# SLPI accelerometer/gyro stack (Odin). hexagonrpcd-sdsp is ConditionPathExists-
# gated on /dev/fastrpc-sdsp, so both are inert on devices without the sensor DSP.
# iio-sensor-proxy is D-Bus activated (net.hadess.SensorProxy), no enable needed.
systemctl enable pd-mapper.service
systemctl enable hexagonrpcd-sdsp.service
# Gyro/accel -> uinput bridge for InputPlumber (Odin; gated on /dev/fastrpc-sdsp).
systemctl enable armada-imu-bridge.service
systemctl disable waydroid-container.service

# Updates are manual (Steam UI / steamos-update). The base image enables this
# timer, which would auto-pull multi-GB images on metered tethering. Opt in with
# `systemctl unmask --now bootc-fetch-apply-updates.timer`.
systemctl mask bootc-fetch-apply-updates.timer

# bootupd targets UEFI bootloaders.
systemctl mask bootloader-update.service

# irqbalance re-spreads IRQs across all cores, overriding Armada's IRQ affinity policy.
systemctl mask irqbalance.service

# Only plain suspend is supported (via the suspend-dispatch drop-in); mask the rest.
systemctl mask systemd-hibernate.service systemd-hybrid-sleep.service systemd-suspend-then-hibernate.service
