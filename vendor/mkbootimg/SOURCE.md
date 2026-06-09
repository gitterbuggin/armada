# mkbootimg (vendored from AOSP)

Upstream: https://android.googlesource.com/platform/system/tools/mkbootimg
Commit: d2bb0af5ba6d3198a3e99529c97eda1be0b5a093
License: Apache-2.0 (see header in mkbootimg.py)

Used at build time by `post_process/make-bootimg.sh` and on-device by
`armada-bootimg-update` to assemble the ABL boot.img. Only the minimal import
closure is vendored: `mkbootimg.py` plus `gki/generate_gki_certificate.py`
(unconditionally imported; it shells out to avbtool only for GKI signing, which
the header-v0 path never does, so avbtool is not needed).

To refresh: re-copy `mkbootimg.py` and `gki/generate_gki_certificate.py` from
the pinned commit above.
