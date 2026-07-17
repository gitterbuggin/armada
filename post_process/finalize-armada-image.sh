#!/bin/bash
# Post-BIB: stage boot files and compress.
#
# Default variant stages the ROCKNIX ABL folders and disables EFI (SM8550/
# SM8650/SM8750 devices boot /KERNEL via the ROCKNIX ABL). ARMADA_VARIANT=odin
# instead keeps EFI (the SDM845 Odin boots via U-Boot's UEFI from the Android
# boot slot) and stages a U-Boot flash kit + kernel DTBs on the ESP.

set -euxo pipefail

RAW_IMAGE="${1:-output/raw/disk.raw}"
ARMADA_VARIANT="${ARMADA_VARIANT:-}"
ROCKNIX_ABL_VERSION="${ROCKNIX_ABL_VERSION:-v1.1.5}"
if [[ "${ARMADA_VARIANT}" == odin ]]; then
    OUT="${OUT:-output/armada-odin-$(TZ='America/New_York' date +%Y%m%d).img.gz}"
    # uboot-odin package output (armada-packages), built by `just artifacts uboot-odin`.
    UBOOT_DIR="${UBOOT_DIR:-${HOME}/Git/armada-packages/uboot-odin/out}"
else
    OUT="${OUT:-output/armada-$(TZ='America/New_York' date +%Y%m%d).img.gz}"
fi
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

if [[ ! -f "${RAW_IMAGE}" ]]; then
    echo "ERROR: raw image not found at ${RAW_IMAGE}"
    echo "Run 'just build-raw' first."
    exit 1
fi

WORK=$(mktemp -d)
trap "sudo umount '${WORK}/p2mnt' 2>/dev/null || true; sudo umount '${WORK}/mnt' 2>/dev/null || true; sudo losetup -d \"\$(cat ${WORK}/loop 2>/dev/null)\" 2>/dev/null || true; rm -rf '${WORK}'" EXIT

if [[ "${ARMADA_VARIANT}" == odin ]]; then
    for f in uboot-ayn-odin.img uboot-ayn-odin-m2.img; do
        [[ -f "${UBOOT_DIR}/${f}" ]] || { echo "ERROR: ${UBOOT_DIR}/${f} missing. Build it with 'just artifacts uboot-odin' in armada-packages, or set UBOOT_DIR."; exit 1; }
    done
else
    curl -fsSL -o "${WORK}/abl.tar.gz" \
        "https://github.com/ROCKNIX/abl/releases/download/${ROCKNIX_ABL_VERSION}/rocknix-abl-${ROCKNIX_ABL_VERSION}.tar.gz"
    mkdir -p "${WORK}/abl-extracted"
    tar -xzf "${WORK}/abl.tar.gz" -C "${WORK}/abl-extracted"
fi

LOOP=$(sudo losetup -fP --show "${RAW_IMAGE}")
echo "${LOOP}" > "${WORK}/loop"
sleep 1

ESP="${LOOP}p1"
if ! sudo blkid "${ESP}" | grep -q 'TYPE="vfat"'; then
    echo "ERROR: ${ESP} is not vfat. BIB partition layout may have changed."
    sudo blkid "${LOOP}"*
    exit 1
fi

mkdir -p "${WORK}/mnt"
sudo mount "${ESP}" "${WORK}/mnt"

if [[ "${ARMADA_VARIANT}" == odin ]]; then
    # U-Boot flash kit: flashed once to the inactive Android boot slot from a
    # PC over fastboot (see odin/README). Kept on the ESP so the files travel
    # with the SD card.
    sudo mkdir -p "${WORK}/mnt/odin_uboot"
    sudo cp "${UBOOT_DIR}/uboot-ayn-odin.img" "${UBOOT_DIR}/uboot-ayn-odin-m2.img" "${WORK}/mnt/odin_uboot/"
    [[ -f "${UBOOT_DIR}/SHA256SUMS" ]] && sudo cp "${UBOOT_DIR}/SHA256SUMS" "${WORK}/mnt/odin_uboot/"
    sudo cp "${REPO_ROOT}/odin/README" "${WORK}/mnt/odin_uboot/README"

    # Stage the kernel's Odin DTBs on the ESP: U-Boot boots with its own
    # built-in DTB, but these stay in lockstep with the shipped kernel for a
    # GRUB `devicetree` override if the U-Boot copy drifts.
    sudo mkdir -p "${WORK}/p2mnt"
    sudo mount "${LOOP}p2" "${WORK}/p2mnt"
    DEPLOY=$(sudo ls "${WORK}/p2mnt/ostree" | grep '^default-' | head -1)
    for dtb in sdm845-ayn-odin.dtb sdm845-ayn-odin-m2.dtb; do
        src="${WORK}/p2mnt/ostree/${DEPLOY}/dtb/qcom/${dtb}"
        sudo test -f "${src}" || { echo "ERROR: ${dtb} missing from kernel package — rebuild armada-packages/kernel with SDM845 support"; sudo umount "${WORK}/p2mnt"; exit 1; }
        sudo mkdir -p "${WORK}/mnt/dtb/qcom"
        sudo cp "${src}" "${WORK}/mnt/dtb/qcom/"
    done
    sudo umount "${WORK}/p2mnt"
    # EFI stays enabled: U-Boot's UEFI loads GRUB from this ESP.
