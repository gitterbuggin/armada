#!/bin/bash
# Shutdown black-box recorder for unclean-shutdown diagnosis.
#
# Runs inside systemd-shutdown, after the unmount sweep and immediately
# before the final reboot()/poweroff() syscall — the last moment code runs.
# On this device (AYN Odin) the journal never survives shutdown (writes
# after the last btrfs commit are lost), so this writes the final-phase
# state to the ABL FAT partition, which is written raw and survives.
#
# $1 is the shutdown verb: halt|poweroff|reboot|kexec
{
  echo "=== armada-blackbox: mode=$1 uptime=$(cat /proc/uptime 2>/dev/null) ==="
  echo "--- /proc/mounts (anything rw here failed to unmount) ---"
  cat /proc/mounts
  echo "--- dmesg tail ---"
  dmesg | tail -80
} > /run/blackbox.txt 2>&1

mkdir -p /run/esp
if mount -t vfat /dev/mmcblk0p1 /run/esp 2>>/run/blackbox.txt; then
  cp /run/blackbox.txt /run/esp/shutdown-blackbox.txt
  sync
  umount /run/esp
fi
