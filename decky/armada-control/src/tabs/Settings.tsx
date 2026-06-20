import { ButtonItem, PanelSection } from "@decky/ui";
import type { Dispatch, SetStateAction } from "react";
import { setSshEnabled as applySshEnabled } from "../backend";
import { openCalibration } from "../components/Calibration";
import { ToggleRow } from "../components/widgets";
import type { Config } from "../types";

export function Settings({ config, setConfig }: {
  config: Config;
  setConfig: Dispatch<SetStateAction<Config | null>>;
}) {
  const setSshEnabled = async (enabled: boolean) => {
    setConfig((current) => (current ? { ...current, sshEnabled: enabled } : current));
    try {
      const applied = await applySshEnabled(enabled);
      setConfig((current) => (current ? { ...current, sshEnabled: applied } : current));
    } catch (error) {
      setConfig((current) => (current ? { ...current, sshEnabled: !enabled } : current));
    }
  };
  return (
    <>
      <ToggleRow label="Enable SSH" value={!!config.sshEnabled} onChange={setSshEnabled} />
      <PanelSection>
        <ButtonItem layout="below" onClick={openCalibration}>Controller Calibration</ButtonItem>
      </PanelSection>
    </>
  );
}