else
    sudo mkdir -p "${WORK}/mnt/rocknix_abl"
    # One image serves all devices, so stage a self-contained folder per SoC.
    # vfat has no Unix ownership, so `cp -a` would error on chown under set -e.
    ABL_SRC=$(ls -d "${WORK}/abl-extracted"/rocknix-abl-*)
    sudo cp "${REPO_ROOT}/abl/README" "${WORK}/mnt/rocknix_abl/README"
    for soc in SM8550 SM8650 SM8750; do
        d="${WORK}/mnt/rocknix_abl/${soc}"
        sudo mkdir -p "$d"
        sudo cp "${ABL_SRC}/abl_signed-${soc}.elf" "${ABL_SRC}/abl_signed-${soc}.elf.sha256" "$d/"
        for s in flash_abl backup_abl restore_backup_abl; do
            sed "s/%DEVICE%/${soc}/g" "${REPO_ROOT}/abl/${s}.sh.template" \
                | sudo tee "$d/${s}.sh" >/dev/null
        done
        sudo chmod 0755 "$d"/*.sh
    done

    # Disable GRUB so ABL falls through to /KERNEL.
    if [ -d "${WORK}/mnt/EFI" ]; then sudo mv "${WORK}/mnt/EFI" "${WORK}/mnt/EFI.disabled"; fi
fi
sudo sync
sudo umount "${WORK}/mnt"

# Android shows this label when copying the ABL
sudo fatlabel "${ESP}" ARMADA

# MBR, not GPT: a fixed-size GPT image flashed to a larger card strands the backup
# GPT mid-disk and Android's vold rejects the card. MBR has no end-of-disk
# structure, so it reads on any card. SD image only; internal installs stay GPT.
TABLE=$(sudo sfdisk -J "${LOOP}")
mapfile -t PARTS < <(jq -r '.partitiontable.partitions[] | "\(.start) \(.size)"' <<<"${TABLE}")
[ "${#PARTS[@]}" -eq 3 ] || { echo "ERROR: expected 3 partitions, got ${#PARTS[@]}"; sudo sfdisk -l "${LOOP}"; exit 1; }
read -r P1_START P1_SIZE <<<"${PARTS[0]}"
read -r P2_START P2_SIZE <<<"${PARTS[1]}"
read -r P3_START P3_SIZE <<<"${PARTS[2]}"
SECTORS=$(sudo blockdev --getsz "${LOOP}")

# Zero the two GPT copies (primary LBA 1-33, backup last 33 LBAs); dd avoids a
# gdisk dependency. The guards refuse any layout where a zero could hit a partition.
[ "$(jq -r '.partitiontable.sectorsize // 512' <<<"${TABLE}")" = 512 ] \
    || { echo "ERROR: non-512-byte sectors; GPT-zero math assumes 512"; exit 1; }
[ "${P1_START}" -ge 34 ] || { echo "ERROR: p1 starts inside the primary-GPT span"; exit 1; }
[ "$((P3_START + P3_SIZE))" -le "$((SECTORS - 33))" ] || { echo "ERROR: p3 overlaps the backup-GPT span"; exit 1; }
sudo dd if=/dev/zero of="${LOOP}" bs=512 seek=1 count=33 conv=notrunc status=none
sudo dd if=/dev/zero of="${LOOP}" bs=512 seek=$((SECTORS - 33)) count=33 conv=notrunc status=none

sudo sfdisk --label dos "${LOOP}" <<EOF
${P1_START},${P1_SIZE},c,*
${P2_START},${P2_SIZE},da
${P3_START},${P3_SIZE},da
EOF

sudo sfdisk -J "${LOOP}" \
    | jq -e '.partitiontable.label=="dos" and (.partitiontable.partitions|length)==3' >/dev/null \
    || { echo "ERROR: MBR conversion verify failed"; sudo sfdisk -l "${LOOP}"; exit 1; }

sudo losetup -d "${LOOP}"
rm "${WORK}/loop"

GZIP_LEVEL="${GZIP_LEVEL:-6}"
mkdir -p "$(dirname "${OUT}")"
pigz -f "-${GZIP_LEVEL}" -p "$(nproc)" -c "${RAW_IMAGE}" > "${OUT}"
rm -f "${RAW_IMAGE}"

echo "Built: ${OUT}"
echo "Flash to SD with:  zcat ${OUT} | sudo dd of=/dev/sdX bs=4M conv=fsync status=progress"
