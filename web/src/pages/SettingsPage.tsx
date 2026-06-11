import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CloudIcon, CpuIcon, RotateCcwIcon, SaveIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { HealthChip } from "@/components/HealthChip";
import {
  getSettings,
  listOpenRouterModels,
  resetLlmSettings,
  updateLlmSettings,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  LlmConfigSource,
  LlmProvider,
  LlmSettings,
  OpenRouterModel,
} from "@/lib/types";

const SOURCE_LABEL: Record<LlmConfigSource, string> = {
  database: "settings saved from this UI",
  env: "the server's .env file",
  default: "the built-in default (local model)",
};

const PROVIDER_OPTIONS: Array<{
  value: LlmProvider;
  label: string;
  description: string;
  icon: typeof CpuIcon;
}> = [
  {
    value: "lmstudio",
    label: "LM Studio (local)",
    description: "Vision model served by LM Studio on this machine.",
    icon: CpuIcon,
  },
  {
    value: "openrouter",
    label: "OpenRouter (hosted)",
    description: "Hosted models via openrouter.ai — needs an API key.",
    icon: CloudIcon,
  },
];

/** Server errors arrive as JSON ({ error, message }); show just the message. */
function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string };
    return parsed.message ?? parsed.error ?? raw;
  } catch {
    return raw;
  }
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state, seeded from the loaded settings.
  const [provider, setProvider] = useState<LlmProvider>("lmstudio");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  // OpenRouter vision-model catalog for the model field's autocomplete.
  const [models, setModels] = useState<OpenRouterModel[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);

  function applySettings(next: LlmSettings) {
    setSettings(next);
    setProvider(next.provider);
    // Prefill the OpenRouter model even while LM Studio is active, so
    // switching providers shows what would be used.
    setModel(
      next.provider === "openrouter"
        ? next.model
        : (next.saved?.openrouterModel ?? next.env.openrouterModel ?? ""),
    );
  }

  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((data) => {
        if (!cancelled) applySettings(data.llm);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch the catalog once, the first time OpenRouter is selected.
  useEffect(() => {
    if (provider !== "openrouter" || models !== null) return;
    let cancelled = false;
    listOpenRouterModels()
      .then((list) => {
        if (!cancelled) {
          setModels(list);
          setModelsError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setModels([]);
          setModelsError(errorMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [provider, models]);

  // A key saved earlier or defined in .env can be reused without retyping.
  const hasExistingKey =
    !!settings &&
    (settings.saved?.hasOpenrouterApiKey || settings.env.hasOpenrouterApiKey);

  async function handleSave() {
    if (provider === "openrouter" && !apiKey.trim() && !hasExistingKey) {
      toast.error("An OpenRouter API key is required", {
        description: "Get one at openrouter.ai/keys and paste it above.",
      });
      return;
    }
    setSaving(true);
    try {
      const next = await updateLlmSettings({
        provider,
        ...(provider === "openrouter" && apiKey.trim()
          ? { openrouterApiKey: apiKey.trim() }
          : {}),
        ...(provider === "openrouter" && model.trim()
          ? { openrouterModel: model.trim() }
          : {}),
      });
      applySettings(next.llm);
      setApiKey("");
      toast.success("Settings saved", {
        description:
          next.llm.provider === "openrouter"
            ? `AI triage now uses OpenRouter · ${next.llm.model}`
            : "AI triage now uses the local LM Studio model.",
      });
    } catch (err) {
      toast.error("Could not save settings", {
        description: errorMessage(err),
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      const next = await resetLlmSettings();
      applySettings(next.llm);
      setApiKey("");
      toast.success("Saved settings cleared", {
        description: `Now using ${SOURCE_LABEL[next.llm.source]}.`,
      });
    } catch (err) {
      toast.error("Could not clear settings", {
        description: errorMessage(err),
      });
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Choose the AI backend used for vision triage. Settings saved here
            persist in a server-side database and override the .env file;
            without either, a locally running LM Studio model is used.
          </p>
        </div>
        <HealthChip />
      </header>

      {loadError ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Could not load settings: {loadError}
          </CardContent>
        </Card>
      ) : !settings ? (
        <Card>
          <CardContent className="flex flex-col gap-3 py-6">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>AI backend</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2">
              <span>Active:</span>
              <Badge variant="secondary" className="font-mono">
                {settings.provider === "openrouter" ? "openrouter" : "lmstudio"}
                {" · "}
                {settings.model}
              </Badge>
              <span>from {SOURCE_LABEL[settings.source]}</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-3 sm:grid-cols-2">
                {PROVIDER_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const isActive = provider === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setProvider(opt.value)}
                      aria-pressed={isActive}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
                        isActive
                          ? "border-primary/40 bg-primary/10"
                          : "border-border bg-transparent hover:bg-muted",
                      )}
                    >
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium">{opt.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {opt.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {provider === "openrouter" ? (
                <div className="grid gap-5 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="or-key">OpenRouter API key</FieldLabel>
                    <Input
                      id="or-key"
                      type="password"
                      autoComplete="off"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={
                        settings.apiKeyMasked ??
                        (hasExistingKey ? "(key configured)" : "sk-or-v1-…")
                      }
                      className="font-mono text-xs"
                    />
                    <FieldDescription>
                      {hasExistingKey
                        ? "A key is already configured — leave blank to keep it."
                        : "Get a key at openrouter.ai/keys. Stored server-side only."}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="or-model">Model</FieldLabel>
                    <Input
                      id="or-model"
                      list="openrouter-vision-models"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="google/gemini-2.5-flash"
                      className="font-mono text-xs"
                    />
                    <datalist id="openrouter-vision-models">
                      {(models ?? []).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </datalist>
                    <FieldDescription>
                      {models === null ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Spinner className="size-3" />
                          Loading vision-capable models…
                        </span>
                      ) : modelsError ? (
                        `Could not load the model catalog (${modelsError}) — enter a model slug manually.`
                      ) : (
                        `${models.length} vision-capable models available — type to search, or enter any slug.`
                      )}
                    </FieldDescription>
                  </Field>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Uses the LM Studio server configured on the backend via{" "}
                  <span className="font-mono text-xs">LMSTUDIO_BASE_URL</span>{" "}
                  (default{" "}
                  <span className="font-mono text-xs">
                    http://localhost:1234/v1
                  </span>
                  ). Make sure a vision-capable model is loaded in LM Studio.
                </p>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Precedence: saved settings → .env → local default.
                </p>
                <div className="flex items-center gap-2">
                  {settings.saved ? (
                    <Button
                      variant="outline"
                      onClick={() => void handleReset()}
                      disabled={saving || resetting}
                    >
                      <RotateCcwIcon data-icon="inline-start" />
                      {resetting ? "Clearing…" : "Clear saved settings"}
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => void handleSave()}
                    disabled={saving || resetting}
                  >
                    <SaveIcon data-icon="inline-start" />
                    {saving ? "Saving…" : "Save settings"}
                  </Button>
                </div>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
