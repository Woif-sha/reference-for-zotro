import { lookupOpenAlexAbstract } from "./openalex";
import { lookupSemanticScholarAbstract } from "./semantic-scholar";
import { ProviderError, type ProviderPorts } from "./types";

export type LoadedAbstract = Readonly<{
  text: string;
  source: "openalex" | "semantic-scholar";
  sourceRecordID: string;
}>;

export async function lookupAvailableAbstract(
  doi: string,
  ports: ProviderPorts,
  signal?: AbortSignal,
): Promise<LoadedAbstract> {
  const failures: string[] = [];
  for (const lookup of [
    lookupOpenAlexAbstract,
    lookupSemanticScholarAbstract,
  ]) {
    try {
      return await lookup(doi, ports, signal);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      failures.push(formatFailure(error));
    }
  }
  throw new Error(`Abstract providers failed: ${failures.join("; ")}`);
}

function formatFailure(error: unknown): string {
  return error instanceof ProviderError
    ? `${error.source}: ${error.code}`
    : error instanceof Error
      ? error.message
      : String(error);
}
