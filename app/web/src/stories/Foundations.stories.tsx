import type { Meta, StoryObj } from "@storybook/react-vite";

// Smoke story: proves the Storybook pipeline; the token specimen and
// component kit grow from here.
const Swatch = ({ name }: { name: string }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <span
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        background: `var(${name})`,
        border: "1px solid var(--line)",
      }}
    />
    <code style={{ fontSize: 12 }}>{name}</code>
  </div>
);

const meta: Meta = { title: "Foundations/Colors" };
export default meta;

export const Palette: StoryObj = {
  render: () => (
    <div style={{ display: "grid", gap: 10 }}>
      {["--bg", "--panel", "--ink", "--muted", "--line", "--accent", "--warn", "--danger"].map(
        (n) => (
          <Swatch key={n} name={n} />
        ),
      )}
    </div>
  ),
};
