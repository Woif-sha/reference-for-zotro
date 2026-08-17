export type ModelResponseFormat = "text" | "json_object";

export type TextModelResult = Readonly<{ text: string }>;

export type OpenAICompatibleRequest = Readonly<{
  endpoint: string;
  apiKey: string;
  model: string;
  instructions: string;
  prompt: string;
  responseFormat: ModelResponseFormat;
  signal?: AbortSignal;
  maxOutputCharacters?: number;
  maxResponseBytes?: number;
  fetch?: typeof fetch;
}>;

const ERROR_RESPONSE_MAX_BYTES = 64 * 1024;
const DEFAULT_STREAM_MAX_BYTES = 128 * 1024;
const DEFAULT_OUTPUT_MAX_CHARACTERS = 32_768;

export class OpenAICompatibleStreamParser {
  private buffer = "";
  private text = "";
  private completed = false;

  constructor(
    private readonly maxOutputCharacters = DEFAULT_OUTPUT_MAX_CHARACTERS,
  ) {}

  get isComplete(): boolean {
    return this.completed;
  }

  feed(chunk: string): void {
    this.buffer += chunk;
    let boundary = findSseFrameBoundary(this.buffer);
    while (boundary) {
      this.parseFrame(this.buffer.slice(0, boundary.index));
      this.buffer = this.buffer.slice(boundary.index + boundary.length);
      boundary = findSseFrameBoundary(this.buffer);
    }
  }

  finish(): TextModelResult {
    if (this.buffer.trim()) this.parseFrame(this.buffer);
    this.buffer = "";
    if (!this.completed) {
      throw new Error(
        "OpenAI Compatible streaming response ended without [DONE]",
      );
    }
    if (!this.text.trim()) {
      throw new Error("OpenAI Compatible response contained no assistant text");
    }
    return { text: this.text };
  }

  private parseFrame(frame: string): void {
    const payload = frame
      .split(/\r\n|\r|\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!payload) return;
    if (payload === "[DONE]") {
      this.completed = true;
      return;
    }
    let event: unknown;
    try {
      event = JSON.parse(payload);
    } catch (error) {
      throw new Error(`Invalid OpenAI Compatible SSE JSON: ${String(error)}`, {
        cause: error,
      });
    }
    if (!event || typeof event !== "object") {
      throw new Error("OpenAI Compatible SSE event must be an object");
    }
    const record = event as {
      error?: unknown;
      choices?: Array<{ delta?: { content?: unknown } }>;
    };
    if (record.error) {
      throw new Error(
        `OpenAI Compatible endpoint error: ${JSON.stringify(record.error)}`,
      );
    }
    const delta = record.choices?.[0]?.delta?.content;
    if (delta === undefined || delta === null || delta === "") return;
    if (typeof delta !== "string") {
      throw new Error("OpenAI Compatible output delta is not text");
    }
    if (this.text.length + delta.length > this.maxOutputCharacters) {
      throw new Error(
        `OpenAI Compatible visible output exceeded the ${this.maxOutputCharacters}-character limit`,
      );
    }
    this.text += delta;
  }
}

export function buildOpenAICompatiblePayload(
  request: Pick<
    OpenAICompatibleRequest,
    "model" | "instructions" | "prompt" | "responseFormat"
  >,
): Record<string, unknown> {
  return {
    model: request.model.trim(),
    messages: [
      { role: "system", content: request.instructions },
      { role: "user", content: request.prompt },
    ],
    ...(request.responseFormat === "json_object"
      ? { response_format: { type: "json_object" } }
      : {}),
    stream: true,
  };
}

export async function runOpenAICompatibleRequest(
  request: OpenAICompatibleRequest,
): Promise<TextModelResult> {
  validateRequest(request);
  try {
    return await runValidatedRequest(request);
  } catch (error) {
    throw redactError(error, request.apiKey);
  }
}

export async function testOpenAICompatibleConnection(
  request: Readonly<{
    endpoint: string;
    apiKey: string;
    model: string;
    signal?: AbortSignal;
    fetch?: typeof fetch;
  }>,
): Promise<string> {
  const result = await runOpenAICompatibleRequest({
    ...request,
    instructions: "Reply with exactly OK.",
    prompt: "Reply with exactly OK",
    responseFormat: "text",
    maxOutputCharacters: 128,
    maxResponseBytes: 64_000,
  });
  return result.text.trim();
}

