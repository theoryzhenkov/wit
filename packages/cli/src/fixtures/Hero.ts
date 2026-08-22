// Test fixture: a component with a documented Props contract.

/** A full-width hero image. */
export interface Props {
  /** Image source path. */
  src: string;
  /** Alternative text. @default "" */
  alt?: string;
  /** Visual tone. */
  tone?: "warm" | "cool" | "mono";
  width?: number;
  featured?: boolean;
  /** Arbitrary metadata — not formable. */
  meta?: { author: string };
}

export default function Hero(_props: Props): string {
  return "";
}
