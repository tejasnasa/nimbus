import type { Config } from "tailwindcss";
import uiConfig from "@nimbus/ui/tailwind.config";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  presets: [uiConfig],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
