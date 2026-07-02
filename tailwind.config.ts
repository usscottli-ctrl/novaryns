import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/app/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1280px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // 设计系统原始 token(走 CSS 变量,组件直接用,禁止写死 hex)
        acc: "var(--acc)",
        "acc-2": "var(--acc2)",
        "acc-tint": "var(--acc-tint)",
        "acc-border": "var(--acc-border)",
        "c-bg": "var(--c-bg)",
        "c-card": "var(--c-card)",
        "c-subtle": "var(--c-subtle)",
        "c-subtle2": "var(--c-subtle2)",
        "c-subtle3": "var(--c-subtle3)",
        "c-track": "var(--c-track)",
        "c-border": "var(--c-border)",
        "c-border2": "var(--c-border2)",
        "c-border3": "var(--c-border3)",
        "c-line": "var(--c-line)",
        "c-text": "var(--c-text)",
        "c-text2": "var(--c-text2)",
        "c-text3": "var(--c-text3)",
        "c-text4": "var(--c-text4)",
        "c-tint-b": "var(--c-tint-b)",
        "c-tint-v": "var(--c-tint-v)",
        "c-tint-a": "var(--c-tint-a)",
        "c-tint-g": "var(--c-tint-g)",
        "c-tint-r": "var(--c-tint-r)",
        "c-tint-gold": "var(--c-tint-gold)",
        "c-success": "var(--c-success)",
        "c-success-strong": "var(--c-success-strong)",
        "c-danger": "var(--c-danger)",
        "c-warn": "var(--c-warn)",
        "c-warn-bg": "var(--c-warn-bg)",
        "c-blue": "var(--c-blue)",
        "c-violet": "var(--c-violet)",
        "c-gold": "var(--c-gold)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        ctl: "8px",
        field: "10px",
        icon: "12px",
        card: "16px",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        btn: "var(--shadow-btn)",
        "btn-hover": "var(--shadow-btn-hover)",
        pop: "var(--shadow-pop)",
        toast: "var(--shadow-toast)",
      },
      fontFamily: {
        sans: [
          "var(--font-geist-sans)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "Helvetica Neue",
          "Arial",
          "system-ui",
          "sans-serif",
        ],
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "gradient-pan": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s ease-out forwards",
        "gradient-pan": "gradient-pan 8s ease infinite",
        blink: "blink 1s step-end infinite",
      },
    },
  },
  plugins: [],
};

export default config;
