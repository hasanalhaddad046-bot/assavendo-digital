// AI Gateway côté serveur : routage par tâche, secours, anonymisation et suivi des coûts.
// Jamais sur le chemin du checkout ; une panne IA ne bloque rien.
// Les modèles se règlent par variables d'environnement : ASV_MODEL_<PROVIDER>.
import { supabaseAdmin } from "./supabase";
import { estimateAiCostUsdMicro } from "./ai-usage";

type Provider = "groq" | "openrouter" | "deepseek";
type Task = "quick_reply" | "catalog" | "analysis" | "bulk_text";

const PROVIDERS: Record<Provider, { url: string; keyEnv: string; modelEnv: string }> = {
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", keyEnv: "ASV_KEY_GROQ", modelEnv: "ASV_MODEL_GROQ" },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", keyEnv: "ASV_KEY_OPENROUTER", modelEnv: "ASV_MODEL_OPENROUTER" },
  deepseek: { url: "https://api.deepseek.com/chat/completions", keyEnv: "ASV_KEY_DEEPSEEK", modelEnv: "ASV_MODEL_DEEPSEEK" },
};

const ROUTES: Record<Task, Provider[]> = {
  quick_reply: ["groq", "openrouter"],
  catalog: ["openrouter", "deepseek"],
  analysis: ["deepseek", "openrouter"],
  bulk_text: ["openrouter", "deepseek"],
};

/** Masque e-mails et numéros de téléphone avant envoi à un modèle externe. */
export function redact(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[tel]");
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function recordUsage(input: {
  provider: Provider;
  model: string;
  task: Task;
  tokensInput: number;
  tokensOutput: number;
  latencyMs: number;
  succeeded: boolean;
  fallbackFrom: string | null;
  requestId: string | null;
  errorCode?: string | null;
}): Promise<void> {
  try {
    const db = supabaseAdmin();
    const { data: pricing } = await db.from("ai_models")
      .select("input_cost_per_million,output_cost_per_million")
      .eq("provider", input.provider)
      .eq("model_key", input.model)
      .eq("enabled", true)
      .maybeSingle();

    const hasUsage = input.tokensInput + input.tokensOutput > 0;
    const cost = hasUsage
      ? estimateAiCostUsdMicro(
          input.tokensInput,
          input.tokensOutput,
          pricing?.input_cost_per_million,
          pricing?.output_cost_per_million,
        )
      : null;

    await db.from("ai_usage_records").insert({
      provider: input.provider,
      model_key: input.model,
      task: input.task,
      tokens_input: input.tokensInput,
      tokens_output: input.tokensOutput,
      cost_usd_micro: cost ?? 0,
      cost_known: cost !== null,
      latency_ms: Math.max(0, Math.round(input.latencyMs)),
      succeeded: input.succeeded,
      fallback_from: input.fallbackFrom,
      request_id: input.requestId,
      error_code: input.errorCode?.slice(0, 100) ?? null,
    });
  } catch (error) {
    // Usage logging is best-effort: it must never block customer or admin responses.
    console.error("AI usage logging unavailable", error);
  }
}

export async function chat(task: Task, messages: ChatMessage[]) {
  const safe = messages.map((message) => ({ ...message, content: redact(message.content) }));
  let fallbackFrom: Provider | null = null;

  for (const provider of ROUTES[task]) {
    const config = PROVIDERS[provider];
    const key = process.env[config.keyEnv];
    const model = process.env[config.modelEnv];
    if (!key || !model) continue;

    const startedAt = Date.now();
    try {
      const headers: Record<string, string> = {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      };
      if (provider === "openrouter") {
        headers["HTTP-Referer"] = process.env.NEXT_PUBLIC_SITE_URL ?? "https://assavendo-shop.vercel.app";
        headers["X-Title"] = "Assavendo Digital";
      }

      const response = await fetch(config.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, messages: safe, max_tokens: 800 }),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
      const latencyMs = Date.now() - startedAt;

      if (!response.ok) {
        await recordUsage({
          provider, model, task, tokensInput: 0, tokensOutput: 0,
          latencyMs, succeeded: false, fallbackFrom,
          requestId: response.headers.get("x-request-id"),
          errorCode: "http_" + response.status,
        });
        fallbackFrom = provider;
        continue;
      }

      const payload = await response.json() as {
        id?: string;
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const answer = payload.choices?.[0]?.message?.content;
      const inputTokens = Number.isSafeInteger(payload.usage?.prompt_tokens) ? Number(payload.usage?.prompt_tokens) : 0;
      const outputTokens = Number.isSafeInteger(payload.usage?.completion_tokens) ? Number(payload.usage?.completion_tokens) : 0;

      await recordUsage({
        provider, model, task, tokensInput: inputTokens, tokensOutput: outputTokens,
        latencyMs, succeeded: Boolean(answer), fallbackFrom,
        requestId: payload.id ?? response.headers.get("x-request-id"),
        errorCode: answer ? null : "empty_model_response",
      });

      if (answer) return { text: answer, provider, model };
      fallbackFrom = provider;
    } catch (error) {
      await recordUsage({
        provider, model, task, tokensInput: 0, tokensOutput: 0,
        latencyMs: Date.now() - startedAt, succeeded: false, fallbackFrom,
        requestId: null,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
      fallbackFrom = provider;
    }
  }

  return null; // Repli sans IA
}
