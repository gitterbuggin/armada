#!/bin/bash
set -euxo pipefail

install -d -m 0755 /usr/share/decky-plugins/armada-control
# Copy dist from the image build stage, not the source tree.
src=/ctx/decky/armada-control
cp -a "${src}/plugin.json" "${src}/package.json" "${src}/main.py" /usr/share/decky-plugins/armada-control/
cp -a "${src}/py_modules" /usr/share/decky-plugins/armada-control/
cp -a /packages/decky-dist /usr/share/decky-plugins/armada-control/dist
rm -f /usr/share/decky-plugins/armada-control/dist/*.map
find /usr/share/decky-plugins/armada-control -name __pycache__ -type d -prune -exec rm -rf {} +
chmod 0755 /usr/lib/decky-loader/armada-decky-sync

# Decky Loader is built from a pinned source tag in the decky-loader-build
# Containerfile stage (native arm64 + the arm64-Steam boot-gate patch) and
# bind-mounted at /packages/decky-loader — no network fetches here.
install -d -m 0755 /usr/share/decky-loader
install -pm 0755 /packages/decky-loader/PluginLoader /usr/share/decky-loader/PluginLoader
install -pm 0644 /packages/decky-loader/.loader.version /usr/share/decky-loader/.loader.version
sed 's#${HOMEBREW_FOLDER}#/var/home/armada/homebrew#g' \
    /packages/decky-loader/plugin_loader-prerelease.service \
    > /etc/systemd/system/plugin_loader.service
chmod 0644 /etc/systemd/system/plugin_loader.service

systemctl enable armada-decky-sync.service
systemctl enable plugin_loader.service
