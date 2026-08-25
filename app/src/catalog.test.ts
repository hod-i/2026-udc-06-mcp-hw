import { describe, it, expect } from "vitest";
import {
  searchProducts,
  findBySku,
  needsReorder,
  lowStock,
  categories,
  inventoryValue,
  type Product,
} from "./catalog.js";
import { loadCatalog } from "./loader.js";

const sample: Product[] = [
  { sku: "AA-1", name: "Alpha Widget", category: "tools", price: 10, stock: 5, reorderLevel: 10 },
  { sku: "BB-2", name: "Beta Gadget", category: "tools", price: 20, stock: 50, reorderLevel: 10 },
  { sku: "CC-3", name: "Gamma Cable", category: "cables", price: 5, stock: 0, reorderLevel: 4 },
];

describe("searchProducts", () => {
  it("matches on name, sku, or category, case-insensitively", () => {
    expect(searchProducts(sample, "beta").map((p) => p.sku)).toEqual(["BB-2"]);
    expect(searchProducts(sample, "cc-3").map((p) => p.sku)).toEqual(["CC-3"]);
    expect(searchProducts(sample, "TOOLS").map((p) => p.sku)).toEqual(["AA-1", "BB-2"]);
  });

  it("returns a copy of everything for an empty query", () => {
    const all = searchProducts(sample, "  ");
    expect(all).toHaveLength(3);
    expect(all).not.toBe(sample);
  });
});

describe("findBySku", () => {
  it("finds regardless of case and surrounding space", () => {
    expect(findBySku(sample, " bb-2 ")?.name).toBe("Beta Gadget");
  });

  it("returns undefined for an unknown sku", () => {
    expect(findBySku(sample, "ZZ-9")).toBeUndefined();
  });
});

describe("needsReorder", () => {
  it("is true below the reorder level and false above it", () => {
    expect(needsReorder(sample[0]!)).toBe(true); // stock 5, reorder 10
    expect(needsReorder(sample[1]!)).toBe(false); // stock 50, reorder 10
  });

  it("treats stock exactly at the reorder level as needing a reorder", () => {
    // The inclusive boundary: this is the case a `<` typo would silently drop,
    // and the one both lowStock and the MCP server's check_stock rely on.
    const onTheLine: Product = { ...sample[0]!, stock: 10, reorderLevel: 10 };
    expect(needsReorder(onTheLine)).toBe(true);
    expect(needsReorder({ ...onTheLine, stock: 11 })).toBe(false);
  });
});

describe("lowStock", () => {
  it("returns items at or below reorder level, lowest stock first", () => {
    expect(lowStock(sample).map((p) => p.sku)).toEqual(["CC-3", "AA-1"]);
  });

  it("agrees with needsReorder on every product", () => {
    // Guards the split: the filter and the single-item predicate must not drift.
    const withBoundary = [...sample, { ...sample[1]!, sku: "DD-4", stock: 10 }];
    expect(lowStock(withBoundary).map((p) => p.sku)).toEqual(
      withBoundary.filter(needsReorder).map((p) => p.sku).sort((a, b) => {
        const s = (k: string) => withBoundary.find((p) => p.sku === k)!.stock;
        return s(a) - s(b);
      }),
    );
  });
});

describe("categories", () => {
  it("returns unique categories, sorted", () => {
    expect(categories(sample)).toEqual(["cables", "tools"]);
  });
});

describe("inventoryValue", () => {
  it("sums price * stock rounded to cents", () => {
    expect(inventoryValue(sample)).toBe(1050);
  });
});

describe("loadCatalog", () => {
  it("reads the seeded catalog and it is internally consistent", () => {
    const catalog = loadCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    for (const p of catalog) {
      expect(p.sku).toMatch(/^[A-Z]{2}-\d{4}$/);
      expect(p.stock).toBeGreaterThanOrEqual(0);
      expect(p.reorderLevel).toBeGreaterThan(0);
    }
  });
});
