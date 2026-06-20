const manifest = {"name":"Armada Control"};
const API_VERSION = 2;
const internalAPIConnection = window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit;
if (!internalAPIConnection) {
    throw new Error('[@decky/api]: Failed to connect to the loader as as the loader API was not initialized. This is likely a bug in Decky Loader.');
}
let api;
try {
    api = internalAPIConnection.connect(API_VERSION, manifest.name);
}
catch {
    api = internalAPIConnection.connect(1, manifest.name);
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version 1. Some features may not work.`);
}
if (api._version != API_VERSION) {
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version ${api._version}. Some features may not work.`);
}
const call = api.call;
const executeInTab = api.executeInTab;
const definePlugin = (fn) => {
    return (...args) => {
        return fn(...args);
    };
};

const getConfig = () => call("get_config");
const savePowerConfig = (data) => call("save_power_config", data);
const saveTweaks = (data) => call("save_tweaks", data);
const setSshEnabled = (enabled) => call("set_ssh_enabled", enabled);
const setGlobalResolution = (value) => call("set_global_resolution", value);
const getControllerState = () => call("get_controller_state");
const saveCalibration = (capture) => call("save_calibration", capture);
const resetCalibration = () => call("reset_calibration");
const beginCalibrationSession = (token) => call("begin_calibration_session", token);
const endCalibrationSession = (token) => call("end_calibration_session", token);

function useDebouncedSave(options) {
    const { config, field, snapshot, save, setConfig, onError, delay = 900 } = options;
    const value = config ? config[field] : undefined;
    SP_REACT.useEffect(() => {
        if (!config || !snapshot.current)
            return;
        const current = JSON.stringify(value);
        if (current === snapshot.current)
            return;
        const timer = window.setTimeout(async () => {
            try {
                const saved = current;
                const next = await save(value);
                snapshot.current = JSON.stringify(next[field]);
                setConfig((stored) => {
                    if (!stored)
                        return next;
                    if (JSON.stringify(stored[field]) !== saved)
                        return stored;
                    return { ...stored, [field]: next[field] };
                });
            }
            catch (error) {
                onError?.(error);
            }
        }, delay);
        return () => window.clearTimeout(timer);
    }, [value]);
}

