import asyncio
import configparser
import copy
import fcntl
import json
import os
import shutil
import shlex
import struct
import subprocess
import tempfile
import time
from pathlib import Path


POWER_CONFIG = Path("/etc/armada/power-profiles.conf")
FACTORY_POWER_CONFIG = Path("/usr/share/armada/power-profiles.conf")
TWEAKS_CONFIG = Path("/etc/armada/game-tweaks.json")
FEX_PROFILES_CONFIG = Path("/usr/share/armada/fex-profiles.json")
PLUGIN_FEX_PROFILES_CONFIG = Path(__file__).with_name("fex-profiles.json")
STEAM_ROOT = Path("/var/home/armada/.local/share/Steam")
STEAM_APPS_DIR = STEAM_ROOT / "steamapps"
INPUT_CALIBRATION_CONFIG = Path("/etc/armada/input-calibration.json")
RSINPUT_PARAMETERS = Path("/sys/module/rsinput/parameters")
INPUTPLUMBER_INTERCEPT = Path("/usr/libexec/armada/inputplumber-intercept")
INPUTPLUMBER_SERVICE = "org.shadowblip.InputPlumber"
INPUTPLUMBER_COMPOSITE_IFACE = "org.shadowblip.Input.CompositeDevice"
PROFILES = ("quiet", "balanced", "performance")
ABS_CODES = {
    "left_x": 0,
    "left_y": 1,
    "left_trigger": 2,
    "right_x": 3,
    "right_y": 4,
    "right_trigger": 5,
    "gas": 9,
    "brake": 10,
}
CALIBRATION_PARAMS = (
    "axis_leftx_min",
    "axis_leftx_center",
    "axis_leftx_max",
    "axis_leftx_deadzone",
    "axis_leftx_antideadzone",
    "axis_lefty_min",
    "axis_lefty_center",
    "axis_lefty_max",
    "axis_lefty_deadzone",
    "axis_lefty_antideadzone",
    "axis_rightx_min",
    "axis_rightx_center",
    "axis_rightx_max",
    "axis_rightx_deadzone",
    "axis_rightx_antideadzone",
    "axis_righty_min",
    "axis_righty_center",
    "axis_righty_max",
    "axis_righty_deadzone",
    "axis_righty_antideadzone",
    "trigger_left_max",
    "trigger_left_deadzone",
    "trigger_left_antideadzone",
    "trigger_right_max",
    "trigger_right_deadzone",
    "trigger_right_antideadzone",
)
_inputplumber_events_cache = {"time": 0, "events": []}
_calibration_session_token = None


