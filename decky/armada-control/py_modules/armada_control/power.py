import configparser
import shutil
import tempfile
import time
from pathlib import Path

from .system import atomically_write, run_cmd

POWER_CONFIG = Path("/etc/armada/power-profiles.conf")
FACTORY_POWER_CONFIG = Path("/usr/share/armada/power-profiles.conf")
PROFILES = ("efficiency", "balanced", "performance")


def default_label(name):
    return name.replace("_", " ").title()


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
        # Avoid factory-restore on IO errors or code bugs in the read path.
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
            "label": parser.get(section, "label", fallback="") or default_label(name),
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
            data["fan_curves"][name] = {
                "label": parser.get(section, "label", fallback="") or default_label(name),
                "curve": parser.get(section, "curve"),
            }
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
            "label": str(profile.get("label") or default_label(name)),
            "cpu_governor": str(profile["cpu_governor"]),
            "cpu_max": str(profile["cpu_max"]),
            "cpu_underclock": str(profile["cpu_underclock"]),
            "gpu_max": str(profile["gpu_max"]),
            "gpu_min": str(profile["gpu_min"]),
            "fan_curve": str(profile["fan_curve"]),
        }
    for name in sorted(data.get("fan_curves", {})):
        fan_curve = data["fan_curves"][name]
        if isinstance(fan_curve, dict):
            parser[f"fan_curve.{name}"] = {
                "label": str(fan_curve.get("label") or default_label(name)),
                "curve": str(fan_curve.get("curve", "")),
            }
        else:
            parser[f"fan_curve.{name}"] = {"curve": str(fan_curve)}
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


def factory_power_defaults():
    try:
        return parse_power(FACTORY_POWER_CONFIG)
    except OSError:
        return parse_power()


def save_power_config(data):
    if not isinstance(data, dict) or data.get("general", {}).get("default_profile") not in PROFILES:
        raise ValueError("invalid power config")
    try:
        rendered = render_power(data)
    except (KeyError, TypeError) as exc:
        raise ValueError(f"malformed power config: {exc}")
    atomically_write(POWER_CONFIG, rendered)
    run_cmd(["/usr/bin/armada-power", "reload"], timeout=15, capture=False)