function Icon({ path }) {
    return (SP_JSX.jsx("svg", { style: { display: "block" }, width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: path }));
}
const tabIcons = {
    Compatibility: (SP_JSX.jsx(Icon, { path: SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx("line", { x1: "6", x2: "10", y1: "11", y2: "11" }), SP_JSX.jsx("line", { x1: "8", x2: "8", y1: "9", y2: "13" }), SP_JSX.jsx("line", { x1: "15", x2: "15.01", y1: "12", y2: "12" }), SP_JSX.jsx("line", { x1: "18", x2: "18.01", y1: "10", y2: "10" }), SP_JSX.jsx("path", { d: "M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" })] }) })),
    Power: (SP_JSX.jsx(Icon, { path: SP_JSX.jsx(SP_JSX.Fragment, { children: SP_JSX.jsx("path", { d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" }) }) })),
    Advanced: (SP_JSX.jsx(Icon, { path: SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx("path", { d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" }), SP_JSX.jsx("circle", { cx: "12", cy: "12", r: "3" })] }) })),
};

function gameDisplayName(game) {
    if (!game?.appid)
        return "";
    return game.name || `App ${game.appid}`;
}
function availableGames(config) {
    const games = new Map();
    for (const game of config.installedGames || []) {
        if (game?.appid)
            games.set(String(game.appid), { appid: String(game.appid), name: game.name || `App ${game.appid}` });
    }
    for (const [appid, game] of Object.entries(config.tweaks?.games || {})) {
        if (game && typeof game === "object")
            games.set(String(appid), { appid: String(appid), name: game.name || games.get(String(appid))?.name || `App ${appid}` });
    }
    return Array.from(games.values()).sort((a, b) => gameDisplayName(a).localeCompare(gameDisplayName(b)));
}
function editTargetOptions(config) {
    return [
        { data: "", label: "Default" },
        ...availableGames(config).map((game) => ({ data: game.appid, label: gameDisplayName(game) })),
    ];
}
function currentGame() {
    const running = DFL.Router?.MainRunningApp || window.Router?.MainRunningApp;
    const appid = running?.appid;
    if (!appid)
        return null;
    const id = String(appid);
    let name = running?.display_name || running?.displayName || "";
    try {
        const details = window.appDetailsStore?.GetAppDetails?.(Number(id));
        name = details?.strDisplayName || details?.strName || details?.name || name;
    }
    catch (error) {
    }
    return { appid: id, name: name || `App ${id}` };
}

// Steam's QAM profile dropdown over-expands on armada; Decky has no stable hook for that row.
function installQamFix(styleId, attr, profileIds) {
    const css = `
    [data-armada-qam-profile-fix] { min-width: 0 !important; }
    [data-armada-qam-profile-fix="value"] {
      flex: 0 0 154px !important;
      width: 154px !important;
      min-width: 154px !important;
      max-width: 154px !important;
      overflow: hidden !important;
    }
    [data-armada-qam-profile-fix="value"] > *,
    [data-armada-qam-profile-fix="value"] [role="combobox"],
    [data-armada-qam-profile-fix="value"] .DialogDropDown,
    [data-armada-qam-profile-fix="value"] .DialogButton {
      width: 100% !important;
      min-width: 0 !important;
      max-width: 100% !important;
    }
    [data-armada-qam-profile-fix="value"] button,
    [data-armada-qam-profile-fix="value"] .DialogButton {
      width: 100% !important;
    }
    [data-armada-qam-profile-fix="value"] .DialogDropDown_CurrentDisplay {
      max-width: 100% !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      text-transform: capitalize !important;
      font-size: 16px !important;
    }
    [data-armada-qam-profile-fix="menu"] [role="option"],
    [data-armada-qam-profile-fix="menu"] .contextMenuItem {
      text-transform: capitalize !important;
    }
  `;
    function installStyle() {
        let style = document.getElementById(styleId);
        if (!style) {
            style = document.createElement("style");
            style.id = styleId;
            document.head.appendChild(style);
        }
        style.textContent = css;
    }
    function tagRows() {
        const rows = document.querySelectorAll(".Panel.Focusable, .quickaccesscontrols_Panel_3aLED");
        for (const row of rows) {
            const labels = Array.from(row.querySelectorAll("div, span")).filter((node) => node.textContent?.trim() === "Performance Profile");
            if (!labels.length)
                continue;
            row.setAttribute(attr, "row");
            const combo = row.querySelector('[role="combobox"], .DialogDropDown');
            let value = combo;
            for (let i = 0; i < 3 && value?.parentElement && value.parentElement !== row; i += 1) {
                value = value.parentElement;
            }
            if (value)
                value.setAttribute(attr, "value");
        }
        for (const listbox of document.querySelectorAll('[role="listbox"]')) {
            const options = Array.from(listbox.querySelectorAll('[role="option"]'));
            const texts = new Set(options.map((node) => node.textContent?.trim()).filter(Boolean));
            if (profileIds.length && profileIds.every((profile) => texts.has(profile))) {
                listbox.setAttribute(attr, "menu");
            }
        }
    }
    installStyle();
    tagRows();
    window.__armadaQamProfileFixObserver?.disconnect?.();
    window.__armadaQamProfileFixObserver = new MutationObserver(tagRows);
    window.__armadaQamProfileFixObserver.observe(document.body, { childList: true, subtree: true });
}
function installQamProfileFix(profileIds) {
    const qamScript = `(${installQamFix.toString()})("armada-qam-profile-fix-style", "data-armada-qam-profile-fix", ${JSON.stringify(profileIds)})`;
    executeInTab("QuickAccess_uid2", false, qamScript).catch(() => { });
    executeInTab("Steam Big Picture Mode", false, qamScript).catch(() => { });
}
function cleanupQamFix() {
    const script = `
    window.__armadaQamProfileFixObserver?.disconnect?.();
    delete window.__armadaQamProfileFixObserver;
    document.getElementById("armada-qam-profile-fix-style")?.remove();
    document.querySelectorAll("[data-armada-qam-profile-fix]").forEach((node) => node.removeAttribute("data-armada-qam-profile-fix"));
  `;
    executeInTab("QuickAccess_uid2", false, script).catch(() => { });
    executeInTab("Steam Big Picture Mode", false, script).catch(() => { });
}

const styles = `
      .armada-control-tabs {
        height: 95%;
        width: 316px;
        position: fixed;
        margin-top: -12px;
        margin-left: -8px;
        overflow: hidden;
      }
      .armada-control-tabs > div > div:first-child::before {
        background: #0D141C;
        box-shadow: none;
        backdrop-filter: none;
      }
      .armada-control-tabs [role="tabpanel"] {
        padding-left: 0 !important;
        padding-right: 0 !important;
      }
      .armada-control-tabs .armada-control-tab-content {
        padding-bottom: 24px;
      }
      .armada-control-tabs .armada-slider-field {
        width: 100%;
        max-width: none;
        overflow: hidden;
      }
      .armada-control-tabs .armada-slider-field * {
        min-width: 0 !important;
        max-width: 100% !important;
      }
      .armada-control-tabs .armada-reset-row {
        padding: 0 14px 8px;
      }
      .armada-control-tabs .armada-compat-note {
        box-sizing: border-box;
        width: 100%;
        padding: 8px 16px 8px;
        font-size: 12px;
        line-height: 16px;
        opacity: 0.62;
        text-align: left;
        justify-content: flex-start;
        align-self: stretch;
      }
    `;

function SelectEdit({ label, value, options, onChange }) {
    const rgOptions = options.map((option) => (typeof option === "string" ? { data: option, label: option } : option));
    return (SP_JSX.jsx(DFL.PanelSectionRow, { children: label === undefined ? (SP_JSX.jsx(DFL.Dropdown, { selectedOption: value, rgOptions: rgOptions, onChange: (option) => onChange(option.data) })) : (SP_JSX.jsx(DFL.DropdownItem, { label: label, selectedOption: value, rgOptions: rgOptions, onChange: (option) => onChange(option.data) })) }));
}
function ToggleRow({ label, value, onChange, disabled, description }) {
    return (SP_JSX.jsx(DFL.PanelSection, { children: SP_JSX.jsx(DFL.ToggleField, { label: label, description: description, checked: !!value, disabled: disabled, onChange: onChange }) }));
}
function SliderEdit({ label, value, min, max, step, onChange, format }) {
    const numeric = Number(value);
    return (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { className: "armada-slider-field", children: SP_JSX.jsx(DFL.SliderField, { label: label, value: Number.isFinite(numeric) ? numeric : min, min: min, max: max, step: step, showValue: true, onChange: (next) => onChange(format ? format(next) : next) }) }) }));
}

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
}
function update(obj, path, value) {
    const next = clone(obj);
    let cursor = next;
    for (let i = 0; i < path.length - 1; i += 1)
        cursor = cursor[path[i]];
    cursor[path[path.length - 1]] = value;
    return next;
}
function titleCase(value) {
    const text = String(value || "");
    return text.charAt(0).toUpperCase() + text.slice(1);
}

const resolutionOptions = [
    { data: "Default", label: "Default" },
    { data: "Native", label: "Native" },
    { data: "1280x720", label: "1280x720" },
    { data: "960x540", label: "960x540" },
];
const fexKnobs = [
    { key: "TSOEnabled", label: "TSO Enabled" },
    { key: "X87ReducedPrecision", label: "X87 Reduced Precision" },
    { key: "Multiblock", label: "Multiblock" },
    { key: "VectorTSOEnabled", label: "Vector TSO Enabled" },
    { key: "MemcpySetTSOEnabled", label: "Memcpy Set TSO Enabled" },
    { key: "HalfBarrierTSOEnabled", label: "Half Barrier TSO Enabled" },
];
const thunkModules = [
    { module: "Vulkan", label: "Host Vulkan" },
    { module: "GL", label: "Host OpenGL" },
    { module: "EGL", label: "Host EGL" },
    { module: "asound", label: "Host ALSA" },
    { module: "drm", label: "Host DRM" },
    { module: "WaylandClient", label: "Host Wayland" },
];
function Compatibility({ config, setConfig }) {
    const [resolution, setResolution] = SP_REACT.useState("Default");
    const [defaultResolution, setDefaultResolution] = SP_REACT.useState(config.steamGlobalResolution || "Default");
    const [resolutionMessage, setResolutionMessage] = SP_REACT.useState("");
    const [customSelected, setCustomSelected] = SP_REACT.useState(false);
    const runtimeGame = config.game;
    const games = availableGames(config);
    const selectedGame = config.selectedGame || runtimeGame || null;
    const game = selectedGame;
    const tweaks = config.tweaks;
    const apps = window.SteamClient?.Apps;
    SP_REACT.useEffect(() => {
        let cancelled = false;
        async function loadResolution() {
            if (!game?.appid || !apps?.GetResolutionOverrideForApp) {
                setResolution("Default");
                setResolutionMessage("");
                return;
            }
            try {
                const current = await apps.GetResolutionOverrideForApp(Number(game.appid));
                if (!cancelled) {
                    setResolution(current || "Default");
                    setResolutionMessage("");
                }
            }
            catch (error) {
                if (!cancelled)
                    setResolutionMessage("Resolution override is unavailable");
            }
        }
        loadResolution();
        return () => {
            cancelled = true;
        };
    }, [apps, game?.appid]);
    SP_REACT.useEffect(() => {
        setCustomSelected(false);
    }, [game?.appid]);
    SP_REACT.useEffect(() => {
        setDefaultResolution(config.steamGlobalResolution || "Default");
    }, [config.steamGlobalResolution]);
    const gameSettings = game?.appid ? tweaks.games[game.appid] || {} : {};
    const editingDefault = !game?.appid;
    const perGameEnabled = !!(game?.appid && gameSettings.enabled === true);
    const values = editingDefault || !perGameEnabled ? tweaks.global : { ...tweaks.global, ...gameSettings };
    const patchSettings = (patch) => {
        setConfig((current) => {
            if (!current)
                return current;
            const next = clone(current);
            if (editingDefault) {
                Object.assign(next.tweaks.global, patch);
            }
            else if (perGameEnabled) {
                const existing = next.tweaks.games[game.appid] || {};
                next.tweaks.games[game.appid] = { ...existing, enabled: true, name: game.name || "", ...patch };
            }
            return next;
        });
    };
    const setPerGameEnabled = async (enabled) => {
        if (!game?.appid)
            return;
        setConfig((current) => {
            if (!current)
                return current;
            const next = clone(current);
            next.tweaks.games[game.appid] = {
                ...(next.tweaks.games[game.appid] || {}),
                enabled,
                name: game.name || "",
            };
            return next;
        });
        if (!enabled && apps?.SetAppResolutionOverride) {
            try {
                await apps.SetAppResolutionOverride(Number(game.appid), "Default");
                setResolution("Default");
                setResolutionMessage("");
            }
            catch (error) {
                setResolutionMessage("Failed to clear resolution override");
            }
        }
    };
    const setSteamResolution = async (value) => {
        setResolution(value);
        if (!game?.appid || !apps?.SetAppResolutionOverride)
            return;
        try {
            await apps.SetAppResolutionOverride(Number(game.appid), value);
            setResolutionMessage("");
        }
        catch (error) {
            setResolutionMessage("Failed to set resolution override");
        }
    };
    const setSteamDefaultResolution = async (value) => {
        setDefaultResolution(value);
        try {
            const applied = await setGlobalResolution(value);
            setResolutionMessage("");
            setConfig((current) => (current ? { ...current, steamGlobalResolution: applied || "Default" } : current));
        }
        catch (error) {
            setResolutionMessage("Failed to set default resolution");
        }
    };
    const gameOptions = editTargetOptions(config);
    // "" is the explicit Default target, not "nothing selected"; store a sentinel
    // so it doesn't fall back to the running game in the selectedGame derivation.
    const setSelectedGame = (appid) => {
        const id = String(appid);
        if (!id) {
            setConfig((current) => (current ? { ...current, selectedGame: { appid: "", name: "Default" } } : current));
            return;
        }
        const saved = games.find((candidate) => candidate.appid === id);
        setConfig((current) => (current ? { ...current, selectedGame: saved || null } : current));
    };
    const presets = config.fexProfiles || {};
    const presetEntries = Object.entries(presets);
    const storedProfile = values.fexProfile;
    const storedConfig = values.fexConfig;
    const ownConfig = (editingDefault ? tweaks.global.fexConfig : gameSettings.fexConfig);
    const hasPreset = !!(storedProfile && presets[storedProfile]);
    const isCustom = customSelected || (!hasPreset && !!storedConfig);
    const fexValue = isCustom ? "custom" : hasPreset ? storedProfile : "default";
    const fexConfig = (isCustom ? storedConfig : presets[fexValue]?.config) || presets.default?.config || {};
    const fexOptions = [...presetEntries.map(([id, profile]) => ({ data: id, label: profile.label })), { data: "custom", label: "Custom" }];
    const onSelectFex = (id) => {
        if (id === "custom") {
            setCustomSelected(true);
            // First Custom for this target seeds from the Default preset; afterwards the
            // stored config is kept, including across visits to a preset.
            patchSettings({ fexProfile: "custom", fexConfig: { ...(ownConfig || presets.default?.config || {}) } });
            return;
        }
        setCustomSelected(false);
        patchSettings({ fexProfile: id });
    };
    const setKnob = (key, on) => patchSettings({ fexProfile: "custom", fexConfig: { ...fexConfig, [key]: on ? "1" : "0" } });
    const thunks = values.thunks || {};
    const setThunk = (module, on) => patchSettings({ thunks: { ...thunks, [module]: on } });
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "EDIT GAME PROFILE", children: [SP_JSX.jsx(SelectEdit, { value: game?.appid || "", options: gameOptions, onChange: setSelectedGame }), SP_JSX.jsx("div", { className: "armada-compat-note", children: "Compatibility changes apply on next launch" }), !editingDefault ? SP_JSX.jsx(DFL.ToggleField, { label: "Use Per-Game Settings", checked: perGameEnabled, onChange: setPerGameEnabled }) : null] }), editingDefault || perGameEnabled ? (SP_JSX.jsxs(DFL.PanelSection, { title: "PROFILE SETTINGS", children: [editingDefault ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(SelectEdit, { label: "Game Resolution", value: defaultResolution, options: resolutionOptions, onChange: setSteamDefaultResolution }), resolutionMessage ? SP_JSX.jsx(DFL.Field, { label: "Status", description: resolutionMessage }) : null] })) : null, !editingDefault && perGameEnabled ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(SelectEdit, { label: "Game Resolution", value: resolution, options: resolutionOptions, onChange: setSteamResolution }), resolutionMessage ? SP_JSX.jsx(DFL.Field, { label: "Status", description: resolutionMessage }) : null] })) : null, SP_JSX.jsx(SelectEdit, { label: "FEX Preset", value: fexValue, options: fexOptions, onChange: onSelectFex }), isCustom ? (SP_JSX.jsxs(SP_JSX.Fragment, { children: [fexKnobs.map((knob) => (SP_JSX.jsx(DFL.ToggleField, { label: knob.label, checked: fexConfig[knob.key] === "1", onChange: (value) => setKnob(knob.key, value) }, knob.key))), thunkModules.map((thunk) => (SP_JSX.jsx(DFL.ToggleField, { label: thunk.label, checked: thunks[thunk.module] !== false, onChange: (value) => setThunk(thunk.module, value) }, thunk.module)))] })) : null] })) : null] }));
}

