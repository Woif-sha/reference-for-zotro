import assert from "node:assert/strict";
import test from "node:test";

import { testOpenAlexConnection } from "../../src/literature/providers/openalex";
import type { ProviderPorts } from "../../src/literature/providers/types";

test("OpenAlex connection test queries the official rate-limit endpoint", async () => {
  let requestedURL = "";
  const result = await testOpenAlexConnection(
    "  test-openalex-secret  ",
    ports(async (input) => {
      requestedURL = input;
      return Response.json({
        api_key: "test...cret",
        rate_limit: { daily_remaining_usd: 0.9964 },
      });
    }),
  );

  const url = new URL(requestedURL);
  assert.equal(url.origin, "https://api.openalex.org");
  assert.equal(url.pathname, "/rate-limit");
  assert.equal(url.searchParams.get("api_key"), "test-openalex-secret");
  assert.deepEqual(result, { dailyRemainingUsd: 0.9964 });
});

test("OpenAlex connection test rejects invalid credentials and malformed balances", async () => {
  await assert.rejects(
    testOpenAlexConnection(
      "invalid-key",
      ports(async () => new Response(null, { status: 401 })),
    ),
    /API Key 无效/u,
  );
  await assert.rejects(
    testOpenAlexConnection(
      "valid-key",
      ports(async () => Response.json({ rate_limit: {} })),
    ),
    /无效余额信息/u,
  );
});

test("OpenAlex connection test does not expose the Key in network errors", async () => {
  const apiKey = "test-openalex-error-secret";
  await assert.rejects(
    testOpenAlexConnection(
      apiKey,
      ports(async (input) => {
        throw new Error(`request failed for ${input}`);
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "无法连接 OpenAlex API");
      assert.doesNotMatch(error.message, new RegExp(apiKey, "u"));
      return true;
    },
  );
});

function ports(fetch: ProviderPorts["fetch"]): ProviderPorts {
  return {
    fetch,
    clock: { now: () => new Date("2026-08-18T00:00:00.000Z") },
    scheduler: { sleep: async () => {} },
  };
}
