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
  openAlexApiKey?: string,
): Promise<LoadedAbstract> {
  const failures: string[] = [];
  const lookups: readonly ((
    currentDoi: string,
    currentPorts: ProviderPorts,
    currentSignal?: AbortSignal,
  ) => Promise<LoadedAbstract>)[] = [
    (currentDoi, currentPorts, currentSignal) =>
      lookupOpenAlexAbstract(
        currentDoi,
        currentPorts,
        currentSignal,
        openAlexApiKey,
      ),
    lookupSemanticScholarAbstract,
  ];
  for (const lookup of lookups) {
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