const underclocks = [
    { data: "none", label: "None" },
    { data: "small", label: "Small" },
    { data: "medium", label: "Medium" },
    { data: "large", label: "Large" },
];
function Power({ config, setConfig }) {
    const [profile, setProfile] = SP_REACT.useState(config.power.general.default_profile || "balanced");
    const p = config.power.profiles[profile] || {};
    const profiles = Object.entries(config.power.profiles || {}).map(([name, profile]) => ({
        data: name,
        label: profile.label || titleCase(name),
    }));
    const fanCurves = Object.entries(config.power.fan_curves || {}).map(([name, curve]) => ({
        data: name,
        label: curve.label || titleCase(name),
    }));
    const setProfileValue = (name, value) => {
        setConfig((current) => (current ? update(current, ["power", "profiles", profile, name], value) : current));
    };
    const setGpuValue = (name, value) => {
        setConfig((current) => {
            if (!current)
                return current;
            const next = clone(current);
            const target = next.power.profiles[profile];
            target[name] = value;
            if (name === "gpu_min" && Number(value) > Number(target.gpu_max || 0)) {
                target.gpu_max = value;
            }
            if (name === "gpu_max" && Number(value) < Number(target.gpu_min || 0)) {
                target.gpu_min = value;
            }
            return next;
        });
    };
    const resetProfile = () => {
        const defaults = config.powerDefaults?.profiles?.[profile];
        if (!defaults)
            return;
        setConfig((current) => (current ? update(current, ["power", "profiles", profile], defaults) : current));
    };
    const underclockLevel = p.cpu_underclock || "";
    const supportsUnderclockPresets = !!config.power.underclocks?.[config.cpuDeviceClass];
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(DFL.PanelSection, { title: "EDIT POWER PROFILE", children: SP_JSX.jsx(SelectEdit, { value: profile, options: profiles, onChange: setProfile }) }), SP_JSX.jsxs(DFL.PanelSection, { title: "PROFILE SETTINGS", children: [SP_JSX.jsx(SelectEdit, { label: "Fan Curve", value: p.fan_curve, options: fanCurves, onChange: (v) => setProfileValue("fan_curve", v) }), supportsUnderclockPresets ? (SP_JSX.jsx(SelectEdit, { label: "CPU Underclock", value: underclockLevel, options: underclocks, onChange: (v) => setProfileValue("cpu_underclock", v) })) : (SP_JSX.jsx(SliderEdit, { label: "CPU Max (%)", value: Math.round(Number(p.cpu_max || 0) * 100), min: 35, max: 100, step: 1, onChange: (v) => setProfileValue("cpu_max", (v / 100).toFixed(2)) })), SP_JSX.jsx(SliderEdit, { label: "GPU Min (%)", value: Math.round(Number(p.gpu_min || 0) * 100), min: 0, max: 100, step: 1, onChange: (v) => setGpuValue("gpu_min", (v / 100).toFixed(2)) }), SP_JSX.jsx(SliderEdit, { label: "GPU Max (%)", value: Math.round(Number(p.gpu_max || 0) * 100), min: 35, max: 100, step: 1, onChange: (v) => setGpuValue("gpu_max", (v / 100).toFixed(2)) }), SP_JSX.jsx("div", { className: "armada-reset-row", children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: resetProfile, children: "Reset to Default" }) })] })] }));
}

