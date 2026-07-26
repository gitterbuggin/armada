#!/bin/bash
set -euxo pipefail

KVER="7.0.11"
TARBALL="/packages/kernel/armada-kernel-${KVER}.tar.zst"

# bootc expects exactly one kernel under /usr/lib/modules.
dnf5 -y remove kernel kernel-core kernel-modules kernel-modules-core 2>/dev/null || true
rm -rf /usr/lib/modules/*

# Verify the shipped checksum.
[ -f "${TARBALL}" ] || { echo "ERROR: kernel tarball missing at ${TARBALL}"; exit 1; }
( cd /packages/kernel && sha256sum -c "armada-kernel-${KVER}.tar.zst.sha256" )

tar --extract --zstd -f "${TARBALL}" -C /usr/
depmod -a "${KVER}" -b /

# dracut MODULE_FIRMWARE introspection needs firmware at the build-time path.
mkdir -p /usr/lib/firmware
cp -a /ctx/system_files/usr/lib/firmware/. /usr/lib/firmware/

# Plymouth theme must exist before dracut bakes the splash into initramfs.
mkdir -p /usr/share/plymouth/themes
cp -a /ctx/system_files/usr/share/plymouth/themes/armada /usr/share/plymouth/themes/

plymouth-set-default-theme armada

# The Adreno a630 GPU firmware is request_firmware'd by a dynamically-built
# name, not declared via MODULE_FIRMWARE(), so dracut's introspection misses it
# and it's absent from the initramfs. The msm DRM binds display + GPU together,
# so card1 (the DSI panel) can't come up until this firmware loads ~14s in from
# the real rootfs — racing SDDM/gamescope (the "flaky boot" / console-cursor).
# Force it into the initramfs so the display is up immediately. (sddm's
# Restart=on-failure is the backstop if this ever regresses.)
GPU_FW=""
for f in /usr/lib/firmware/qcom/a630_sqe.fw /usr/lib/firmware/qcom/a630_gmu.bin; do
    [ -f "${f}" ] && GPU_FW="${GPU_FW} ${f}"
done
[ -n "${GPU_FW}" ] || echo "WARNING: a630 GPU firmware not found under /usr/lib/firmware/qcom; initramfs will race the late firmware load"

dracut \
    --force \
    --no-hostonly \
    --reproducible \
    --kver "${KVER}" \
    --add ostree \
    --add plymouth \
    ${GPU_FW:+--install "${GPU_FW}"} \
    "/usr/lib/modules/${KVER}/initramfs.img" "${KVER}"

echo "armada kernel ${KVER} installed at /usr/lib/modules/${KVER}/"
ls -la "/usr/lib/modules/${KVER}/" | head -10
