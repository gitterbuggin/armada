import { ButtonItem, Field, PanelSection } from "@decky/ui";
import type { Dispatch, SetStateAction } from "react";
import { setControllerType as applyControllerType, setLeds as applyLeds, setSshEnabled as applySshEnabled } from "../backend";
import { openCalibration } from "../components/Calibration";
import { SelectEdit, ToggleRow } from "../components/widgets";
import type { Config } from "../types";

export function Settings({ config, setConfig }: {
  config: Config;
  setConfig: Dispatch<SetStateAction<Config | null>>;
}) {
  const setSshEnabled = async (enabled: boolean) => {
    if (enabled === !!config.sshEnabled) {
      return;
    }
    setConfig((current) => (current ? { ...current, sshEnabled: enabled } : current));
    try {
      const applied = await applySshEnabled(enabled);
      setConfig((current) => (current ? { ...current, sshEnabled: applied } : current));
    } catch (error) {
      setConfig((current) => (current ? { ...current, sshEnabled: !enabled } : current));
    }
  };
  const setControllerType = async (value: string) => {
    const previous = config.controllerType || "deck-uhid";
    setConfig((current) => (current ? { ...current, controllerType: value } : current));
    try {
      const applied = await applyControllerType(value);
      setConfig((current) => (current ? { ...current, controllerType: applied } : current));
    } catch (error) {
      setConfig((current) => (current ? { ...current, controllerType: previous } : current));
    }
  };
  const setLedGroup = async (group: "sides" | "sticks", on: boolean) => {
    const previous = config.leds;
    setConfig((current) => {
      if (!current?.leds) return current;
      return { ...current, leds: { ...current.leds, [group]: { ...current.leds[group], on } } };
    });
    try {
      const applied = await applyLeds({ [group]: on });
      setConfig((current) => (current ? { ...current, leds: applied } : current));
    } catch (error) {
      setConfig((current) => (current ? { ...current, leds: previous } : current));
    }
  };
  const ledsAvailable = !!(config.leds && (config.leds.sides.available || config.leds.sticks.available));
  return (
    <>
      <PanelSection title="Controller">
        <SelectEdit
          label="Emulation"
          value={config.controllerType || "deck-uhid"}
          options={config.controllerTypes || []}
          onChange={setControllerType}
        />
        <ButtonItem layout="below" onClick={openCalibration}>Launch Calibration</ButtonItem>
      </PanelSection>
      {ledsAvailable && (
        <PanelSection title="Lighting">
          {config.leds?.sides.available && (
            <ToggleRow label="Side LEDs" value={config.leds.sides.on} onChange={(on: boolean) => setLedGroup("sides", on)} />
          )}
          {config.leds?.sticks.available && (
            <ToggleRow label="Joystick LEDs" value={config.leds.sticks.on} onChange={(on: boolean) => setLedGroup("sticks", on)} />
          )}
        </PanelSection>
      )}
      <PanelSection title="System">
        <ToggleRow label="Enable SSH" value={!!config.sshEnabled} onChange={setSshEnabled} />
        <Field label="OS Version" description={config.osVersion || "unknown"} />
      </PanelSection>
    </>
  );
}
