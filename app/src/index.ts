// Public surface of the catalog domain — this is what `mcp-server/` imports.
export type { Product } from "./catalog.js";
export {
  searchProducts,
  findBySku,
  needsReorder,
  lowStock,
  categories,
  inventoryValue,
} from "./catalog.js";
export { loadCatalog } from "./loader.js";
