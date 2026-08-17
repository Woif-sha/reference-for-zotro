import { LEGACY_CODEX_RESPONSES_ENDPOINT } from "./model-configuration";
import {
  rejectsStructuredOutput,
  StructuredOutputUnsupportedError,
} from "./model-errors";
import {
  DEFAULT_OUTPUT_MAX_CHARACTERS,
  DEFAULT_STREAM_MAX_BYTES,
  ERROR_RESPONSE_MAX_BYTES,
  readBoundedBody,
  type ModelResponseFormat,
  type TextModelResult,
} from "./model-transport";
import { findSseFrameBoundary } from "./sse";

const CODEX_REFRESH_TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_REFRESH_TIMEOUT_MS = 30_000;
const LOGIN_REQUIRED_MESSAGE =
  "Codex 登录状态已失效或无法自动更新，请在终端运行 codex login 重新登录后再试。";

export class CodexLoginRequiredError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(LOGIN_REQUIRED_MESSAGE);
    this.name = "CodexLoginRequiredError";
    this.cause = cause;
  }
}

export interface LegacyCodexIO {
  read(path: string): Promise<Uint8Array | ArrayBuffer>;
  write(
    path: string,
    data: Uint8Array,
    options?: { tmpPath?: string },
  ): Promise<unknown>;
}

export interface LegacyCodexRuntime {
  environment(name: string): string | undefined;
  pathUtilsHome?: string;
  zoteroHome?: string;
  io: LegacyCodexIO;
  fetch: typeof fetch;
}

export type LegacyCodexRequest = Readonly<{
  model: string;
  effort?: string;
  instructions: string;
  prompt: string;
  responseFormat: ModelResponseFormat;
  signal?: AbortSignal;
  maxOutputCharacters?: number;
  maxResponseBytes?: number;
}>;

type CodexAuthDocument = {
  tokens?: {
    access_token?: unknown;
    refresh_token?: unknown;
    [key: string]: unknown;
  };
  last_refresh?: string;
  [key: string]: unknown;
};

type CodexAuthState = {
  authPath: string;
  accessToken: string;
  refreshToken: string;
  document: CodexAuthDocument;
};

type AuthRefreshJob = {
  promise: Promise<CodexAuthState>;
  controller: AbortController;
};

export class LegacyCodexTransport {
  private readonly authRefreshJobs = new Map<string, AuthRefreshJob>();
  private stopped = false;

  constructor(private readonly runtime: LegacyCodexRuntime) {}

  async run(request: LegacyCodexRequest): Promise<TextModelResult> {
    if (this.stopped) throw new Error("Legacy Codex transport is shut down");
    validateRequest(request);
    let auth = await this.loadAuth(request.signal);
    try {
      let response = await this.postRequest(request, auth.accessToken);
      if (response.status === 401) {
        await response.body?.cancel();
        auth = await this.refreshAccessToken(auth, request.signal);
        response = await this.postRequest(request, auth.accessToken);
      }
      if (response.status === 401) {
        await response.body?.cancel();
        throw new CodexLoginRequiredError(
          new Error("Codex rejected the refreshed access token with HTTP 401"),
        );
      }
      if (!response.ok) {
        const detail = await readBoundedBody(
          response,
          ERROR_RESPONSE_MAX_BYTES,
          "Codex error response",
        );
        if (
          request.responseFormat === "json_object" &&
          rejectsStructuredOutput(response.status, detail)
        ) {
          throw new StructuredOutputUnsupportedError(new Error(detail));
        }
        throw new Error(
          `Codex legacy request failed: ${response.status} ${response.statusText} - ${detail}`,
        );
      }
      if (!response.body) {
        throw new Error("Codex legacy response has no streaming body");
      }
      return await readCodexStream(response, request);
    } catch (error) {
      throw redactCodexError(error, auth);
    }
  }

  async testConnection(
    model: string,
    effort: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const result = await this.run({
      model,
      effort,
      instructions: "Reply with exactly OK.",
      prompt: "Reply with exactly OK",
      responseFormat: "text",
      signal,
      maxOutputCharacters: 128,
      maxResponseBytes: 64_000,
    });
    return result.text.trim();
  }