const CAPTURE_CONTROLS = ["left_x", "left_y", "right_x", "right_y", "left_trigger", "right_trigger"];
function controlValue(state, name) {
    return Number(state?.controls?.[name]?.value || 0);
}
function controlRange(state, name) {
    const control = state?.controls?.[name] || {};
    const min = Number(control.min);
    const max = Number(control.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max)
        return { min: -32768, max: 32767 };
    return { min, max };
}
function normalizedValue(state, name) {
    const { min, max } = controlRange(state, name);
    const value = controlValue(state, name);
    const side = value < 0 ? Math.abs(min) : max;
    if (!side)
        return 0;
    return Math.max(-1, Math.min(1, value / side));
}
function triggerPercent(state, name) {
    const { min, max } = controlRange(state, name);
    const value = controlValue(state, name);
    if (max === min)
        return 0;
    return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}
function makeCapture(state) {
    const capture = {};
    for (const name of CAPTURE_CONTROLS) {
        const value = controlValue(state, name);
        const range = controlRange(state, name);
        capture[name] = {
            center: value,
            min: value,
            max: value,
            range: range.max - range.min,
        };
    }
    return capture;
}
function updateCapture(capture, state) {
    const next = clone(capture || makeCapture(state));
    for (const name of Object.keys(next)) {
        const value = controlValue(state, name);
        next[name].min = Math.min(next[name].min, value);
        next[name].max = Math.max(next[name].max, value);
    }
    return next;
}

