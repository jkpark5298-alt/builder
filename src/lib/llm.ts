/** OpenAI-compatible chat helpers (OPENAI_API_KEY). */

export function hasLlm(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function parseJsonLoose<T>(raw: string): T | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim()) as T;
      } catch {
        /* continue */
      }
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function chatJson<T>(
  system: string,
  user: string,
  opts?: { maxTokens?: number; temperature?: number; timeoutMs?: number }
): Promise<T | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error("[llm] OPENAI_API_KEY 없음");
    return null;
  }
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 90_000),
    body: JSON.stringify({
      model,
      temperature: opts?.temperature ?? 0.25,
      max_tokens: opts?.maxTokens ?? 8_000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[llm] JSON error", res.status, err.slice(0, 400));
    throw new Error(`LLM error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;
  return parseJsonLoose<T>(content);
}

export async function chatText(
  system: string,
  user: string,
  opts?: { maxTokens?: number; temperature?: number; timeoutMs?: number }
): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error("[llm] OPENAI_API_KEY 없음");
    return null;
  }
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 90_000),
    body: JSON.stringify({
      model,
      temperature: opts?.temperature ?? 0.3,
      max_tokens: opts?.maxTokens ?? 8_000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[llm] text error", res.status, err.slice(0, 400));
    throw new Error(`LLM error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  return content || null;
}
