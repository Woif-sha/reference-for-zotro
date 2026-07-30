import { ProviderError, type ProviderName, type ProviderPorts } from "./types";

const RETRYABLE_5XX = new Set([500, 502, 503, 504]);
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export async function getJson(
  source: ProviderName,
  url: string,
  ports: ProviderPorts,
  signal?: AbortSignal,
): Promise<unknown> {
  let attempt = 0;
  while (true) {
    let response: Response;
    try {
      response = await ports.fetch(url, {
        headers: { Accept: "application/json" },
        signal,
      });
    } catch (error) {
      if (attempt >= 2) {
        throw new ProviderError(
          source,
          "source-unavailable",
          `${source} request failed: ${errorMessage(error)}`,
        );
      }
      await ports.scheduler.sleep(2 ** attempt * 1000, signal);
      attempt += 1;
      continue;
    }

    if (response.ok) {
      const declaredLength = Number(response.headers.get("Content-Length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_RESPONSE_BYTES
      ) {
        throw new ProviderError(
          source,
          "provider-response-too-large",
          `${source} response exceeds ${MAX_RESPONSE_BYTES} bytes`,
          response.status,
        );
      }
      try {
        const text = await response.text();
        if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
          throw new ProviderError(
            source,
            "provider-response-too-large",
            `${source} response exceeds ${MAX_RESPONSE_BYTES} bytes`,
            response.status,
          );
        }
        return JSON.parse(text) as unknown;
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError(
          source,
          "provider-contract-error",
          `${source} returned invalid JSON: ${errorMessage(error)}`,
          response.status,
        );
      }
    }
    if (response.status === 404) {
      throw new ProviderError(source, "no-candidate", "Record not found", 404);
    }
    if (response.status === 400 || response.status === 422) {
      throw new ProviderError(
        source,
        "invalid-provider-query",
        "Provider rejected the query",
        response.status,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(
        source,
        "source-access-denied",
        "Provider denied access",
        response.status,
      );
    }
    if (response.status === 429) {
      if (attempt >= 2) {
        throw new ProviderError(
          source,
          "rate-limited",
          "Provider rate limit persisted after retries",
          429,
        );
      }
      await ports.scheduler.sleep(
        retryDelay(response, attempt, ports.clock.now().getTime()),
        signal,
      );
      attempt += 1;
      continue;
    }
    if (RETRYABLE_5XX.has(response.status)) {
      if (attempt >= 2) {
        throw new ProviderError(
          source,
          "source-unavailable",
          "Provider remained unavailable after retries",
          response.status,
        );
      }
      await ports.scheduler.sleep(2 ** attempt * 1000, signal);
      attempt += 1;
      continue;
    }
    if (response.status >= 500) {
      if (attempt === 0) {
        await ports.scheduler.sleep(1000, signal);
        attempt += 1;
        continue;
      }
      throw new ProviderError(
        source,
        "provider-failure",
        "Provider returned a server error",
        response.status,
      );
    }
    throw new ProviderError(
      source,
      "provider-failure",
      "Provider returned an unexpected HTTP status",
      response.status,
    );
  }
}

function retryDelay(
  response: Response,
  attempt: number,
  nowMilliseconds: number,
): number {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - nowMilliseconds);
  }
  return 2 ** (attempt + 1) * 1000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
