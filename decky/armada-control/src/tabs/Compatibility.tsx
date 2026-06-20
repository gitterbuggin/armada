import { Field, PanelSection, ToggleField } from "@decky/ui";
import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { SelectEdit } from "../components/widgets";
import { getGlobalResolution, setGlobalResolution } from "../lib/steamSettings";
import { clone } from "../lib/util";
import { availableGames, editTargetOptions } from "../lib/games";
import type { Config } from "../types";

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

export function Compatibility({ config, setConfig }: { config: Config; setConfig: Dispatch<SetStateAction<Config | null>> }) {
  const [resolution, setResolution] = useState("Default");
  const [defaultResolution, setDefaultResolution] = useState(getGlobalResolution());
  const [resolutionMessage, setResolutionMessage] = useState("");
  const [customSelected, setCustomSelected] = useState(false);
  const runtimeGame = config.game;
  const games = availableGames(config);
  const selectedGame = config.selectedGame || runtimeGame || null;
  const game = selectedGame;
  const tweaks = config.tweaks;
  const apps = window.SteamClient?.Apps;
  useEffect(() => {
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
      } catch (error) {
        if (!cancelled) setResolutionMessage("Resolution override is unavailable");
      }
    }
    loadResolution();
    return () => {
      cancelled = true;
    };
  }, [apps, game?.appid]);
  useEffect(() => {
    setCustomSelected(false);
  }, [game?.appid]);
  useEffect(() => {
    setDefaultResolution(getGlobalResolution());
  }, []);
  const gameSettings = game?.appid ? tweaks.games[game.appid] || {} : {};
  const editingDefault = !game?.appid;
  const perGameEnabled = !!(game?.appid && gameSettings.enabled === true);
  const values = editingDefault || !perGameEnabled ? tweaks.global : { ...tweaks.global, ...gameSettings };
  const patchSettings = (patch: Record<string, any>) => {
    setConfig((current) => {
      if (!current) return current;
      const next = clone(current);
      if (editingDefault) {
        Object.assign(next.tweaks.global, patch);
      } else if (perGameEnabled) {
        const existing = next.tweaks.games[game!.appid] || {};
        next.tweaks.games[game!.appid] = { ...existing, enabled: true, name: game!.name || "", ...patch };
      }
      return next;
    });
  };
  const setPerGameEnabled = async (enabled: boolean) => {
    if (!game?.appid) return;
    setConfig((current) => {
      if (!current) return current;
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
      } catch (error) {
        setResolutionMessage("Failed to clear resolution override");
      }
    }
  };
  const setSteamResolution = async (value: string) => {
    setResolution(value);
    if (!game?.appid || !apps?.SetAppResolutionOverride) return;
    try {
      await apps.SetAppResolutionOverride(Number(game.appid), value);
      setResolutionMessage("");
    } catch (error) {
      setResolutionMessage("Failed to set resolution override");
    }
  };
  const setSteamDefaultResolution = async (value: string) => {
    setDefaultResolution(value);
    try {
      const applied = await setGlobalResolution(value);
      setResolutionMessage("");
      setDefaultResolution(applied || "Default");
    } catch (error) {
      setResolutionMessage("Failed to set default resolution");
    }
  };
  const gameOptions = editTargetOptions(config);
  // "" is the explicit Default target, not "nothing selected"; store a sentinel
  // so it doesn't fall back to the running game in the selectedGame derivation.
  const setSelectedGame = (appid: any) => {
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
  const storedProfile = values.fexProfile as string | undefined;
  const storedConfig = values.fexConfig as Record<string, string> | undefined;
  const ownConfig = (editingDefault ? tweaks.global.fexConfig : gameSettings.fexConfig) as Record<string, string> | undefined;
  const hasPreset = !!(storedProfile && presets[storedProfile]);
  const isCustom = customSelected || (!hasPreset && !!storedConfig);
  const fexValue = isCustom ? "custom" : hasPreset ? storedProfile! : "default";
  const fexConfig: Record<string, string> = (isCustom ? storedConfig : presets[fexValue]?.config) || presets.default?.config || {};
  const fexOptions = [...presetEntries.map(([id, profile]) => ({ data: id, label: profile.label })), { data: "custom", label: "Custom" }];
  const onSelectFex = (id: any) => {
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
  const setKnob = (key: string, on: boolean) => patchSettings({ fexProfile: "custom", fexConfig: { ...fexConfig, [key]: on ? "1" : "0" } });
  const thunks: Record<string, boolean> = values.thunks || {};
  const setThunk = (module: string, on: boolean) => patchSettings({ thunks: { ...thunks, [module]: on } });

  return (
    <>
      <PanelSection title="EDIT GAME PROFILE">
        <SelectEdit value={game?.appid || ""} options={gameOptions} onChange={setSelectedGame} />
        <div className="armada-compat-note">Compatibility changes apply on next launch</div>
        {!editingDefault ? <ToggleField label="Use Per-Game Settings" checked={perGameEnabled} onChange={setPerGameEnabled} /> : null}
      </PanelSection>
      {editingDefault || perGameEnabled ? (
        <PanelSection title="PROFILE SETTINGS">
          {editingDefault ? (
            <>
              <SelectEdit label="Game Resolution" value={defaultResolution} options={resolutionOptions} onChange={setSteamDefaultResolution} />
              {resolutionMessage ? <Field label="Status" description={resolutionMessage} /> : null}
            </>
          ) : null}
          {!editingDefault && perGameEnabled ? (
            <>
              <SelectEdit label="Game Resolution" value={resolution} options={resolutionOptions} onChange={setSteamResolution} />
              {resolutionMessage ? <Field label="Status" description={resolutionMessage} /> : null}
            </>
          ) : null}
          <SelectEdit label="FEX Preset" value={fexValue} options={fexOptions} onChange={onSelectFex} />
          {isCustom ? (
            <>
              {fexKnobs.map((knob) => (
                <ToggleField key={knob.key} label={knob.label} checked={fexConfig[knob.key] === "1"} onChange={(value) => setKnob(knob.key, value)} />
              ))}
              {thunkModules.map((thunk) => (
                <ToggleField key={thunk.module} label={thunk.label} checked={thunks[thunk.module] !== false} onChange={(value) => setThunk(thunk.module, value)} />
              ))}
            </>
          ) : null}
        </PanelSection>
      ) : null}
    </>
  );
}
