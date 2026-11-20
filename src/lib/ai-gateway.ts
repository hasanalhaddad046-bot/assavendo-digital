// AI Gateway côté serveur : routage par tâche, secours, anonymisation.
// Jamais sur le chemin du checkout ; une panne IA ne bloque rien.
// Les modèles se règlent par variables d'environnement : ASV_MODEL_<PROVIDER>.

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

export async function chat(task: Task, messages: ChatMessage[]) {
  const safe = messages.map((m) => ({ ...m, content: redact(m.content) }));
  for (const p of ROUTES[task]) {
    const cfg = PROVIDERS[p];
    const key = process.env[cfg.keyEnv];
    const model = process.env[cfg.modelEnv];
    if (!key || !model) continue;
    try {
      const r = await fetch(cfg.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: safe, max_tokens: 800 }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) continue;
      const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
      const text = j.choices?.[0]?.message?.content;
      if (text) return { text, provider: p, model };
    } catch {
      continue;
    }
  }
  return null; // repli sans IA
}