function StickPlot({ title, xName, yName, state }) {
    const x = normalizedValue(state, xName);
    const y = normalizedValue(state, yName);
    return (SP_JSX.jsxs("div", { style: { minWidth: 0 }, children: [SP_JSX.jsx("div", { style: { marginBottom: "10px", fontSize: "15px", fontWeight: 600, opacity: 0.9 }, children: title }), SP_JSX.jsxs("div", { style: {
                    position: "relative",
                    width: "132px",
                    height: "132px",
                    border: "2px solid rgba(255,255,255,0.34)",
                    background: "rgba(255,255,255,0.055)",
                    boxSizing: "border-box",
                }, children: [SP_JSX.jsx("div", { style: { position: "absolute", left: "8%", right: "8%", top: "50%", height: "1px", background: "rgba(255,255,255,0.22)" } }), SP_JSX.jsx("div", { style: { position: "absolute", top: "8%", bottom: "8%", left: "50%", width: "1px", background: "rgba(255,255,255,0.22)" } }), SP_JSX.jsx("div", { style: {
                            position: "absolute",
                            width: "18px",
                            height: "18px",
                            margin: "-9px 0 0 -9px",
                            border: "2px solid #fff",
                            borderRadius: "50%",
                            background: "#2677d8",
                            left: `${50 + x * 44}%`,
                            top: `${50 + y * 44}%`,
                        } })] })] }));
}
function TriggerBar({ title, name, state }) {
    return (SP_JSX.jsxs("div", { children: [SP_JSX.jsx("div", { style: { marginBottom: "10px", fontSize: "15px", fontWeight: 600, opacity: 0.9 }, children: title }), SP_JSX.jsx(DFL.ProgressBar, { nProgress: triggerPercent(state, name), nTransitionSec: 0 })] }));
}
const gridTwoCol = { display: "grid", gridTemplateColumns: "repeat(2, 132px)", gap: "22px", justifyContent: "center", width: "100%" };
// Modal input capture leaves gamepad focus frozen on the last-touched button.
const focusStyles = `
  .armada-cal-footer button.gpfocus,
  .armada-cal-footer button:focus,
  .armada-cal-footer button:hover {
    background-color: rgba(255, 255, 255, 0.1) !important;
    color: #ffffff !important;
    box-shadow: none !important;
    transform: none !important;
    -webkit-filter: none !important;
    filter: none !important;
  }
`;
function CalibrationModal({ closeModal }) {
    const [state, setState] = SP_REACT.useState(null);
    const [capture, setCapture] = SP_REACT.useState(null);
    const [phase, setPhase] = SP_REACT.useState("idle");
    const sessionToken = SP_REACT.useRef(`${Date.now()}-${Math.random()}`);
    const phaseRef = SP_REACT.useRef("idle");
    const canApply = !!state?.canApply;
    SP_REACT.useEffect(() => {
        phaseRef.current = phase;
    }, [phase]);
    SP_REACT.useEffect(() => {
        let cancelled = false;
        let inflight = false;
        const tick = async () => {
            if (cancelled || inflight)
                return;
            inflight = true;
            try {
                const next = await getControllerState();
                if (cancelled)
                    return;
                setState(next);
                if (phaseRef.current === "recording" && next.supported) {
                    setCapture((current) => updateCapture(current || makeCapture(next), next));
                }
            }
            catch (error) {
                if (!cancelled)
                    setState({ supported: false, reason: String(error), controls: {} });
            }
            finally {
                inflight = false;
            }
        };
        tick();
        const timer = window.setInterval(tick, 50);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, []);
    // Intercept input for the whole modal so stick/trigger movement (during, after,
    // or just viewing calibration) doesn't leak to Steam behind it.
    SP_REACT.useEffect(() => {
        const token = sessionToken.current;
        beginCalibrationSession(token).catch(() => { });
        return () => {
            endCalibrationSession(token).catch(() => { });
        };
    }, []);
    const close = () => {
        closeModal?.();
    };
    const start = () => {
        setCapture(null);
        setPhase("recording");
    };
    const save = async () => {
        if (!capture)
            return;
        try {
            const next = await saveCalibration(capture);
            setState(next);
            setCapture(null);
            setPhase("idle");
        }
        catch (error) {
            setState((current) => ({ ...(current || {}), supported: false, reason: String(error) }));
            setPhase("idle");
        }
    };
    const reset = async () => {
        try {
            const next = await resetCalibration();
            setState(next);
        }
        catch (error) {
            setState((current) => ({ ...(current || {}), supported: false, reason: String(error) }));
        }
    };
    const instructions = !state
        ? "Checking controller..."
        : !canApply
            ? "This device can't save calibration, but you can check stick and trigger response here."
            : phase === "recording"
                ? "Move both sticks in full circles and fully press both triggers, then Save."
                : "Press Start, then move sticks and triggers through full range.";
    return (SP_JSX.jsxs(DFL.ModalRoot, { onCancel: close, children: [SP_JSX.jsxs(DFL.DialogBody, { children: [SP_JSX.jsxs("div", { style: { ...gridTwoCol, alignItems: "start", marginBottom: "22px" }, children: [SP_JSX.jsx(StickPlot, { title: "Left Stick", xName: "left_x", yName: "left_y", state: state }), SP_JSX.jsx(StickPlot, { title: "Right Stick", xName: "right_x", yName: "right_y", state: state })] }), SP_JSX.jsxs("div", { style: { ...gridTwoCol, marginBottom: "16px" }, children: [SP_JSX.jsx(TriggerBar, { title: "LT", name: "left_trigger", state: state }), SP_JSX.jsx(TriggerBar, { title: "RT", name: "right_trigger", state: state })] }), SP_JSX.jsx("div", { style: { fontSize: "13px", lineHeight: "18px", opacity: 0.72, textAlign: "center" }, children: instructions })] }), SP_JSX.jsxs(DFL.DialogFooter, { children: [SP_JSX.jsx("style", { children: focusStyles }), !canApply ? (SP_JSX.jsx("div", { className: "armada-cal-footer", style: { display: "flex", gap: "10px" }, children: SP_JSX.jsx(DFL.DialogButton, { onClick: close, children: "Close" }) })) : phase === "recording" ? (SP_JSX.jsxs("div", { className: "armada-cal-footer", style: { display: "flex", gap: "10px" }, children: [SP_JSX.jsx(DFL.DialogButton, { onClick: save, disabled: !capture, children: "Save Calibration" }), SP_JSX.jsx(DFL.DialogButton, { onClick: close, children: "Close" })] })) : (SP_JSX.jsxs("div", { className: "armada-cal-footer", style: { display: "flex", gap: "10px" }, children: [SP_JSX.jsx(DFL.DialogButton, { onClick: start, children: "Start Calibration" }), SP_JSX.jsx(DFL.DialogButton, { onClick: reset, children: "Reset to Defaults" }), SP_JSX.jsx(DFL.DialogButton, { onClick: close, children: "Close" })] }))] })] }));
}
function openCalibration() {
    DFL.showModal(SP_JSX.jsx(CalibrationModal, {}));
}

function Settings({ config, setConfig }) {
    const setSshEnabled$1 = async (enabled) => {
        setConfig((current) => (current ? { ...current, sshEnabled: enabled } : current));
        try {
            const applied = await setSshEnabled(enabled);
            setConfig((current) => (current ? { ...current, sshEnabled: applied } : current));
        }
        catch (error) {
            setConfig((current) => (current ? { ...current, sshEnabled: !enabled } : current));
        }
    };
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsx(ToggleRow, { label: "Enable SSH", value: !!config.sshEnabled, onChange: setSshEnabled$1 }), SP_JSX.jsx(DFL.PanelSection, { children: SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: openCalibration, children: "Controller Calibration" }) })] }));
}

