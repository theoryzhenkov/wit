// Test fixture: a container component (markdown slot via children).

export interface Props {
  tone: "info" | "warning";
  children?: unknown;
}

export default function Callout(_props: Props): string {
  return "";
}
