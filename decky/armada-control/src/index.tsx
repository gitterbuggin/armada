import { definePlugin } from "@decky/api";
import { getConfig } from "./backend";
import { Content } from "./Content";
import { cleanupQamFix, startQamProfileFix } from "./qamFix";

export default definePlugin(() => {
  const stopQamFix = startQamProfileFix(async () => {
    const config = await getConfig();
    return Object.values(config.power.profiles || {}).map((profile) => profile.label);
  });
  return {
    name: "Armada Control",
    content: <Content />,
    icon: <div style={{ fontWeight: 700 }}>A</div>,
    alwaysRender: true,
    onDismount: () => {
      stopQamFix();
      cleanupQamFix();
    },
  };
});
