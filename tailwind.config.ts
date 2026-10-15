import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        // カード配色。値はglobals.cssの:rootで定義する
        panel: "var(--panel)",
        "panel-line": "var(--panel-line)",
        heading: "var(--heading)",
        brand: "var(--brand)",
      },
    },
  },
  plugins: [],
};
export default config;
