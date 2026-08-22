import type { Preview } from "@storybook/react-vite";
import "../web/src/styles.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    backgrounds: {
      options: {
        light: { name: "light", value: "#fbfaf8" },
        dark: { name: "dark", value: "#101012" },
      },
    },
  },
  initialGlobals: { backgrounds: { value: "light" } },
};

export default preview;