  shutdown(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const [authPath, job] of [...this.authRefreshJobs]) {
      if (this.authRefreshJobs.get(authPath) === job) {
        this.authRefreshJobs.delete(authPath);
      }
      job.controller.abort(new Error("Codex token refresh was cancelled"));
    }
  }

  private async postRequest(
    request: LegacyCodexRequest,
    accessToken: string,
  ): Promise<Response> {
    return this.runtime.fetch(LEGACY_CODEX_RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(buildLegacyCodexPayload(request)),
      signal: request.signal,
    });
  }

  private async loadAuth(signal?: AbortSignal): Promise<CodexAuthState> {
    const authPath = resolveCodexAuthPath(this.runtime);
    const document = await readAuthDocument(this.runtime.io, authPath);
    const accessToken = tokenValue(document.tokens?.access_token);
    const refreshToken = tokenValue(document.tokens?.refresh_token);
    if (!accessToken && !refreshToken) {
      throw new CodexLoginRequiredError(
        new Error("Codex auth tokens are missing"),
      );
    }
    const auth = { authPath, accessToken, refreshToken, document };
    if (accessToken) return auth;
    try {
      return await this.refreshAccessToken(auth, signal);
    } catch (error) {
      throw redactCodexError(error, auth);
    }
  }

  private async refreshAccessToken(
    auth: CodexAuthState,
    signal?: AbortSignal,
  ): Promise<CodexAuthState> {
    const active = this.authRefreshJobs.get(auth.authPath);
    if (active) return waitForSharedRefresh(active.promise, signal);
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new Error(
            `Codex token refresh exceeded ${AUTH_REFRESH_TIMEOUT_MS / 1_000} seconds`,
          ),
        ),
      AUTH_REFRESH_TIMEOUT_MS,
    );
    const promise = this.refreshAccessTokenNow(auth, controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted) throw error;
        const reason = controller.signal.reason;
        throw reason instanceof Error
          ? reason
          : new Error("Codex token refresh was cancelled");
      })
      .finally(() => {
        clearTimeout(timer);
        if (
          this.authRefreshJobs.get(auth.authPath)?.controller === controller
        ) {
          this.authRefreshJobs.delete(auth.authPath);
        }
      });
    this.authRefreshJobs.set(auth.authPath, { promise, controller });
    return waitForSharedRefresh(promise, signal);
  }

  private async refreshAccessTokenNow(
    auth: CodexAuthState,
    signal: AbortSignal,
  ): Promise<CodexAuthState> {
    const currentBeforeRequest = await readAuthDocument(
      this.runtime.io,
      auth.authPath,
    );
    assertSignalActive(signal);
    const currentAccessToken = tokenValue(
      currentBeforeRequest.tokens?.access_token,
    );
    const currentRefreshToken = tokenValue(
      currentBeforeRequest.tokens?.refresh_token,
    );
    if (
      currentAccessToken !== auth.accessToken ||
      currentRefreshToken !== auth.refreshToken
    ) {
      if (currentAccessToken && currentAccessToken !== auth.accessToken) {
        return authState(auth.authPath, currentBeforeRequest);
      }
      throw new CodexLoginRequiredError(
        new Error("Codex auth changed during token refresh"),
      );
    }
    if (!currentRefreshToken) {
      throw new CodexLoginRequiredError(
        new Error("Codex refresh token is missing"),
      );
    }

    const response = await this.runtime.fetch(CODEX_REFRESH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CODEX_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: currentRefreshToken,
      }),
      signal,
    });
    if (!response.ok) {
      const detail = await readBoundedBody(
        response,
        ERROR_RESPONSE_MAX_BYTES,
        "Codex error response",
      );
      if (refreshTokenWasRejected(response.status, detail)) {
        const currentAfterFailure = await readAuthDocument(
          this.runtime.io,
          auth.authPath,
        );
        assertSignalActive(signal);
        const changed = authStateIfAccessChanged(
          auth.authPath,
          currentAfterFailure,
          currentAccessToken,
        );
        if (changed) return changed;
        throw new CodexLoginRequiredError(
          new Error("Codex token refresh was rejected"),
        );
      }
      throw new Error(
        `Codex token refresh failed: ${response.status} ${response.statusText}`,
      );
    }

    const payload = (await response.json()) as {
      access_token?: unknown;
      refresh_token?: unknown;
    };
    assertSignalActive(signal);
    const accessToken = tokenValue(payload.access_token);
    if (!accessToken) {
      throw new CodexLoginRequiredError(
        new Error("Codex token refresh returned an empty access token"),
      );
    }

    const currentBeforeWrite = await readAuthDocument(
      this.runtime.io,
      auth.authPath,
    );
    assertSignalActive(signal);
    const accessBeforeWrite = tokenValue(
      currentBeforeWrite.tokens?.access_token,
    );
    const refreshBeforeWrite = tokenValue(
      currentBeforeWrite.tokens?.refresh_token,
    );
    if (
      accessBeforeWrite !== currentAccessToken ||
      refreshBeforeWrite !== currentRefreshToken
    ) {
      if (accessBeforeWrite && accessBeforeWrite !== currentAccessToken) {
        return authState(auth.authPath, currentBeforeWrite);
      }
      throw new CodexLoginRequiredError(
        new Error(
          "Codex auth changed during token refresh; refreshed credentials were not written",
        ),
      );
    }

    const refreshToken =
      tokenValue(payload.refresh_token) ||
      refreshBeforeWrite ||
      currentRefreshToken;
    const document: CodexAuthDocument = {
      ...currentBeforeWrite,
      tokens: {
        ...(currentBeforeWrite.tokens ?? {}),
        access_token: accessToken,
        refresh_token: refreshToken,
      },
      last_refresh: new Date().toISOString(),
    };
    assertSignalActive(signal);
    try {
      await this.runtime.io.write(
        auth.authPath,
        new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`),
        { tmpPath: `${auth.authPath}.reference-for-zotero.tmp` },
      );
    } catch (error) {
      throw new CodexLoginRequiredError(error);
    }
    return {
      authPath: auth.authPath,
      accessToken,
      refreshToken,
      document,
    };
  }
}

export function buildLegacyCodexPayload(
  request: Pick<
    LegacyCodexRequest,
    "model" | "effort" | "instructions" | "prompt" | "responseFormat"
  >,
): Record<string, unknown> {
  const effort = normalizeEffort(request.effort);
  return {
    model: request.model.trim(),
    instructions: request.instructions,
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: request.prompt }],
      },
    ],
    ...(request.responseFormat === "json_object"
      ? { text: { format: { type: "json_object" } } }
      : {}),
    store: false,
    stream: true,
    ...(effort ? { reasoning: { effort } } : {}),
  };
}

export function resolveCodexAuthPath(runtime: LegacyCodexRuntime): string {
  const codexHome = runtime.environment("CODEX_HOME")?.trim();
  if (codexHome) return joinPath(codexHome, "auth.json");
  const environmentHome =
    runtime.environment("HOME")?.trim() ||
    runtime.environment("USERPROFILE")?.trim();
  if (environmentHome) {
    return joinPath(environmentHome, ".codex", "auth.json");
  }
  const pathUtilsHome = runtime.pathUtilsHome?.trim();
  if (pathUtilsHome) return joinPath(pathUtilsHome, ".codex", "auth.json");
  const zoteroHome = runtime.zoteroHome?.trim();
  if (zoteroHome) return joinPath(zoteroHome, ".codex", "auth.json");
  throw new Error("Unable to resolve the home directory for Codex auth");
}

function normalizeEffort(value?: string): string | undefined {
  const effort = String(value ?? "").trim();
  return !effort || effort.toLowerCase() === "auto" ? undefined : effort;
}

function validateRequest(request: LegacyCodexRequest): void {
  for (const [value, label] of [
    [request.model, "model"],
    [request.instructions, "developer instructions"],
    [request.prompt, "prompt"],
  ] as const) {
    if (!value.trim()) throw new Error(`Codex ${label} is required`);
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

async function readCodexStream(
  response: Response,
  request: LegacyCodexRequest,
): Promise<TextModelResult> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parser = new CodexResponsesStreamParser(
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
          `Codex streaming response exceeded the ${maxResponseBytes}-byte limit`,
        );
      }
      parser.feed(decoder.decode(value, { stream: true }));
    }
    parser.feed(decoder.decode());
  } catch (error) {
    try {
      await reader.cancel();
    } catch (cancelError) {
      throw new AggregateError(
        [error, cancelError],
        "Codex stream parsing and cancellation both failed",
        { cause: cancelError },
      );
    }
    throw error;
  }
  return parser.finish();
}

class CodexResponsesStreamParser {
  private buffer = "";
  private text = "";
  private completed = false;

  constructor(private readonly maxOutputCharacters: number) {}

  feed(chunk: string): void {
    this.buffer += chunk;
    let boundary = findSseFrameBoundary(this.buffer);
    while (boundary) {
      this.parseFrame(this.buffer.slice(0, boundary.index));
      this.buffer = this.buffer.slice(boundary.index + boundary.length);
      if (this.completed) {
        this.buffer = "";
        return;
      }
      boundary = findSseFrameBoundary(this.buffer);
    }
  }

  finish(): TextModelResult {
    if (this.buffer.trim()) this.parseFrame(this.buffer);
    this.buffer = "";
    if (!this.completed) {
      throw new Error("Codex legacy response ended without completion");
    }
    if (!this.text.trim()) {
      throw new Error("Codex legacy response contained no assistant text");
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
      throw new Error(`Invalid Codex legacy SSE JSON: ${String(error)}`, {
        cause: error,
      });
    }
    if (!event || typeof event !== "object") {
      throw new Error("Codex legacy SSE event must be an object");
    }
    const record = event as {
      type?: unknown;
      delta?: unknown;
      error?: unknown;
      response?: unknown;
    };
    if (record.error) {
      throw new Error(
        `Codex legacy endpoint error: ${JSON.stringify(record.error)}`,
      );
    }
    if (record.type === "response.output_text.delta") {
      if (typeof record.delta !== "string") {
        throw new Error("Codex legacy output delta is not text");
      }
      this.appendText(record.delta);
      return;
    }
    if (record.type === "response.completed") {
      this.completed = true;
      if (!this.text) {
        const completedText = extractResponseText(record.response);
        if (completedText) this.appendText(completedText);
      }
      return;
    }
    if (
      record.type === "response.failed" ||
      record.type === "response.incomplete"
    ) {
      throw new Error(
        `Codex legacy response ended with ${String(record.type)}`,
      );
    }
  }

  private appendText(delta: string): void {
    if (this.text.length + delta.length > this.maxOutputCharacters) {
      throw new Error(
        `Codex visible output exceeded the ${this.maxOutputCharacters}-character limit`,
      );
    }
    this.text += delta;
  }
}

async function readAuthDocument(
  io: LegacyCodexIO,
  authPath: string,
): Promise<CodexAuthDocument> {
  let raw: Uint8Array | ArrayBuffer;
  try {
    raw = await io.read(authPath);
  } catch (error) {
    throw new CodexLoginRequiredError(
      new Error(`Cannot read Codex auth file: ${String(error)}`),
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        raw instanceof Uint8Array ? raw : new Uint8Array(raw),
      ),
    );
  } catch (error) {
    throw new CodexLoginRequiredError(
      new Error(`Codex auth file is invalid: ${String(error)}`),
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CodexLoginRequiredError(new Error("Codex auth file is invalid"));
  }
  return value as CodexAuthDocument;
}

function authState(
  authPath: string,
  document: CodexAuthDocument,
): CodexAuthState {
  return {
    authPath,
    accessToken: tokenValue(document.tokens?.access_token),
    refreshToken: tokenValue(document.tokens?.refresh_token),
    document,
  };
}

function authStateIfAccessChanged(
  authPath: string,
  document: CodexAuthDocument,
  previousAccessToken: string,
): CodexAuthState | undefined {
  const next = authState(authPath, document);
  return next.accessToken && next.accessToken !== previousAccessToken
    ? next
    : undefined;
}

function refreshTokenWasRejected(status: number, detail: string): boolean {
  if (status !== 400 && status !== 401) return false;
  return /refresh_token_reused|invalid_grant|refresh token.{0,80}(?:already been used|invalid|expired)/iu.test(
    detail,
  );
}

function assertSignalActive(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const reason = signal.reason;
  throw reason instanceof Error ? reason : new Error("Codex request aborted");
}

function waitForSharedRefresh<T>(
  job: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return job;
  if (signal.aborted) return Promise.reject(new Error("Codex request aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("Codex request aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    void job
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function redactSecrets(detail: string, auth: CodexAuthState): string {
  return [auth.accessToken, auth.refreshToken].reduce(
    (result, secret) =>
      secret ? result.split(secret).join("[TOKEN REDACTED]") : result,
    detail,
  );
}

function redactCodexError(error: unknown, auth: CodexAuthState): unknown {
  if (error instanceof StructuredOutputUnsupportedError) {
    return new StructuredOutputUnsupportedError(
      redactCodexError(error.cause, auth),
    );
  }
  if (error instanceof CodexLoginRequiredError) {
    return new CodexLoginRequiredError(redactCodexError(error.cause, auth));
  }
  if (error instanceof AggregateError) {
    return new AggregateError(
      Array.from(error.errors, (entry) => redactCodexError(entry, auth)),
      redactSecrets(error.message, auth),
    );
  }
  if (error instanceof Error) {
    const cause =
      "cause" in error && error.cause !== undefined
        ? redactCodexError(error.cause, auth)
        : undefined;
    const sanitized = new Error(
      redactSecrets(error.message, auth),
      cause === undefined ? undefined : { cause },
    );
    sanitized.name = error.name;
    return sanitized;
  }
  return redactSecrets(String(error), auth);
}

function tokenValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function joinPath(...parts: string[]): string {
  const separator = parts[0]?.includes("\\") ? "\\" : "/";
  return parts
    .map((part, index) =>
      index === 0
        ? part.replace(/[\\/]+$/u, "")
        : part.replace(/^[\\/]+|[\\/]+$/gu, ""),
    )
    .filter(Boolean)
    .join(separator);
}

function extractResponseText(response: unknown): string {
  if (!response || typeof response !== "object") return "";
  const value = response as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: unknown; text?: unknown }> }>;
  };
  if (typeof value.output_text === "string") return value.output_text;
  return (value.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter(
      (part) =>
        (part.type === "output_text" || part.type === "text") &&
        typeof part.text === "string",
    )
    .map((part) => String(part.text))
    .join("");
}
