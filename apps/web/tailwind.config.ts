import type { Config } from "tailwindcss";
import uiConfig from "@nimbus/ui/tailwind.config";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  presets: [uiConfig],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
