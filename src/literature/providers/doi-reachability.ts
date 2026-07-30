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
  let url = `https://doi.org/${encodeURI(doi.toLowerCase())}`;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    let response: Response;
    try {
      response = await ports.fetch(url, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "text/html,application/xhtml+xml" },
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      return { status: "unreachable", code: "unreachable-landing-page" };
    }
    if (REDIRECTS.has(response.status)) {
      const location = response.headers.get("Location");
      if (!location) return unreachable();
      const next = new URL(location, url);
      if (next.protocol !== "https:") return unreachable();
      url = next.toString();
      continue;
    }
    if (!response.ok || !url.startsWith("https://")) return unreachable();
    const contentType = response.headers.get("Content-Type")?.toLowerCase();
    if (
      contentType?.includes("application/pdf") ||
      /\.pdf(?:$|[?#])/iu.test(url)
    ) {
      return unreachable();
    }
    return { status: "reachable", landingURL: url };
  }
  return unreachable();
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
