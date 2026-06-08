// Dark technical dashboard theme tokens.

export const theme = {
  bg: "#0B0E14",
  bgPanel: "#11161F",
  bgPanelHi: "#161D29",
  border: "#1F2937",
  borderHi: "#2A3647",
  text: "#E5EAF2",
  textDim: "#8A97A8",
  textFaint: "#566173",
  accent: "#2DD4BF", // teal — scan / AI
  accentDim: "#176B61",
  amber: "#F5A524",
  red: "#F0506E",
  redDeep: "#C0334E",
  green: "#3DD68C",
  mono: '"SF Mono", "JetBrains Mono", "Fira Code", ui-monospace, Menlo, monospace',
  sans: '-apple-system, "Inter", "Helvetica Neue", system-ui, sans-serif',
} as const;

export const severityColor = (sev: "high" | "medium" | "low"): string =>
  sev === "high" ? theme.red : sev === "medium" ? theme.amber : theme.textDim;
