/**
 * Minimal Facet agent — reads the shop catalog at my-boson-shop-2.bptest.technology
 *
 * Usage:
 *   pnpm start
 */

import { discoverAndConnect } from "@facet-llc/sdk-node";

const SHOP = "my-boson-shop-2.bptest.technology";
const TERMINAL = "https://my-boson-shop-2.sandbox.facet.llc";

// ── Mint KYA token via sandbox test helper ────────────────────────────────────
console.log("Minting KYA token…");
const mintResp = await fetch(`${TERMINAL}/v1/test_helpers/mint_kya`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ aid: "agent:my-tester" }),
});
if (!mintResp.ok)
  throw new Error(`Failed to mint KYA token: ${mintResp.status} ${await mintResp.text()}`);
const mintBody = (await mintResp.json()) as Record<string, unknown>;
const kyaToken = (mintBody.token ?? mintBody.kya_token ?? mintBody.jwt ?? mintBody.access_token) as
  | string
  | undefined;
if (!kyaToken)
  throw new Error(`Could not find token in mint response: ${JSON.stringify(mintBody)}`);
console.log("KYA token minted.\n");

// ── Connect ───────────────────────────────────────────────────────────────────
console.log(`Connecting to Facet terminal for ${SHOP}…\n`);
const client = await discoverAndConnect(SHOP, { kyaToken });

// ── No-auth checks ────────────────────────────────────────────────────────────
const [health, caps] = await Promise.all([client.health(), client.capabilities()]);
console.log("✓ Health:", health);
console.log("✓ Capabilities:", caps);

// ── Catalog ───────────────────────────────────────────────────────────────────
console.log("\nSearching catalog…");
const results = await client.search({ query: "", limit: 20 });
console.log(`\nFound ${results.results.length} item(s):\n`);

for (const item of results.results) {
  console.log(`  • ${item.name}  (id=${item.id})`);
  console.log(
    `    ${item.pricing.per_case} ${item.pricing.currency} per case of ${item.pack.case_pack} ${item.pack.uom}`,
  );
  console.log(`    ${item.category}${item.in_stock ? "" : "  · out of stock"}`);
  console.log();
}
