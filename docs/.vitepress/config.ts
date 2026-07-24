import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Open Work",
  description: "AI agent harness for any LLM — Anthropic, OpenAI, Gemini, Ollama, OpenRouter",
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/reference/core-api" },
      { text: "GitHub", link: "https://github.com/KetchCyork/Open-Work" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Providers", link: "/guide/providers" },
          { text: "Built-in tools", link: "/guide/tools" },
          { text: "Multi-agent orchestration", link: "/guide/multi-agent" },
          { text: "Advisory Council", link: "/guide/advisory-council" },
          { text: "Preferences & keyboard shortcuts", link: "/guide/preferences" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Core API", link: "/reference/core-api" },
          { text: "Plugin system", link: "/reference/plugins" },
          { text: "CLI", link: "/reference/cli" },
        ],
      },
      {
        text: "Desktop",
        items: [
          { text: "Desktop app", link: "/desktop/index" },
          { text: "Building & signing", link: "/desktop/building" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/KetchCyork/Open-Work" },
    ],
    footer: {
      message: "Released under the MIT License.",
    },
  },
});
