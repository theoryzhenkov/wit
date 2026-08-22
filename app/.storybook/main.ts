import type { StorybookConfig } from "@storybook/react-vite";

// The wit design system workbench (linker pattern): stories live beside
// the web SPA; `build-storybook` is a CI gate.
const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../web/src/**/*.stories.tsx"],
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    // The SPA's vite root is app/web; stories resolve from there.
    resolve: viteConfig.resolve,
  }),
};

export default config;
