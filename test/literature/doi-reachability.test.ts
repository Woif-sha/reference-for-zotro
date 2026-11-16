import assert from "node:assert/strict";
import test from "node:test";
import {
  verifyDoiLandingPage,
  verifyLandingPage,
} from "../../src/literature/providers/doi-reachability";
import type { ProviderPorts } from "../../src/literature/providers/types";

test("DOI and direct landing probes reject PDFs served without a PDF suffix", async () => {
  for (const verify of [verifyDoiLandingPage, verifyLandingPage]) {
    const response = new Response("PDF", {
      headers: { "Content-Type": "application/pdf; charset=binary" },
    });
    Object.defineProperty(response, "url", {
      value: "https://publisher.example/content?id=42",
    });
    const ports = probePorts(async () => response);

    const result = await verify(
      verify === verifyDoiLandingPage
        ? "10.1000/paper"
        : "https://publisher.example/content?id=42",
      ports,
    );

    assert.deepEqual(result, {
      status: "unreachable",
      code: "unreachable-landing-page",
    });
  }
});

test("header-only landing probes cancel their unconsumed response body", async () => {
  for (const verify of [verifyDoiLandingPage, verifyLandingPage]) {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({ cancel: () => void (cancelled = true) }),
      { headers: { "Content-Type": "text/html" } },
    );
    Object.defineProperty(response, "url", {
      value: "https://publisher.example/paper",
    });

    assert.equal(
      (
        await verify(
          verify === verifyDoiLandingPage
            ? "10.1000/paper"
            : "https://publisher.example/paper",
          probePorts(async () => response),
        )
      ).status,
      "reachable",
    );
    assert.equal(cancelled, true);
  }
});

function probePorts(fetch: typeof globalThis.fetch): ProviderPorts {
  return {
    fetch,
    clock: { now: () => new Date("2026-07-30T00:00:00.000Z") },
    scheduler: { sleep: async () => {} },
  };
}
