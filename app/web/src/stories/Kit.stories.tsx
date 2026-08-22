import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Button,
  CommandPalette,
  Dialog,
  Input,
  Kbd,
  ListRow,
  Menu,
  ToastProvider,
  useToast,
} from "../kit";

const meta: Meta = { title: "Kit" };
export default meta;

export const Buttons: StoryObj = {
  render: () => (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <Button variant="primary">Publish</Button>
      <Button>New doc</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="danger">Delete</Button>
      <Button size="sm">Pin</Button>
      <Button disabled>Disabled</Button>
    </div>
  ),
};

export const Inputs: StoryObj = {
  render: () => (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <Input placeholder="search…" />
      <Input defaultValue="my-great-note" style={{ fontFamily: "var(--font-mono)" }} />
      <Kbd>⌘K</Kbd>
      <Kbd>esc</Kbd>
    </div>
  ),
};

export const Rows: StoryObj = {
  render: () => (
    <div style={{ width: 280, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: 4 }}>
      <ListRow leading={<span className="vis-dot vis-public" />} title="The Garden" meta="garden" active />
      <ListRow leading={<span className="vis-dot vis-private" />} title="Draft with a very long title that truncates" meta="draft" />
      <ListRow leading={<span className="vis-dot vis-unlisted" />} title="Half-shared note" meta="half" focused />
    </div>
  ),
};

const DialogDemo = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Delete doc…</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete “The Garden”?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={() => setOpen(false)}>Delete</Button>
          </>
        }
      >
        <span style={{ color: "var(--muted)" }}>Backlinks revert to dangling; a redirect is not kept.</span>
      </Dialog>
    </>
  );
};
export const DialogStory: StoryObj = { name: "Dialog", render: () => <DialogDemo /> };

const MenuDemo = () => {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      style={{ width: 320, height: 160, display: "grid", placeItems: "center", border: "1px dashed var(--line)", borderRadius: 8, color: "var(--muted)" }}
      onContextMenu={(e) => {
        e.preventDefault();
        setAt({ x: e.clientX, y: e.clientY });
      }}
    >
      right-click me
      {at && (
        <Menu
          at={at}
          onClose={() => setAt(null)}
          items={[
            { label: "Rename", onSelect: () => {} },
            { label: "Pin to collection", onSelect: () => {} },
            "sep",
            { label: "Delete", danger: true, onSelect: () => {} },
          ]}
        />
      )}
    </div>
  );
};
export const ContextMenu: StoryObj = { render: () => <MenuDemo /> };

const ToastDemo = () => {
  const toast = useToast();
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <Button onClick={() => toast("Published — live on theor.net")}>Publish toast</Button>
      <Button variant="danger" onClick={() => toast("Upload failed", "danger")}>Error toast</Button>
    </div>
  );
};
export const Toasts: StoryObj = {
  render: () => (
    <ToastProvider>
      <ToastDemo />
    </ToastProvider>
  ),
};

const PaletteDemo = () => {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ width: 640, height: 420 }}>
      <Button onClick={() => setOpen(true)}>Open (⌘K)</Button>
      <CommandPalette
        open={open}
        onClose={() => setOpen(false)}
        commands={[
          { id: "new", title: "New doc", section: "actions", kbd: "⌘N", run: () => {} },
          { id: "pub", title: "Publish current doc", section: "actions", run: () => {} },
          { id: "vis", title: "Set visibility…", section: "actions", run: () => {} },
          { id: "d1", title: "The Garden", section: "docs", keywords: "garden", run: () => {} },
          { id: "d2", title: "Agentic coding", section: "docs", run: () => {} },
          { id: "d3", title: "JMAP", section: "docs", run: () => {} },
          { id: "c1", title: "essays", section: "collections", run: () => {} },
        ]}
      />
    </div>
  );
};
export const Palette: StoryObj = { render: () => <PaletteDemo /> };