async function runValidatedRequest(
  request: OpenAICompatibleRequest,
): Promise<TextModelResult> {
  const response = await (request.fetch ?? fetch)(request.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${request.apiKey.trim()}`,
    },
    body: JSON.stringify(buildOpenAICompatiblePayload(request)),
    signal: request.signal,
  });
  if (!response.ok) {
    const detail = await readBoundedBody(response, ERROR_RESPONSE_MAX_BYTES);
    throw new Error(
      `OpenAI Compatible request failed: ${response.status} ${response.statusText} - ${detail}`,
    );
  }
  if (!response.body) {
    throw new Error("OpenAI Compatible response has no streaming body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parser = new OpenAICompatibleStreamParser(
    request.maxOutputCharacters ?? DEFAULT_OUTPUT_MAX_CHARACTERS,
  );
  const maxResponseBytes = request.maxResponseBytes ?? DEFAULT_STREAM_MAX_BYTES;
  let responseBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      responseBytes += value.byteLength;
      if (responseBytes > maxResponseBytes) {
        throw new Error(
          `OpenAI Compatible streaming response exceeded the ${maxResponseBytes}-byte limit`,
        );
      }
      parser.feed(decoder.decode(value, { stream: true }));
      if (parser.isComplete) {
        await reader.cancel();
        break;
      }
    }
    parser.feed(decoder.decode());
  } catch (error) {
    try {
      await reader.cancel();
    } catch (cancelError) {
      throw new AggregateError(
        [error, cancelError],
        "OpenAI Compatible stream parsing and cancellation both failed",
        { cause: cancelError },
      );
    }
    throw error;
  }
  return parser.finish();
}

function validateRequest(request: OpenAICompatibleRequest): void {
  let endpoint: URL;
  try {
    endpoint = new URL(request.endpoint);
  } catch (error) {
    throw new Error(`OpenAI Compatible endpoint is invalid: ${String(error)}`, {
      cause: error,
    });
  }
  if (
    endpoint.protocol !== "https:" ||
    !/\/chat\/completions$/iu.test(endpoint.pathname)
  ) {
    throw new Error(
      "OpenAI Compatible endpoint must be an HTTPS chat completions endpoint",
    );
  }
  for (const [value, label] of [
    [request.apiKey, "API Key"],
    [request.model, "model"],
    [request.instructions, "developer instructions"],
    [request.prompt, "prompt"],
  ] as const) {
    if (!value.trim())
      throw new Error(`OpenAI Compatible ${label} is required`);
  }
  for (const [name, value] of [
    ["maxOutputCharacters", request.maxOutputCharacters],
    ["maxResponseBytes", request.maxResponseBytes],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw new Error(
          `OpenAI Compatible error response exceeded the ${maxBytes}-byte limit`,
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    try {
      await reader.cancel();
    } catch (cancelError) {
      throw new AggregateError(
        [error, cancelError],
        "OpenAI Compatible error response and cancellation both failed",
        { cause: cancelError },
      );
    }
    throw error;
  }
}

function redactError(error: unknown, secret: string): unknown {
  const redact = (value: string): string => {
    const normalized = secret.trim();
    return normalized
      ? value.split(normalized).join("[API KEY REDACTED]")
      : value;
  };
  if (error instanceof AggregateError) {
    return new AggregateError(
      Array.from(error.errors, (entry) => redactError(entry, secret)),
      redact(error.message),
    );
  }
  if (error instanceof Error) {
    const cause =
      "cause" in error && error.cause !== undefined
        ? redactError(error.cause, secret)
        : undefined;
    const sanitized = new Error(
      redact(error.message),
      cause === undefined ? undefined : { cause },
    );
    sanitized.name = error.name;
    return sanitized;
  }
  return redact(String(error));
}

function findSseFrameBoundary(
  value: string,
): { index: number; length: number } | undefined {
  for (let index = 0; index < value.length; index += 1) {
    const first = lineEndingLength(value, index);
    if (!first) continue;
    const second = lineEndingLength(value, index + first);
    if (second) return { index, length: first + second };
    index += first - 1;
  }
  return undefined;
}

function lineEndingLength(value: string, index: number): number {
  if (value[index] === "\n") return 1;
  if (value[index] !== "\r") return 0;
  return value[index + 1] === "\n" ? 2 : 1;
}
