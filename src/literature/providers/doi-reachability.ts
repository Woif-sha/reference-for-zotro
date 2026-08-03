import type { ProviderPorts } from "./types";

export type ReachabilityResult =
  | Readonly<{ status: "reachable"; landingURL: string }>
  | Readonly<{ status: "unreachable"; code: "unreachable-landing-page" }>;

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export async function verifyDoiLandingPage(
  doi: string,
  ports: ProviderPorts,
  signal?: AbortSignal,
): Promise<ReachabilityResult> {
  const resolverURL = `https://doi.org/${encodeURI(doi.toLowerCase())}`;
  let response: Response;
  try {
    response = await ports.fetch(resolverURL, {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "text/html,application/xhtml+xml" },
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    return unreachable();
  }
  if (REDIRECTS.has(response.status)) {
    const location = response.headers.get("Location");
    if (!location) return unreachable();
    const landingURL = new URL(location, resolverURL).toString();
    return isSafeLandingURL(landingURL)
      ? { status: "reachable", landingURL }
      : unreachable();
  }
  const landingURL = response.url || resolverURL;
  const accessControlled =
    landingURL !== resolverURL &&
    (response.status === 401 || response.status === 403);
  return (response.ok || accessControlled) && isSafeLandingURL(landingURL)
    ? { status: "reachable", landingURL }
    : unreachable();
}

export async function verifyLandingPage(
  initialURL: string,
  ports: ProviderPorts,
  signal?: AbortSignal,
): Promise<ReachabilityResult> {
  if (!isSafeLandingURL(initialURL)) return unreachable();
  let response: Response;
  try {
    response = await ports.fetch(initialURL, {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "text/html,application/xhtml+xml" },
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    return unreachable();
  }
  const landingURL = response.url || initialURL;
  const contentType = response.headers.get("Content-Type")?.toLowerCase();
  return response.ok &&
    isSafeLandingURL(landingURL) &&
    !contentType?.includes("application/pdf")
    ? { status: "reachable", landingURL }
    : unreachable();
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function unreachable(): ReachabilityResult {
  return { status: "unreachable", code: "unreachable-landing-page" };
}

function isSafeLandingURL(url: string): boolean {
  return url.startsWith("https://") && !/\.pdf(?:$|[?#])/iu.test(url);
}
