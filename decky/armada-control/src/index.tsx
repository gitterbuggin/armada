import { definePlugin } from "@decky/api";
import { Content } from "./Content";
import { cleanupQamFix } from "./qamFix";

export default definePlugin(() => ({
  name: "Armada Control",
  content: <Content />,
  icon: <div style={{ fontWeight: 700 }}>A</div>,
  alwaysRender: true,
  onDismount: cleanupQamFix,
}));
