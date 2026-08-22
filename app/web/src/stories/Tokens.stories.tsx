import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta = { title: "Foundations/Tokens" };
export default meta;

const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{children}</div>
);

export const Specimen: StoryObj = {
  render: () => (
    <div style={{ display: "grid", gap: 24, width: 560, color: "var(--ink)" }}>
      <section>
        <h3 style={{ font: "600 var(--text-sm) var(--font-ui)", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>neutral ramp</h3>
        <Row>
          {[0,1,2,3,4,5,6,7,8].map((n) => (
            <div key={n} style={{ width: 48, height: 40, borderRadius: "var(--r-sm)", background: `var(--gray-${n})`, border: "1px solid var(--line)" }} title={`--gray-${n}`} />
          ))}
        </Row>
      </section>
      <section>
        <h3 style={{ font: "600 var(--text-sm) var(--font-ui)", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>accent & status</h3>
        <Row>
          {["--accent","--accent-hover","--accent-soft","--warn","--danger"].map((n) => (
            <div key={n} style={{ width: 84, height: 40, borderRadius: "var(--r-sm)", background: `var(${n})`, border: "1px solid var(--line)" }} title={n} />
          ))}
        </Row>
      </section>
      <section style={{ display: "grid", gap: 6 }}>
        <h3 style={{ font: "600 var(--text-sm) var(--font-ui)", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>type scale</h3>
        <span style={{ fontSize: "var(--text-xl)", fontWeight: 600 }}>Page title — 20/600</span>
        <span style={{ fontSize: "var(--text-lg)" }}>Editor body — 15, mono in practice</span>
        <span style={{ fontSize: "var(--text-md)" }}>UI default — 13.5</span>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--muted)" }}>Secondary — 12.5 muted</span>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Section label — 11 caps</span>
      </section>
      <section>
        <h3 style={{ font: "600 var(--text-sm) var(--font-ui)", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>surfaces</h3>
        <Row>
          <div style={{ padding: "var(--s3) var(--s4)", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", boxShadow: "var(--shadow-1)" }}>panel</div>
          <div style={{ padding: "var(--s3) var(--s4)", background: "var(--raised)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-2)" }}>raised (menus, dialogs)</div>
          <div style={{ padding: "var(--s3) var(--s4)", background: "var(--hover)", borderRadius: "var(--r-md)" }}>hover</div>
        </Row>
      </section>
    </div>
  ),
};

export const Dark: StoryObj = {
  ...Specimen,
  decorators: [(Story) => <div data-theme="dark" style={{ background: "var(--gray-0)", padding: 32, borderRadius: 8 }}><Story /></div>],
};
