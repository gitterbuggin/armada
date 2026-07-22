# SDM845 Odin port — working status / session handoff

Updated 2026-07-22. Context dump for continuing work on any machine.
Companion repos: `armada` + `armada-packages`, branch `sdm845-odin` in both,
mirrored at the private Forgejo (http://forgejo.example.invalid/Contributor/…, private
repos; GitHub origin does NOT have these branches).

## What works on hardware

Boots to Steam with Adreno 630/turnip; clean panel (vendor C2 init + 957 MHz
DSI + labibb + cont-splash carve-out); Wi-Fi + SSH (rmtfs/tqftpserv/modem
chain); Bluetooth; battery gauge; analog sticks (rev2 ADC table + axis
inverts); Nintendo-labeled InputPlumber profile; audio plays (quiet — see
below). Device SSHes as `armada@` on the LAN.

## Kernel patch state (armada-packages/kernel, branch sdm845-odin)

Series 0700–0706 (SDM845 section at the bottom of `patches/series`):
- 0700 gamepad — includes trigger fix (ABS_Z/RZ min=0, was −6000). **Not yet
  verified on device** (module never deployed cleanly).
- 0701 panel (vendor C2 + 957 MHz), 0702 qcom_fg, 0704 ADC5 GPIO channels
  (in the running kernel, sticks verified).
- 0705 NGD 1 s autosuspend — **not in the running image** (module-only).
- 0706 wsa881x DRE gain select (`bb585d2`) — **never successfully tested**;
  see audio saga.

`config/armada-kernel.config.overrides`: wsa881x, wcd934x, NGD, sdm845
machine driver, odin-gamepad are all `=m` — module changes CANNOT be
deployed by the vmlinuz+DTB SD copy; composefs makes /usr immutable.
This burned an entire day of failed override hacks (see below).

## Audio: the full picture

Two symptoms: (a) speakers AND headphones very quiet at max settings;
(b) Steam produces no PipeWire stream at all (untouched lately).

Facts established:
- Android (vendor) runs speakers as COMP7/8 + WSA COMP/BOOST/VISENSE on,
  PA gain G_0_DB static: loudness comes from codec compander driving the
  amp's DRE, plus ACDB DSP calibration mainline doesn't load. Extracted
  from `/vendor/etc/mixer_paths_tavil.xml` over adb (readable, no root).
- Mainline wsa881x forces PA_GAIN_SEL_REG at PA power-up → compander mode
  plays the *compressed* signal at static gain = badly attenuated. Patch
  0706 selects DRE when the COMP port is prepared. Never cleanly tested.
- VISENSE ports must stay OFF (TX feedback ports wedge the playback
  stream; even Android leaves the AIF4_VI capture path off by default).
- The amps FAIL soundwire re-enumeration after runtime suspend behind the
  stale NGD (no 0705): `Initialization not complete, timed out` → runtime
  PM error latches → all opens fail (-22/-110) until reboot. Mitigation
  that works: pin the audio path awake AFTER boot settles
  (`armada-audio-awake.service`, committed as armada `c32ae58`,
  SDM845-gated). Pinning at udev-add time breaks probe; early insmod
  breaks enumeration — timing must be "after boot settles".
- Clue for the residual quietness: boosting RX7/8 digital volume +26 dB
  made STATIC louder but the sine barely — signal into the codec may be
  tiny (bit-alignment / upstream level suspicion, unresolved).
- qdsp6 jenneron-vs-7.0.11 diff was checked: only USB-offload additions,
  no amplitude-relevant deltas.
- alsa-restore stomps experiments: masked on device; delete
  /var/lib/alsa/asound.state when in doubt.
- UCM: Lenovo C630 profile symlinked for card `ayn-AYNOdin` (in repo).

Fallback if DRE doesn't deliver: PipeWire filter-chain sink (compressor +
makeup gain) in the Odin profile — the legitimate replacement for
Android's DSP loudness. PipeWire soft boost >1.0 (`wpctl set-volume 2.0`)
is the quick probe for available headroom.

## On-device /etc state (hacks to clean up after image reflash)

As of the last stabilization block (verify it was run):
- `/etc/armada/modules/` — new `snd-soc-wsa881x.ko` + `odin-gamepad.ko`
  (from kernel build with 0700-0706), `swap-modules.sh`,
  `load-override.sh`. The modprobe-override + early-load approaches were
  ALL abandoned as nondeterministic; `/etc/modprobe.d/armada-module-override.conf`
  and the udev pin rule should have been removed by the stabilization
  block; `armada-module-override.service` disabled.