function Content() {
    const [tab, setTab] = SP_REACT.useState("Compatibility");
    const [config, setConfig] = SP_REACT.useState(null);
    const [message, setMessage] = SP_REACT.useState("Loading");
    const savedPowerSnapshot = SP_REACT.useRef("");
    const savedTweaksSnapshot = SP_REACT.useRef("");
    const load = SP_REACT.useCallback(async () => {
        try {
            const next = await getConfig();
            next.game = currentGame();
            next.selectedGame = next.game || null;
            savedPowerSnapshot.current = JSON.stringify(next.power);
            savedTweaksSnapshot.current = JSON.stringify(next.tweaks);
            setConfig(next);
        }
        catch (error) {
            setMessage(String(error));
        }
    }, []);
    SP_REACT.useEffect(() => {
        load();
    }, [load]);
    SP_REACT.useEffect(() => {
        if (!config)
            return;
        let cancelled = false;
        const refreshRuntime = async () => {
            try {
                const runtimeGame = currentGame();
                if (cancelled)
                    return;
                setConfig((current) => {
                    if (!current)
                        return current;
                    const currentApp = current.game?.appid || "";
                    const nextApp = runtimeGame?.appid || "";
                    const currentName = current.game?.name || "";
                    const nextName = runtimeGame?.name || "";
                    if (currentApp === nextApp && currentName === nextName)
                        return current;
                    return { ...current, game: runtimeGame };
                });
            }
            catch (error) {
            }
        };
        const timer = window.setInterval(refreshRuntime, 2000);
        refreshRuntime();
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [!!config]);
    useDebouncedSave({ config, field: "power", snapshot: savedPowerSnapshot, save: savePowerConfig, setConfig, onError: load });
    useDebouncedSave({ config, field: "tweaks", snapshot: savedTweaksSnapshot, save: saveTweaks, setConfig, onError: load });
    // QAM dropdown CSS fix lives in Steam's tab, not ours; install once config is
    // loaded and retry, since executeInTab can land before the row exists.
    const profileKey = config ? Object.values(config.power.profiles || {}).map((p) => p.label).join(",") : "";
    SP_REACT.useEffect(() => {
        if (!profileKey)
            return;
        const labels = profileKey.split(",");
        let cancelled = false;
        let attempts = 0;
        const install = () => {
            if (cancelled)
                return;
            installQamProfileFix(labels);
            attempts += 1;
            if (attempts < 5)
                window.setTimeout(install, 1500);
        };
        install();
        return () => {
            cancelled = true;
        };
    }, [profileKey]);
    if (!config)
        return SP_JSX.jsx(DFL.PanelSection, { title: "Armada Control", children: SP_JSX.jsx(DFL.Field, { label: message }) });
    const tabContent = (content) => (SP_JSX.jsx("div", { className: "armada-control-tab-content", children: content }));
    return (SP_JSX.jsxs("div", { className: "armada-control-tabs", children: [SP_JSX.jsx("style", { children: styles }), SP_JSX.jsx(DFL.Tabs, { activeTab: tab, onShowTab: setTab, tabs: [
                    { id: "Compatibility", title: tabIcons.Compatibility, content: tabContent(SP_JSX.jsx(Compatibility, { config: config, setConfig: setConfig })) },
                    { id: "Power", title: tabIcons.Power, content: tabContent(SP_JSX.jsx(Power, { config: config, setConfig: setConfig })) },
                    { id: "Advanced", title: tabIcons.Advanced, content: tabContent(SP_JSX.jsx(Settings, { config: config, setConfig: setConfig })) },
                ] })] }));
}

var index = definePlugin(() => ({
    name: "Armada Control",
    content: SP_JSX.jsx(Content, {}),
    icon: SP_JSX.jsx("div", { style: { fontWeight: 700 }, children: "A" }),
    alwaysRender: true,
    onDismount: cleanupQamFix,
}));

export { index as default };
//# sourceMappingURL=index.js.map
