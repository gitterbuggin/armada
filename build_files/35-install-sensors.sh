#!/usr/bin/bash
# Snapdragon Sensor Core (SLPI) accelerometer/gyro stack for the AYN Odin.
#
# The Odin's IMU is behind the SLPI sensor DSP (no AP-side IIO chip). Userspace
# bridges it: slpi_pas boots slpi.mbn (already staged) -> pd-mapper brings the
# protection domains up -> hexagonrpcd serves the DSP its sensor registry over
# FastRPC (/dev/fastrpc-sdsp) -> libssc reads accel/gyro over SSC/QMI/QRTR ->
# iio-sensor-proxy (SSC-enabled fork) exposes them on D-Bus net.hadess.SensorProxy.
# Packages come from copr @mobility/sdm845 (the Fedora sdm845 mobile stack).
#
# This runs only for the sdm845-odin branch image, so it doesn't touch the
# SM8550 :testing image (which keeps stock iio-sensor-proxy).
set -euxo pipefail

# --- 1. runtime sensor firmware (registry + per-sensor config the DSP requests) ---
# Boot fw (slpi.mbn/.jsn) already ships in system_files under /usr/lib/firmware.
# This adds the sensor tree under /usr/share/qcom that hexagonrpcd serves.
# jenneron installs it at .../AYN/odin (lowercase) while the stock hexagonrpcd
# conf points at .../AYN/Odin (capital) — bridge with a case symlink so either
# path resolves (Linux paths are case-sensitive).
FW_TAR="https://gitlab.com/jenneron/firmware-ayn-odin/-/archive/master/firmware-ayn-odin-master.tar.gz"
tmp="$(mktemp -d)"
curl --retry 3 --retry-delay 2 -fsSL -o "${tmp}/fw.tar.gz" "${FW_TAR}"
tar -xzf "${tmp}/fw.tar.gz" -C "${tmp}" --strip-components=1
# Only the sensor tree (usr/); the boot .mbn/.jsn already ship in system_files.
cp -a "${tmp}/usr/." /usr/
rm -rf "${tmp}"
if [ -d /usr/share/qcom/sdm845/AYN/odin ] && [ ! -e /usr/share/qcom/sdm845/AYN/Odin ]; then
    ln -sfn odin /usr/share/qcom/sdm845/AYN/Odin
fi
test -f /usr/share/qcom/sdm845/AYN/odin/sensors/sns_reg.conf \
    || echo "WARNING: sns_reg.conf missing — sensor firmware layout changed" >&2

# --- 2. sensor stack from copr @mobility/sdm845 (verified fedora-44 aarch64) ---
cat > /etc/yum.repos.d/_copr_mobility-sdm845.repo <<'REPO'
[copr:copr.fedorainfracloud.org:group_mobility:sdm845]
name=Copr repo for sdm845 owned by @mobility
baseurl=https://download.copr.fedorainfracloud.org/results/@mobility/sdm845/fedora-$releasever-$basearch/
type=rpm-md
skip_if_unavailable=False
gpgcheck=1
gpgkey=https://download.copr.fedorainfracloud.org/results/@mobility/sdm845/pubkey.gpg
repo_gpgcheck=0
enabled=1
REPO

# hexagonrpc (hexagonrpcd), pd-mapper, libssc, and the SSC-enabled iio-sensor-proxy
# (replaces stock iio-sensor-proxy, which only reads kernel IIO — none here).
dnf5 -y install --setopt=install_weak_deps=False --allowerasing \
    hexagonrpc pd-mapper libssc iio-sensor-proxy

# Don't leave the copr enabled in the shipped image.
rm -f /etc/yum.repos.d/_copr_mobility-sdm845.repo

echo "Installed SLPI sensor stack: hexagonrpc + pd-mapper + libssc + iio-sensor-proxy(ssc)"
