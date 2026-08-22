// wit core kit — token-driven primitives. Import from "@/kit".
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import "./kit.css";

// ── Button ────────────────────────────────────────────────────────────

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "md" | "sm";
}

export function Button({ variant = "default", size = "md", ...rest }: ButtonProps) {
  return <button className="k-btn" data-variant={variant} data-size={size} {...rest} />;
}

// ── Input ─────────────────────────────────────────────────────────────

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`k-input ${props.className ?? ""}`} />;
}

// ── Kbd ───────────────────────────────────────────────────────────────

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="k-kbd">{children}</kbd>;
}

// ── ListRow ───────────────────────────────────────────────────────────

export interface ListRowProps {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  active?: boolean;
  focused?: boolean;
  href?: string;
  onClick?: () => void;
}

export function ListRow({ leading, title, meta, active, focused, href, onClick }: ListRowProps) {
  const body = (
    <>
      {leading}
      <span className="k-row-title">{title}</span>
      {meta !== undefined && <span className="k-row-meta">{meta}</span>}
    </>
  );
  const shared = { className: "k-row", "data-active": active, "data-focused": focused } as const;
  return href ? (
    <a href={href} {...shared} onClick={onClick}>
      {body}
    </a>
  ) : (
    <button type="button" {...shared} onClick={onClick}>
      {body}
    </button>
  );
}

// ── Dialog ────────────────────────────────────────────────────────────

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}

export function Dialog({ open, onClose, title, children, actions }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="k-dialog"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // backdrop click
      }}
    >
      <div className="k-dialog-body">
        {title && <h2 className="k-dialog-title">{title}</h2>}
        {children}
        {actions && <div className="k-dialog-actions">{actions}</div>}
      </div>
    </dialog>
  );
}

// ── Menu (context / dropdown) ─────────────────────────────────────────

export interface MenuItem {
  label: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

export function Menu({
  items,
  at,
  onClose,
}: {
  items: (MenuItem | "sep")[];
  at: { x: number; y: number };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="k-menu" style={{ left: at.x, top: at.y }}>
      {items.map((item, i) =>
        item === "sep" ? (
          <div key={i} className="k-menu-sep" />
        ) : (
          <button
            key={i}
            type="button"
            className="k-row"
            style={item.danger ? { color: "var(--danger)" } : undefined}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            <span className="k-row-title">{item.label}</span>
          </button>
        ),
      )}
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────

interface ToastItem {
  id: number;
  message: ReactNode;
  tone?: "default" | "danger";
}

const ToastContext = createContext<(message: ReactNode, tone?: "default" | "danger") => void>(
  () => {},
);

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const push = useCallback((message: ReactNode, tone: "default" | "danger" = "default") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="k-toasts">
        {toasts.map((t) => (
          <div key={t.id} className="k-toast" data-tone={t.tone}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ── Command palette (⌘K) ──────────────────────────────────────────────

export interface Command {
  id: string;
  title: string;
  section?: string;
  keywords?: string;
  kbd?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  commands,
  placeholder = "Type a command or search…",
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => `${c.title} ${c.keywords ?? ""}`.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);
  useEffect(() => setIndex(0), [query]);

  if (!open) return null;

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  let lastSection: string | undefined;
  return (
    <>
      <div className="k-palette-backdrop" onMouseDown={onClose} />
      <div className="k-palette" role="dialog" aria-label="command palette">
        <input
          ref={inputRef}
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, filtered.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter") run(filtered[index]);
          }}
        />
        <div className="k-palette-list">
          {filtered.length === 0 && <div className="k-palette-empty">No matches.</div>}
          {filtered.map((c, i) => {
            const section = c.section !== lastSection ? c.section : undefined;
            lastSection = c.section;
            return (
              <div key={c.id}>
                {section && <div className="k-palette-section">{section}</div>}
                <ListRow
                  title={c.title}
                  meta={c.kbd ? <Kbd>{c.kbd}</Kbd> : undefined}
                  focused={i === index}
                  onClick={() => run(c)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
