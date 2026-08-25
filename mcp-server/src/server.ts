/**
 * MCP server over the catalog domain.
 *
 * Thin protocol adapter: every number below comes from the tested domain
 * functions in `app/`, nothing is recomputed here.
 *
 * Read-only by construction — no tool writes, deletes, or touches the network.
 * The only filesystem access is `loadCatalog()` inside `app/`, which reads
 * `app/data/catalog.json` resolved relative to its own module URL.
 *
 * SDK: @modelcontextprotocol/server v2 (signatures checked against the
 * installed version's .d.mts, not against a blog post).
 */

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

// The domain lives in app/ — run `cd app && npm run build` first.
// Do NOT reimplement any of this logic in the server: a server is a thin
// protocol adapter, and duplicated business rules drift apart.
import {
  loadCatalog,
  searchProducts,
  findBySku,
  needsReorder,
  lowStock,
  inventoryValue,
  categories,
  type Product,
} from "../../app/dist/index.js";

const server = new McpServer({
  name: "catalog-server",
  version: "1.0.0",
});

/** Every tool here only reads — declared to the host, not just promised in prose. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const line = (p: Product) =>
  `${p.sku} — ${p.name} (${p.category}) · $${p.price} · stock ${p.stock} · reorder at ${p.reorderLevel}`;

// ── Tool 1 ────────────────────────────────────────────────────────────────
// The DESCRIPTION is what the model reads to decide whether to call this.
// Say WHEN to use it, not just what it is — a vague description never fires.
server.registerTool(
  "search_inventory",
  {
    title: "Search inventory",
    description:
      "Search the product catalog by name, SKU, or category (case-insensitive " +
      "substring match). Use when the user asks what products exist, asks about " +
      "a specific item, or wants everything in a category such as 'audio' or " +
      "'displays'. An empty query returns the whole catalog.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Free-text match on product name, SKU, or category"),
    }),
    annotations: READ_ONLY,
  },
  async ({ query }) => {
    const results = searchProducts(loadCatalog(), query);
    return {
      content: [
        {
          type: "text",
          text:
            results.length === 0
              ? `No products matched "${query}".`
              : `${results.length} product(s) matched "${query}":\n` +
                results.map(line).join("\n"),
        },
      ],
    };
  },
);

// ── Tool 2 ────────────────────────────────────────────────────────────────
server.registerTool(
  "check_stock",
  {
    title: "Check stock for one SKU",
    description:
      "Look up a single product by its exact SKU (format XX-9999, e.g. KB-1001) " +
      "and report units on hand against its reorder level. Use when the user " +
      "names a SKU and asks how many are left or whether it needs reordering. " +
      "For name or category lookups use search_inventory instead.",
    inputSchema: z.object({
      sku: z
        .string()
        .describe("Exact product SKU, case-insensitive (e.g. 'KB-1001')"),
    }),
    annotations: READ_ONLY,
  },
  async ({ sku }) => {
    const product = findBySku(loadCatalog(), sku);
    if (!product) {
      return {
        content: [
          {
            type: "text",
            text: `No product with SKU "${sku}". Use search_inventory to find the right SKU.`,
          },
        ],
      };
    }
    // The `stock <= reorderLevel` boundary is the domain's to define, not the
    // adapter's — `needsReorder` is the same predicate `lowStock` filters with,
    // so a single SKU here can never disagree with the list from `low_stock`.
    return {
      content: [
        {
          type: "text",
          text:
            `${line(product)}\n` +
            (needsReorder(product)
              ? `NEEDS REORDER — stock ${product.stock} is at or below the reorder level ${product.reorderLevel}.`
              : `Stock is healthy — ${product.stock - product.reorderLevel} unit(s) above the reorder level ${product.reorderLevel}.`),
        },
      ],
    };
  },
);

// ── Tool 3 ────────────────────────────────────────────────────────────────
server.registerTool(
  "low_stock",
  {
    title: "List items needing reorder",
    description:
      "List every product whose stock is at or below its reorder level, " +
      "lowest stock first. Takes no arguments. Use when the user asks what " +
      "needs reordering, what is running low, or what to restock — this is a " +
      "computation over all 24 products, not something to estimate.",
    inputSchema: z.object({}),
    annotations: READ_ONLY,
  },
  async () => {
    const items = lowStock(loadCatalog());
    return {
      content: [
        {
          type: "text",
          text:
            items.length === 0
              ? "Nothing is at or below its reorder level."
              : `${items.length} product(s) need reordering:\n` +
                items.map(line).join("\n"),
        },
      ],
    };
  },
);

// ── Tool 4 ────────────────────────────────────────────────────────────────
// Added after live testing: the total inventory value existed only in the
// resource below, and a resource is application-controlled — the model cannot
// invoke it. "Go compute the total" is a tool-shaped request, so it needs a
// tool; the resource keeps it too, as part of the catalog snapshot.
server.registerTool(
  "inventory_value",
  {
    title: "Total value of stock on hand",
    description:
      "Compute the total capital tied up in stock: sum of price × units on " +
      "hand across all 24 products, rounded to cents. Takes no arguments. Use " +
      "when the user asks what the inventory is worth, the total value of " +
      "stock held, or how much money is sitting on the shelves.",
    inputSchema: z.object({}),
    annotations: READ_ONLY,
  },
  async () => {
    const catalog = loadCatalog();
    return {
      content: [
        {
          type: "text",
          text:
            `Total inventory value: ${inventoryValue(catalog)} ` +
            `(sum of price × stock across ${catalog.length} products).`,
        },
      ],
    };
  },
);

// ── Resource ──────────────────────────────────────────────────────────────
// A resource is APPLICATION-controlled context read by URI — unlike a tool,
// the model does not invoke it. Good fit for "here is the state of the
// catalog" rather than "go compute something".
server.registerResource(
  "catalog-summary",
  "inventory://catalog",
  {
    title: "Catalog summary",
    description:
      "Snapshot of the catalog: product count, categories, total inventory " +
      "value, and how many items are at or below their reorder level " +
      "(the boundary is inclusive — stock equal to the reorder level counts).",
    mimeType: "application/json",
  },
  async (uri) => {
    const catalog = loadCatalog();
    const summary = {
      productCount: catalog.length,
      categories: categories(catalog),
      inventoryValue: inventoryValue(catalog),
      lowStockCount: lowStock(catalog).length,
    };
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  },
);

// ── Connect ───────────────────────────────────────────────────────────────
// stdio: the HOST launches this process and talks over stdin/stdout.
// Nothing is printed to stdout except protocol messages — if you need to
// debug, log to stderr (console.error), never console.log.
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("catalog-server ready on stdio (read-only)");
