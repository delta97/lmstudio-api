import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ChevronDownIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HealthChip } from "@/components/HealthChip";
import { useRunStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type {
  Breakpoint,
  CompareUrlsRequest,
  UrlPair,
  WaitUntil,
} from "@/lib/types";

/** Router navigation state used by History's "re-run" to prefill this form. */
export interface SetupNavState {
  prefill?: CompareUrlsRequest;
}

interface PairRow {
  id: string;
  name: string;
  baselineUrl: string;
  currentUrl: string;
}

interface HeaderRow {
  id: string;
  key: string;
  value: string;
}

const PRESET_BREAKPOINTS: Breakpoint[] = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

const WAIT_UNTIL_OPTIONS: WaitUntil[] = [
  "load",
  "domcontentloaded",
  "networkidle",
  "commit",
];

let idCounter = 0;
const nextId = () => `id-${idCounter++}`;

function isValidUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function configToPairRows(config: CompareUrlsRequest): PairRow[] {
  if (config.pairs?.length) {
    return config.pairs.map((p) => ({
      id: nextId(),
      name: p.name ?? "",
      baselineUrl: p.baselineUrl,
      currentUrl: p.currentUrl,
    }));
  }
  if (config.baselineUrl && config.currentUrl) {
    return [
      {
        id: nextId(),
        name: "",
        baselineUrl: config.baselineUrl,
        currentUrl: config.currentUrl,
      },
    ];
  }
  return [];
}

export default function SetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { startJob } = useRunStore();
  const [starting, setStarting] = useState(false);

  // Prefill (from History "re-run") arrives once via router navigation state and
  // seeds the form's initial state — no effect / re-sync needed.
  const prefill = (location.state as SetupNavState | null)?.prefill ?? null;

  const [pairs, setPairs] = useState<PairRow[]>(() => {
    const rows = prefill ? configToPairRows(prefill) : [];
    return rows.length
      ? rows
      : [{ id: nextId(), name: "", baselineUrl: "", currentUrl: "" }];
  });
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>(() => {
    if (!prefill?.breakpoints?.length) return PRESET_BREAKPOINTS;
    const merged = [...PRESET_BREAKPOINTS];
    for (const bp of prefill.breakpoints) {
      if (!merged.some((b) => b.name === bp.name)) merged.push(bp);
    }
    return merged;
  });
  const [selected, setSelected] = useState<string[]>(() =>
    prefill?.breakpoints?.length
      ? prefill.breakpoints.map((b) => b.name)
      : ["desktop"],
  );
  const [customName, setCustomName] = useState("");
  const [customWidth, setCustomWidth] = useState("");
  const [customHeight, setCustomHeight] = useState("");

  // Advanced options.
  const [advancedOpen, setAdvancedOpen] = useState(
    () => !!(prefill?.userAgent || prefill?.headers || prefill?.context),
  );
  const [fullPage, setFullPage] = useState(() => prefill?.fullPage ?? false);
  const [headless, setHeadless] = useState(() => prefill?.headless ?? true);
  const [waitUntil, setWaitUntil] = useState<WaitUntil>(
    () => prefill?.waitUntil ?? "networkidle",
  );
  const [waitMs, setWaitMs] = useState(() =>
    typeof prefill?.waitMs === "number" ? String(prefill.waitMs) : "",
  );
  const [userAgent, setUserAgent] = useState(() => prefill?.userAgent ?? "");
  const [locale, setLocale] = useState(() => prefill?.locale ?? "");
  const [pixelThreshold, setPixelThreshold] = useState(() =>
    typeof prefill?.pixelThreshold === "number"
      ? String(prefill.pixelThreshold)
      : "",
  );
  const [maxRatio, setMaxRatio] = useState(() =>
    typeof prefill?.maxRatio === "number" ? String(prefill.maxRatio) : "",
  );
  const [context, setContext] = useState(() => prefill?.context ?? "");
  const [headers, setHeaders] = useState<HeaderRow[]>(() =>
    prefill?.headers
      ? Object.entries(prefill.headers).map(([key, value]) => ({
          id: nextId(),
          key,
          value,
        }))
      : [],
  );

  const selectedBreakpoints = useMemo(
    () => breakpoints.filter((b) => selected.includes(b.name)),
    [breakpoints, selected],
  );

  const validPairs = useMemo(
    () =>
      pairs.filter(
        (p) => isValidUrl(p.baselineUrl) && isValidUrl(p.currentUrl),
      ),
    [pairs],
  );

  const captureCount = validPairs.length * selectedBreakpoints.length;

  function updatePair(id: string, patch: Partial<PairRow>) {
    setPairs((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  }

  function addPair() {
    setPairs((prev) => [
      ...prev,
      { id: nextId(), name: "", baselineUrl: "", currentUrl: "" },
    ]);
  }

  function removePair(id: string) {
    setPairs((prev) => (prev.length > 1 ? prev.filter((p) => p.id !== id) : prev));
  }

  function toggleBreakpoint(name: string) {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }

  function addCustomBreakpoint() {
    const width = Number(customWidth);
    const height = Number(customHeight);
    const name =
      customName.trim() || `${width}×${height}`;
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      toast.error("Custom breakpoint needs positive width and height.");
      return;
    }
    if (breakpoints.some((b) => b.name === name)) {
      toast.error(`A breakpoint named "${name}" already exists.`);
      return;
    }
    setBreakpoints((prev) => [...prev, { name, width, height }]);
    setSelected((prev) => [...prev, name]);
    setCustomName("");
    setCustomWidth("");
    setCustomHeight("");
  }

  function buildConfig(): CompareUrlsRequest | null {
    if (validPairs.length === 0) {
      toast.error("Add at least one pair with valid baseline and current URLs.");
      return null;
    }
    if (selectedBreakpoints.length === 0) {
      toast.error("Select at least one breakpoint.");
      return null;
    }

    const requestPairs: UrlPair[] = validPairs.map((p) => ({
      ...(p.name.trim() ? { name: p.name.trim() } : {}),
      baselineUrl: p.baselineUrl.trim(),
      currentUrl: p.currentUrl.trim(),
    }));

    const config: CompareUrlsRequest = {
      pairs: requestPairs,
      breakpoints: selectedBreakpoints,
      fullPage,
      headless,
      waitUntil,
    };

    const waitMsNum = Number(waitMs);
    if (waitMs.trim() && Number.isFinite(waitMsNum) && waitMsNum >= 0)
      config.waitMs = Math.floor(waitMsNum);
    if (userAgent.trim()) config.userAgent = userAgent.trim();
    if (locale.trim()) config.locale = locale.trim();

    const ptNum = Number(pixelThreshold);
    if (pixelThreshold.trim() && Number.isFinite(ptNum))
      config.pixelThreshold = ptNum;
    const mrNum = Number(maxRatio);
    if (maxRatio.trim() && Number.isFinite(mrNum)) config.maxRatio = mrNum;
    if (context.trim()) config.context = context.trim();

    const headerEntries = headers.filter((h) => h.key.trim());
    if (headerEntries.length) {
      config.headers = Object.fromEntries(
        headerEntries.map((h) => [h.key.trim(), h.value]),
      );
    }

    return config;
  }

  async function handleRun() {
    const config = buildConfig();
    if (!config) return;
    setStarting(true);
    try {
      // The job runs server-side; more comparisons can be started while it
      // does, and they all stream on the Live Runs screen.
      await startJob(config);
      navigate("/run");
    } catch (err) {
      toast.error("Could not start comparison", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            New comparison
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Configure URL pairs, breakpoints, and capture options, then start a
            visual-regression run.
          </p>
        </div>
        <HealthChip />
      </header>

      {/* URL pairs */}
      <Card>
        <CardHeader>
          <CardTitle>URL pairs</CardTitle>
          <CardDescription>
            Each pair compares a baseline against a current URL. localhost URLs
            are accepted.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {pairs.map((pair, i) => (
            <div
              key={pair.id}
              className="flex flex-col gap-3 rounded-lg border border-border p-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-muted-foreground">
                  pair {i + 1}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removePair(pair.id)}
                  disabled={pairs.length === 1}
                  aria-label={`Remove pair ${i + 1}`}
                >
                  <Trash2Icon />
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_10rem]">
                <Field>
                  <FieldLabel htmlFor={`${pair.id}-baseline`}>
                    Baseline URL
                  </FieldLabel>
                  <Input
                    id={`${pair.id}-baseline`}
                    value={pair.baselineUrl}
                    onChange={(e) =>
                      updatePair(pair.id, { baselineUrl: e.target.value })
                    }
                    placeholder="https://example.com"
                    aria-invalid={
                      pair.baselineUrl.length > 0 &&
                      !isValidUrl(pair.baselineUrl)
                    }
                    className="font-mono text-xs"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${pair.id}-current`}>
                    Current URL
                  </FieldLabel>
                  <Input
                    id={`${pair.id}-current`}
                    value={pair.currentUrl}
                    onChange={(e) =>
                      updatePair(pair.id, { currentUrl: e.target.value })
                    }
                    placeholder="http://localhost:3000"
                    aria-invalid={
                      pair.currentUrl.length > 0 && !isValidUrl(pair.currentUrl)
                    }
                    className="font-mono text-xs"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${pair.id}-name`}>
                    Name <span className="text-muted-foreground">(opt)</span>
                  </FieldLabel>
                  <Input
                    id={`${pair.id}-name`}
                    value={pair.name}
                    onChange={(e) =>
                      updatePair(pair.id, { name: e.target.value })
                    }
                    placeholder="home"
                  />
                </Field>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addPair} className="w-fit">
            <PlusIcon data-icon="inline-start" />
            Add pair
          </Button>
        </CardContent>
      </Card>

      {/* Breakpoints */}
      <Card>
        <CardHeader>
          <CardTitle>Breakpoints</CardTitle>
          <CardDescription>
            Each selected breakpoint is captured for every pair.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {breakpoints.map((bp) => {
              const isActive = selected.includes(bp.name);
              return (
                <button
                  key={bp.name}
                  type="button"
                  onClick={() => toggleBreakpoint(bp.name)}
                  aria-pressed={isActive}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
                    isActive
                      ? "border-primary/40 bg-primary/10"
                      : "border-border bg-transparent hover:bg-muted",
                  )}
                >
                  <span className="text-sm font-medium capitalize">
                    {bp.name}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {bp.width}×{bp.height}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field className="w-28">
              <FieldLabel htmlFor="bp-name">Custom name</FieldLabel>
              <Input
                id="bp-name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="wide"
              />
            </Field>
            <Field className="w-24">
              <FieldLabel htmlFor="bp-width">Width</FieldLabel>
              <Input
                id="bp-width"
                type="number"
                value={customWidth}
                onChange={(e) => setCustomWidth(e.target.value)}
                placeholder="1920"
                className="font-mono"
              />
            </Field>
            <Field className="w-24">
              <FieldLabel htmlFor="bp-height">Height</FieldLabel>
              <Input
                id="bp-height"
                type="number"
                value={customHeight}
                onChange={(e) => setCustomHeight(e.target.value)}
                placeholder="1080"
                className="font-mono"
              />
            </Field>
            <Button variant="outline" size="sm" onClick={addCustomBreakpoint}>
              <PlusIcon data-icon="inline-start" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Advanced */}
      <Card>
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CardHeader>
            <CollapsibleTrigger
              render={
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 text-left"
                />
              }
            >
              <div className="flex flex-col gap-1">
                <CardTitle>Advanced options</CardTitle>
                <CardDescription>
                  Capture, browser, and diff-threshold overrides.
                </CardDescription>
              </div>
              <ChevronDownIcon
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  advancedOpen && "rotate-180",
                )}
              />
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              <FieldGroup>
                <div className="grid gap-5 md:grid-cols-2">
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor="fullPage">Full page</FieldLabel>
                    <Switch
                      id="fullPage"
                      checked={fullPage}
                      onCheckedChange={setFullPage}
                    />
                  </Field>
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor="headless">Headless</FieldLabel>
                    <Switch
                      id="headless"
                      checked={headless}
                      onCheckedChange={setHeadless}
                    />
                  </Field>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="waitUntil">Wait until</FieldLabel>
                    <Select
                      value={waitUntil}
                      onValueChange={(v) => setWaitUntil(v as WaitUntil)}
                    >
                      <SelectTrigger id="waitUntil" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WAIT_UNTIL_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="waitMs">Extra wait (ms)</FieldLabel>
                    <Input
                      id="waitMs"
                      type="number"
                      value={waitMs}
                      onChange={(e) => setWaitMs(e.target.value)}
                      placeholder="0"
                      className="font-mono"
                    />
                  </Field>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="pixelThreshold">
                      Pixel threshold
                    </FieldLabel>
                    <Input
                      id="pixelThreshold"
                      type="number"
                      step="0.001"
                      value={pixelThreshold}
                      onChange={(e) => setPixelThreshold(e.target.value)}
                      placeholder="server default"
                      className="font-mono"
                    />
                    <FieldDescription>
                      Ratio ≤ threshold passes on pixels alone (0–1).
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="maxRatio">Max ratio</FieldLabel>
                    <Input
                      id="maxRatio"
                      type="number"
                      step="0.001"
                      value={maxRatio}
                      onChange={(e) => setMaxRatio(e.target.value)}
                      placeholder="1"
                      className="font-mono"
                    />
                    <FieldDescription>
                      Ratio ≥ this fails without asking the model (0–1).
                    </FieldDescription>
                  </Field>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="userAgent">User-Agent</FieldLabel>
                    <Input
                      id="userAgent"
                      value={userAgent}
                      onChange={(e) => setUserAgent(e.target.value)}
                      placeholder="default desktop Chrome"
                      className="font-mono text-xs"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="locale">Locale</FieldLabel>
                    <Input
                      id="locale"
                      value={locale}
                      onChange={(e) => setLocale(e.target.value)}
                      placeholder="en-US"
                      className="font-mono"
                    />
                  </Field>
                </div>

                <Field>
                  <FieldLabel htmlFor="context">Context hint</FieldLabel>
                  <Input
                    id="context"
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder="e.g. the header clock is dynamic; ignore it"
                  />
                  <FieldDescription>
                    Free-form hint passed to the vision model.
                  </FieldDescription>
                </Field>

                <Separator />

                <Field>
                  <FieldLabel>Custom headers</FieldLabel>
                  <FieldDescription>
                    Sent with every request (e.g. cookies, auth tokens).
                  </FieldDescription>
                  <div className="flex flex-col gap-2">
                    {headers.map((h, i) => (
                      <div key={h.id} className="flex items-center gap-2">
                        <Input
                          value={h.key}
                          onChange={(e) =>
                            setHeaders((prev) =>
                              prev.map((x) =>
                                x.id === h.id
                                  ? { ...x, key: e.target.value }
                                  : x,
                              ),
                            )
                          }
                          placeholder="Header-Name"
                          aria-label={`Header ${i + 1} name`}
                          className="font-mono text-xs"
                        />
                        <Input
                          value={h.value}
                          onChange={(e) =>
                            setHeaders((prev) =>
                              prev.map((x) =>
                                x.id === h.id
                                  ? { ...x, value: e.target.value }
                                  : x,
                              ),
                            )
                          }
                          placeholder="value"
                          aria-label={`Header ${i + 1} value`}
                          className="font-mono text-xs"
                        />
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() =>
                            setHeaders((prev) =>
                              prev.filter((x) => x.id !== h.id),
                            )
                          }
                          aria-label={`Remove header ${i + 1}`}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-fit"
                      onClick={() =>
                        setHeaders((prev) => [
                          ...prev,
                          { id: nextId(), key: "", value: "" },
                        ])
                      }
                    >
                      <PlusIcon data-icon="inline-start" />
                      Add header
                    </Button>
                  </div>
                </Field>
              </FieldGroup>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Run bar */}
      <div className="sticky bottom-0 flex flex-col gap-3 border-t border-border bg-background/80 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary" className="font-mono">
            {validPairs.length} {validPairs.length === 1 ? "pair" : "pairs"}
          </Badge>
          <span>×</span>
          <Badge variant="secondary" className="font-mono">
            {selectedBreakpoints.length}{" "}
            {selectedBreakpoints.length === 1 ? "breakpoint" : "breakpoints"}
          </Badge>
          <span>=</span>
          <Badge variant="outline" className="font-mono">
            {captureCount} captures
          </Badge>
          <span className="text-xs">· up to {captureCount} AI reviews</span>
        </div>
        <Button
          size="lg"
          onClick={() => void handleRun()}
          disabled={captureCount === 0 || starting}
        >
          <PlayIcon data-icon="inline-start" />
          {starting ? "Starting…" : "Run comparison"}
        </Button>
      </div>
    </div>
  );
}