- `/etc/systemd/system/armada-audio-awake.service` — late pin service
  (enabled). Also exists properly in the repo for the next image.
- alsa-restore.service + alsa-state.service masked.
- Earlier bring-up edits: sshd enabled, NM keyfile, gamescope session
  hot-patch in /etc/gamescope-session-plus/, console/bring-up kargs
  (clk_ignore_unused pd_ignore_unused ignore_loglevel) still on the boot
  partition BLS entry.
All of this is superseded by a clean image flash — do not port it forward.

## The decision: stop SD hacks, do the full CI image build

Module-override roulette wasted many reboots (kernel- vs udev-initiated
loads don't consistently honor modprobe install rules; early insmod broke
soundwire enumeration; live rmmod/insmod wedges the bus). The fix ships in
/usr via a full image rebuild.

CI is set up for this: Forgejo Actions workflows committed on sdm845-odin
in both repos (`.forgejo/workflows/`). The runner uses labels
`ubuntu-24.04-arm:docker://ghcr.io/catthehacker/ubuntu:act-22.04` (config
`privileged: true` — package builds run podman inside) and `host-arm64:host`
(disk build needs loop devices; VM prereqs in build-disk-odin.yml header).
Runner registration token from Site Administration → Actions → Runners.
Add `REPO_TOKEN` (PAT) secret in both repos.

First-run order:
1. armada-packages workflows on sdm845-odin: kernel, tqftpserv, fex, mesa,
   gamescope, mangohud (A75 ARMADA_MARCH is applied automatically on this
   branch by `_package-image.yml`).
2. armada `build.yml` on sdm845-odin → pushes `…/Contributor/armada:odin`
   consuming those carriers.
3. armada `build-disk-odin.yml` (dispatch) → flashable artifact.
These workflows are UNTESTED — expect first-run breakage (action
resolution, artifact API, token scopes) and iterate.

## After the reflash boots (validation checklist)

1. Zero-hand-edit boot to Steam (stock-image validation milestone).
2. Wi-Fi/SSH come up via baked-in units (device profile ayn-odin).
3. Triggers: evtest ABS_Z/ABS_RZ min must be 0 (verifies 0700 fix).
4. Right stick: confirm invert-rx matrix is right (DTB was deployed, user
   confirmation still outstanding).
5. Audio baseline: speaker-test audible (audio-awake unit + 0705 NGD in
   /usr now). NGD flap spam should be gone.
6. DRE loudness verdict: comps-only recipe —
   `COMP7/8 Switch=1`, `SpkrLeft/Right COMP Switch=1` (NO VISENSE), then
   speaker-test; A/B against comps-off + `PA Volume 12`. Louder = 0706
   works, bake recipe into UCM. Not louder = filter-chain route +
   investigate SLIM bit alignment.
7. Headphones: `COMP1/2 Switch=1` (codec-internal DRE).
8. Steam audio stream: check Steam Settings→Audio output device;
   `journalctl --user -b | grep -iE 'steam.*audio|pulse'`.
9. Remove bring-up kargs from the BLS entry; report wrong-C2 finding to
   jenneron/pmOS.

## Build-environment facts

- The user's kernel builds ran on a machine with podman (`just artifacts
  kernel` in armada-packages).
- x86 qemu userspace builds need `ARMADA_BUILD_UNCONFINED=1` + binfmt F
  flag; disk image assembly is impossible on x86 (kernel/podman ABI) —
  arm64 only.
- SD card: device letter wanders (lsblk -f first!). Partitions: p1 vfat
  ARMADA (ESP), p2 ext4 boot (BLS + kernels under ostree/default-*/),
  p3 btrfs root — NOTE the btrfs top level nests everything under
  `root/`: deployment dir is
  `/mnt/root/root/ostree/deploy/default/deploy/<hash>.0/` (double root).
  /etc there is offline-editable; /usr is composefs — offline edits are
  invisible.
- Always verify SD writes: sha256sum card-vs-source before unmounting.

## Credentials / infra

- Forgejo credentials must be configured per machine.
- Both repos: remote `forgejo` = Forgejo, `origin` = GitHub
  (virtudude/…; sdm845-odin branches NOT pushed there).
- Odin over adb (Android slot boots): vendor DT at
  /sys/firmware/devicetree/base readable without root; vendor audio XMLs
  in /vendor/etc/ pullable without root.
