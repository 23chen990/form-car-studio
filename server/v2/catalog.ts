export interface ProductCatalogConfig {
  fiveUnitProductId?: string | null;
  fifteenUnitProductId?: string | null;
}

export interface CatalogProduct { productId: string; units: 5 | 15 }
export interface ProductCatalog { enabled: boolean; products: readonly CatalogProduct[] }

const validProductId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 255 && /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(value);

/** Null or absent owner-approved IDs stay unavailable; prices always come from StoreKit. */
export function createProductCatalog(config: ProductCatalogConfig = {}): ProductCatalog {
  const configured = [config.fiveUnitProductId ?? null, config.fifteenUnitProductId ?? null];
  if (configured.some(value => value !== null && !validProductId(value))) return Object.freeze({ enabled: false, products: Object.freeze([]) });
  const ids = configured.filter((value): value is string => value !== null);
  if (new Set(ids).size !== ids.length) return Object.freeze({ enabled: false, products: Object.freeze([]) });
  const products: CatalogProduct[] = [];
  if (configured[0]) products.push(Object.freeze({ productId: configured[0], units: 5 }));
  if (configured[1]) products.push(Object.freeze({ productId: configured[1], units: 15 }));
  return Object.freeze({ enabled: products.length > 0, products: Object.freeze(products) });
}

export function findCatalogProduct(catalog: ProductCatalog, productId: string): CatalogProduct | undefined {
  return catalog.products.find(product => product.productId === productId);
}
