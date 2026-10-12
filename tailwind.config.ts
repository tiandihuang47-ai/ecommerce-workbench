import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/app/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Helvetica Neue",
          "PingFang SC",
          "Microsoft YaHei",
          "sans-serif"
        ]
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))"
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))"
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))"
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))"
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))"
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))"
        },
        brand: {
          DEFAULT: "hsl(var(--brand))",
          foreground: "hsl(var(--brand-foreground))"
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))"
        },
        /* 生图界面视觉令牌（见 docs/生图界面优化方案.md 第五章） */
        canvas: "var(--ui-canvas)",
        surface: "var(--ui-surface)",
        "surface-2": "var(--ui-surface-2)",
        line: "var(--ui-line)",
        "line-strong": "var(--ui-line-strong)",
        "ink-1": "var(--ui-ink-1)",
        "ink-2": "var(--ui-ink-2)",
        "ink-3": "var(--ui-ink-3)",
        "brand-solid": "var(--ui-brand)",
        "brand-hover": "var(--ui-brand-hover)",
        "brand-soft": "var(--ui-brand-soft)",
        "brand-ring": "var(--ui-brand-ring)",
        ok: "var(--ui-ok)",
        warn: "var(--ui-warn)",
        danger: "var(--ui-danger)",
        info: "var(--ui-info)",
        "ok-soft": "var(--ui-ok-soft)",
        "warn-soft": "var(--ui-warn-soft)",
        "danger-soft": "var(--ui-danger-soft)",
        "info-soft": "var(--ui-info-soft)"
      }
    }
  },
  plugins: []
};

export default config;