def atomically_write(path, text, mode=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        if mode is not None:
            os.chmod(tmp, mode)
        os.replace(tmp, path)
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


def run_cmd(cmd, timeout=5, capture=True):
    try:
        return subprocess.run(
            cmd,
            check=False,
            text=True,
            stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError):
        return None


def load_fex_contract():
    path = FEX_PROFILES_CONFIG if FEX_PROFILES_CONFIG.exists() else PLUGIN_FEX_PROFILES_CONFIG
    with path.open(encoding="utf-8") as f:
        contract = json.load(f)
    profiles = contract.get("profiles")
    if not isinstance(contract.get("defaults"), dict) or not isinstance(profiles, dict) or "default" not in profiles:
        raise ValueError("invalid FEX profile contract")
    for profile in profiles.values():
        if not isinstance(profile, dict) or not isinstance(profile.get("config"), dict):
            raise ValueError("invalid FEX profile contract")
    return contract


def fex_profile_labels(contract):
    return {
        name: {"label": profile.get("label", name.title())}
        for name, profile in contract["profiles"].items()
        if isinstance(profile, dict)
    }


def restore_factory_power_config(reason):
    if not POWER_CONFIG.exists() or not FACTORY_POWER_CONFIG.exists():
        raise reason
    backup = POWER_CONFIG.with_name(f"{POWER_CONFIG.name}.invalid-{time.strftime('%Y%m%d-%H%M%S')}")
    try:
        shutil.copy2(POWER_CONFIG, backup)
        shutil.copy2(FACTORY_POWER_CONFIG, POWER_CONFIG)
    except OSError:
        raise reason


def parse_power(path=None, repair=True):
    parser = configparser.ConfigParser()
    paths = [path] if path is not None else [FACTORY_POWER_CONFIG, POWER_CONFIG]
    try:
        if not parser.read([candidate for candidate in paths if candidate.exists()]):
            raise FileNotFoundError(path or FACTORY_POWER_CONFIG)
        return parsed_power(parser)
    except (configparser.Error, FileNotFoundError, ValueError) as exc:
        # Narrow, not bare Exception: an IO error or code bug must not trigger the
        # factory-restore and wipe a tuned config on the read path.
        if path is None and repair:
            restore_factory_power_config(exc)
            return parse_power(FACTORY_POWER_CONFIG, repair=False)
        raise


def parsed_power(parser):
    for section in ("general", "fan"):
        if not parser.has_section(section):
            raise ValueError(f"missing config section [{section}]")
    data = {
        "general": {"default_profile": parser.get("general", "default_profile")},
        "profiles": {},
        "fan_curves": {},
        "fan": {},
        "underclocks": {},
    }
    for name in PROFILES:
        section = f"profile.{name}"
        if not parser.has_section(section):
            raise ValueError(f"missing config section [{section}]")
        data["profiles"][name] = {
            "cpu_governor": parser.get(section, "cpu_governor"),
            "cpu_max": parser.get(section, "cpu_max"),
            "cpu_underclock": parser.get(section, "cpu_underclock"),
            "gpu_max": parser.get(section, "gpu_max"),
            "gpu_min": parser.get(section, "gpu_min"),
            "fan_curve": parser.get(section, "fan_curve"),
        }
    for section in parser.sections():
        if section.startswith("fan_curve."):
            name = section.split(".", 1)[1]
            data["fan_curves"][name] = parser.get(section, "curve")
            continue
        if not section.startswith("underclock."):
            continue
        parts = section.split(".")
        if len(parts) == 3:
            _, device_class, level = parts
            data["underclocks"].setdefault(device_class, {})[level] = dict(parser.items(section))
    data["fan"] = dict(parser.items("fan"))
    return data


def render_power(data):
    parser = configparser.ConfigParser()
    parser.optionxform = str
    parser["general"] = {"default_profile": data["general"]["default_profile"]}
    for name in PROFILES:
        profile = data["profiles"][name]
        parser[f"profile.{name}"] = {
            "cpu_governor": str(profile["cpu_governor"]),
            "cpu_max": str(profile["cpu_max"]),
            "cpu_underclock": str(profile["cpu_underclock"]),
            "gpu_max": str(profile["gpu_max"]),
            "gpu_min": str(profile["gpu_min"]),
            "fan_curve": str(profile["fan_curve"]),
        }
    for name in sorted(data.get("fan_curves", {})):
        parser[f"fan_curve.{name}"] = {"curve": str(data["fan_curves"][name])}
    parser["fan"] = {str(k): str(v) for k, v in data["fan"].items()}
    for device_class in sorted(data.get("underclocks", {})):
        levels = data["underclocks"][device_class]
        for level in sorted(levels):
            parser[f"underclock.{device_class}.{level}"] = {
                str(k): str(v) for k, v in levels[level].items()
            }
    with tempfile.TemporaryFile("w+", encoding="utf-8") as f:
        parser.write(f)
        f.seek(0)
        return f.read()


def load_tweaks():
    contract = load_fex_contract()
    profiles = contract["profiles"]
    try:
        with TWEAKS_CONFIG.open(encoding="utf-8") as f:
            loaded = json.load(f)
    except (OSError, ValueError):
        return copy.deepcopy(contract["defaults"])
    data = copy.deepcopy(contract["defaults"])
    if isinstance(loaded, dict):
        if isinstance(loaded.get("global"), dict):
            data["global"].update(loaded["global"])
        if isinstance(loaded.get("games"), dict):
            data["games"] = {
                str(k): v for k, v in loaded["games"].items()
                if str(k).isdigit() and isinstance(v, dict)
            }
    if data["global"].get("fexProfile") not in profiles:
        data["global"]["fexProfile"] = "default"
    for game in data["games"].values():
        if not isinstance(game, dict):
            continue
        game["enabled"] = bool(game.get("enabled", False))
        if game.get("fexProfile") not in profiles:
            game.pop("fexProfile", None)
    return data


def sanitize_tweaks(data):
    # This file is read by the root proton wrapper, so reject non-appid keys and oversized input.
    if not isinstance(data, dict):
        raise ValueError("tweaks must be an object")
    if len(json.dumps(data)) > 256 * 1024:
        raise ValueError("tweaks payload too large")
    clean = {"global": {}, "games": {}}
    if isinstance(data.get("global"), dict):
        clean["global"] = data["global"]
    raw_games = data.get("games")
    if isinstance(raw_games, dict):
        for gid, game in raw_games.items():
            if str(gid).isdigit() and isinstance(game, dict):
                clean["games"][str(gid)] = game
    return clean


def installed_games():
    steamapps_dirs = {STEAM_APPS_DIR}
    for library_file in (STEAM_APPS_DIR / "libraryfolders.vdf", STEAM_ROOT / "config/libraryfolders.vdf"):
        try:
            lines = library_file.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line in lines:
            parts = line.strip().split('"')
            if len(parts) >= 4 and parts[1] == "path":
                steamapps_dirs.add(Path(parts[3]) / "steamapps")
    games = []
    seen = set()
    for steamapps_dir in sorted(steamapps_dirs):
        for manifest in sorted(steamapps_dir.glob("appmanifest_*.acf")):
            values = {}
            try:
                lines = manifest.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                continue
            for line in lines:
                parts = line.strip().split('"')
                if len(parts) >= 4 and parts[1] in ("appid", "name"):
                    values[parts[1]] = parts[3]
            appid = values.get("appid")
            name = values.get("name")
            if appid and name and appid not in seen:
                games.append({"appid": str(appid), "name": name})
                seen.add(appid)
    return sorted(games, key=lambda game: game["name"].casefold())


def factory_power_defaults():
    try:
        return parse_power(FACTORY_POWER_CONFIG)
    except OSError:
        return parse_power()


def cpu_device_class():
    return device_env().get("ARMADA_SOC_CLASS", "")


def device_env():
    helper = os.environ.get("ARMADA_DEVICE_ENV", "/usr/libexec/armada/device-env")
    proc = run_cmd([helper])
    env = {}
    if proc is None:
        return env
    for line in proc.stdout.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            try:
                env[key] = shlex.split(value)[0] if value else ""
            except ValueError:
                env[key] = value
    return env


def ssh_enabled():
    enabled = run_cmd(["systemctl", "is-enabled", "sshd"])
    active = run_cmd(["systemctl", "is-active", "sshd"])
    enabled_s = enabled.stdout.strip() if enabled else ""
    active_s = active.stdout.strip() if active else ""
    return enabled_s == "enabled" or active_s == "active"


def read_text(path):
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return ""


def input_events():
    events = []
    for event in sorted(Path("/sys/class/input").glob("event*")):
        name = read_text(event / "device/name")
        phys = read_text(event / "device/phys")
        dev = Path("/dev/input") / event.name
        if name and dev.exists():
            events.append(input_event_from_path(dev, name=name, phys=phys, source="sysfs"))
    return events


def input_event_from_path(path, name=None, phys=None, source="sysfs"):
    dev = Path(path)
    sysfs = Path("/sys/class/input") / dev.name
    return {
        "event": dev.name,
        "path": str(dev),
        "name": name if name is not None else read_text(sysfs / "device/name"),
        "phys": phys if phys is not None else read_text(sysfs / "device/phys"),
        "source": source,
    }


def busctl_get_property(path, interface, prop):
    try:
        result = subprocess.run(
            ["busctl", "--system", "--json=short", "get-property", INPUTPLUMBER_SERVICE, path, interface, prop],
            check=True,
            capture_output=True,
            text=True,
            timeout=1,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    try:
        payload = json.loads(result.stdout)
    except ValueError:
        return None
    data = payload.get("data")
    if str(payload.get("type", "")).startswith("a"):
        return data if isinstance(data, list) else []
    if isinstance(data, list):
        return data[0] if len(data) == 1 else data
    return data


def begin_calibration_intercept():
    try:
        subprocess.run(
            [str(INPUTPLUMBER_INTERCEPT), "overlay"],
            check=True,
            capture_output=True,
            text=True,
            timeout=1,
        )
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def end_calibration_intercept():
    try:
        subprocess.run(
            [str(INPUTPLUMBER_INTERCEPT), "reset"],
            check=True,
            capture_output=True,
            text=True,
            timeout=1,
        )
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def inputplumber_source_events():
    now = time.monotonic()
    if now - _inputplumber_events_cache["time"] < 2:
        return copy.deepcopy(_inputplumber_events_cache["events"])

    try:
        result = subprocess.run(
            ["busctl", "--system", "--list", "--no-pager", "--no-legend"],
            check=True,
            capture_output=True,
            text=True,
            timeout=1,
        )
    except (OSError, subprocess.SubprocessError):
        _inputplumber_events_cache.update({"time": now, "events": []})
        return []
    if INPUTPLUMBER_SERVICE not in result.stdout:
        _inputplumber_events_cache.update({"time": now, "events": []})
        return []

    try:
        tree = subprocess.run(
            ["busctl", "--system", "tree", INPUTPLUMBER_SERVICE],
            check=True,
            capture_output=True,
            text=True,
            timeout=1,
        )
    except (OSError, subprocess.SubprocessError):
        _inputplumber_events_cache.update({"time": now, "events": []})
        return []

    events = []
    seen = set()
    for line in tree.stdout.splitlines():
        path = line.strip(" │├─└")
        if not path.startswith("/org/shadowblip/InputPlumber/CompositeDevice"):
            continue
        paths = busctl_get_property(path, INPUTPLUMBER_COMPOSITE_IFACE, "SourceDevicePaths")
        if not isinstance(paths, list):
            continue
        for source_path in paths:
            dev = Path(source_path)
            if dev.name in seen or not str(dev).startswith("/dev/input/event") or not dev.exists():
                continue
            event = input_event_from_path(dev, source="inputplumber")
            if event["name"]:
                events.append(event)
                seen.add(dev.name)
    _inputplumber_events_cache.update({"time": now, "events": copy.deepcopy(events)})
    return events


def calibration_event():
    events = inputplumber_source_events()
    if not events:
        events = input_events()
    preferred = (
        lambda event: "rsinput-gamepad" in event["phys"] or "rsinput" in event["name"].casefold(),
        lambda event: "AYANEO Controller" in event["name"],
        lambda event: event["name"] == "Microsoft X-Box 360 pad",
    )
    ignored = ("InputPlumber", "DualSense", "Keyboard", "Touchpad", "Motion Sensors", "Headset")
    for match in preferred:
        for event in events:
            if any(token in event["name"] for token in ignored):
                continue
            if match(event):
                return event
    for event in events:
        if any(token in event["name"] for token in ignored):
            continue
        if "pad" in event["name"].casefold() or "controller" in event["name"].casefold() or "gamepad" in event["name"].casefold():
            return event
    return None


def eviocgabs(code):
    return 0x80184540 + code


def read_abs(fd, code):
    data = fcntl.ioctl(fd, eviocgabs(code), b"\0" * 24)
    if len(data) != 24:
        raise OSError(f"unexpected EVIOCGABS response length for code {code}")
    value, minimum, maximum, fuzz, flat, resolution = struct.unpack("iiiiii", data)
    return {
        "value": value,
        "min": minimum,
        "max": maximum,
        "flat": flat,
        "fuzz": fuzz,
        "resolution": resolution,
    }


def controller_state():
    event = calibration_event()
    if not event:
        return {"supported": False, "reason": "No controller input device found", "controls": {}, "event": None}
    controls = {}
    try:
        with open(event["path"], "rb", buffering=0) as f:
            for name, code in ABS_CODES.items():
                try:
                    controls[name] = read_abs(f.fileno(), code)
                except OSError:
                    pass
    except OSError as exc:
        return {"supported": False, "reason": str(exc), "controls": {}, "event": event}
    if "left_trigger" not in controls and "brake" in controls:
        controls["left_trigger"] = controls["brake"]
    if "right_trigger" not in controls and "gas" in controls:
        controls["right_trigger"] = controls["gas"]
    return {
        "supported": bool(controls),
        "reason": "" if controls else "Controller has no readable analog controls",
        "controls": controls,
        "event": event,
        "canApply": calibration_can_apply(event),
        "backend": "rsinput" if calibration_can_apply(event) else "tester",
    }


def calibration_can_apply(event=None):
    if not RSINPUT_PARAMETERS.exists():
        return False
    if event is None:
        event = calibration_event()
    if not event:
        return False
    return "rsinput-gamepad" in event["phys"] or "rsinput" in event["name"].casefold()


def read_calibration_params():
    params = {}
    if not RSINPUT_PARAMETERS.exists():
        return params
    for name in CALIBRATION_PARAMS:
        text = read_text(RSINPUT_PARAMETERS / name)
        if text:
            try:
                params[name] = int(text)
            except ValueError:
                pass
    return params


def write_calibration_params(params):
    if not calibration_can_apply():
        raise RuntimeError("Controller calibration is not supported on this device")
    for name in CALIBRATION_PARAMS:
        if name in params:
            (RSINPUT_PARAMETERS / name).write_text(str(int(params[name])), encoding="utf-8")
    (RSINPUT_PARAMETERS / "update_params").write_text("1", encoding="utf-8")


def reset_calibration_params():
    params = {}
    for axis in ("axis_leftx", "axis_lefty", "axis_rightx", "axis_righty"):
        params[f"{axis}_min"] = -1024
        params[f"{axis}_center"] = 0
        params[f"{axis}_max"] = 1024
        params[f"{axis}_deadzone"] = 70
        params[f"{axis}_antideadzone"] = 0
    for trigger in ("trigger_left", "trigger_right"):
        params[f"{trigger}_max"] = 1552
        params[f"{trigger}_deadzone"] = 0
        params[f"{trigger}_antideadzone"] = 0
    write_calibration_params(params)
    atomically_write(INPUT_CALIBRATION_CONFIG, json.dumps(params, indent=2, sort_keys=True) + "\n", 0o644)
    run_cmd(["systemctl", "restart", "inputplumber"], timeout=15, capture=False)
    return calibration_status()


def calibration_from_capture(capture, current=None):
    current = current or {}

    def axis_params(prefix, x_key, y_key):
        result = {}
        for suffix, key in (("x", x_key), ("y", y_key)):
            values = capture.get(key) or {}
            minimum = int(values.get("min", 0))
            maximum = int(values.get("max", 0))
            center = int(values.get("center", 0))
            negative = min(minimum - center, -1)
            positive = max(maximum - center, 1)
            inner = max(min(abs(negative), abs(positive)), 1)
            deadzone = max(int(inner * 0.07), 20)
            result[f"{prefix}{suffix}_min"] = -inner
            result[f"{prefix}{suffix}_center"] = int(current.get(f"{prefix}{suffix}_center", 0)) - center
            result[f"{prefix}{suffix}_max"] = inner
            result[f"{prefix}{suffix}_deadzone"] = deadzone
            result[f"{prefix}{suffix}_antideadzone"] = 0
        return result
    params = {}
    params.update(axis_params("axis_left", "left_x", "left_y"))
    params.update(axis_params("axis_right", "right_x", "right_y"))
    for name, key in (("trigger_left", "left_trigger"), ("trigger_right", "right_trigger")):
        values = capture.get(key) or {}
        minimum = int(values.get("min", 0))
        maximum = int(values.get("max", 0))
        span = max(maximum - minimum, 1)
        params[f"{name}_max"] = max(int(current.get(f"{name}_max", 1552)) - minimum, 1)
        params[f"{name}_deadzone"] = max(int(span * 0.03), 4)
        params[f"{name}_antideadzone"] = 0
    return params


def merge_capture_sample(capture, state):
    merged = copy.deepcopy(capture or {})
    for name, control in state.get("controls", {}).items():
        if name not in merged:
            continue
        value = int(control.get("value", 0))
        if name in ("left_trigger", "right_trigger"):
            merged[name]["min"] = value
        else:
            merged[name]["min"] = min(int(merged[name].get("min", value)), value)
        merged[name]["max"] = max(int(merged[name].get("max", value)), value)
    return merged


def calibration_status():
    state = controller_state()
    state["saved"] = INPUT_CALIBRATION_CONFIG.exists()
    state["params"] = read_calibration_params()
    if not state.get("canApply") and RSINPUT_PARAMETERS.exists():
        state["reason"] = "Live tester only on this device"
    return state


def _build_config():
    fex_contract = load_fex_contract()
    return {
        "power": parse_power(),
        "powerDefaults": factory_power_defaults(),
        "tweaks": load_tweaks(),
        "installedGames": installed_games(),
        "fexProfiles": fex_profile_labels(fex_contract),
        "cpuDeviceClass": cpu_device_class(),
        "sshEnabled": ssh_enabled(),
        "calibration": calibration_status(),
    }


def _save_power_config(data):
    if not isinstance(data, dict) or data.get("general", {}).get("default_profile") not in PROFILES:
        raise ValueError("invalid power config")
    try:
        rendered = render_power(data)
    except (KeyError, TypeError) as exc:
        raise ValueError(f"malformed power config: {exc}")
    atomically_write(POWER_CONFIG, rendered)
    run_cmd(["/usr/bin/armada-power", "reload"], timeout=15, capture=False)


def _save_tweaks(data):
    atomically_write(TWEAKS_CONFIG, json.dumps(sanitize_tweaks(data), indent=2, sort_keys=True) + "\n", 0o644)


def _set_ssh_enabled(enabled):
    command = ["systemctl", "enable", "--now", "sshd"] if enabled else ["systemctl", "disable", "--now", "sshd"]
    run_cmd(command, timeout=30, capture=False)
    return ssh_enabled()


def _save_calibration(capture):
    capture = merge_capture_sample(capture, controller_state())
    params = calibration_from_capture(capture, read_calibration_params())
    write_calibration_params(params)
    atomically_write(INPUT_CALIBRATION_CONFIG, json.dumps(params, indent=2, sort_keys=True) + "\n", 0o644)
    run_cmd(["systemctl", "restart", "inputplumber"], timeout=15, capture=False)


class Plugin:
    # Offload blocking work to a thread so a slow call can't stall Decky's asyncio loop.
    async def get_config(self):
        return await asyncio.to_thread(_build_config)

    async def save_power_config(self, data):
        await asyncio.to_thread(_save_power_config, data)
        return await self.get_config()

    async def save_tweaks(self, data):
        await asyncio.to_thread(_save_tweaks, data)
        return await self.get_config()

    async def set_ssh_enabled(self, enabled):
        return await asyncio.to_thread(_set_ssh_enabled, enabled)

    async def get_controller_state(self):
        return await asyncio.to_thread(controller_state)

    async def get_calibration_status(self):
        return await asyncio.to_thread(calibration_status)

    async def save_calibration(self, capture):
        await asyncio.to_thread(_save_calibration, capture)
        await asyncio.sleep(0.5)
        await asyncio.to_thread(begin_calibration_intercept)
        return await asyncio.to_thread(calibration_status)

    async def reset_calibration(self):
        await asyncio.to_thread(reset_calibration_params)
        await asyncio.sleep(0.5)
        await asyncio.to_thread(begin_calibration_intercept)
        return await asyncio.to_thread(calibration_status)

    async def begin_calibration_session(self, token=None):
        global _calibration_session_token
        _calibration_session_token = str(token or "default")
        return await asyncio.to_thread(begin_calibration_intercept)

    async def end_calibration_session(self, token=None):
        global _calibration_session_token
        if _calibration_session_token != str(token or "default"):
            return False
        _calibration_session_token = None
        return await asyncio.to_thread(end_calibration_intercept)
