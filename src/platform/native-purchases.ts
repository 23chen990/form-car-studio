import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { createNativePolicy, NATIVE_PLUGINS, type NativePolicy } from './ios-shell';
export interface NativePurchasePlugin {
  products(): Promise<unknown>; purchase(options: { productId: string }): Promise<unknown>;
  recover(): Promise<unknown>; balance(): Promise<unknown>; refundHelp(): Promise<unknown>;
  addListener(event: 'purchaseUpdate', listener: (value: unknown) => void): Promise<PluginListenerHandle>;
}
export type CreditProduct = { productId: string; units: 5 | 15; type: 'consumable'; displayPrice: string };
export type PurchaseState = { status: 'unavailable' | 'loading' | 'ready' | 'purchasing' | 'awaiting_confirmation'; products: CreditProduct[]; availableUnits: number | null; message: string | null };
const plugin = registerPlugin<NativePurchasePlugin>(NATIVE_PLUGINS.purchases);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const pendingCopy = 'Your purchase is awaiting confirmation. Please do not buy it again.';
const unavailableCopy = 'Purchases are not available right now. Retry or contact support.';
function catalog(value: unknown, ownerId: string) {
  if (!object(value) || value.ownerId !== ownerId || typeof value.storefront !== 'string' || !/^[A-Z]{3}$/.test(value.storefront) || !['Production','Sandbox'].includes(String(value.environment)) || !Array.isArray(value.products) || !value.products.length || value.products.length > 2 || !Array.isArray(value.pendingProductIds) || value.pendingProductIds.some(id => typeof id !== 'string')) throw Error('PURCHASE_CATALOG_INVALID');
  const ids = new Set<string>();
  for (const p of value.products) {
    if (!object(p) || typeof p.productId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/.test(p.productId) || ids.has(p.productId) || p.type !== 'consumable' || ![5,15].includes(p.units as number) || typeof p.displayPrice !== 'string' || !p.displayPrice.trim() || p.displayPrice.length > 128) throw Error('PURCHASE_CATALOG_INVALID');
    ids.add(p.productId);
  }
  return { products: value.products.map(p => ({ ...p })) as CreditProduct[], pending: value.pendingProductIds.length > 0 };
}
/** Native verifies/finishes; JS displays server ledger values and never increments a balance. */
export function createNativePurchases(options: { native?: NativePurchasePlugin; policy?: NativePolicy; owner: () => string | null }) {
  const native = options.native ?? plugin, policy = options.policy ?? createNativePolicy();
  let actor: string | null = null, epoch = 0, work: Promise<void> | null = null;
  let state: PurchaseState = { status: 'unavailable', products: [], availableUnits: null, message: unavailableCopy };
  const listeners = new Set<(state: PurchaseState) => void>();
  const stateForOwner = (): PurchaseState => actor === options.owner() ? { ...state, products: state.products.map(p => ({ ...p })) } : { status: 'unavailable', products: [], availableUnits: null, message: unavailableCopy };
  function publish(patch: Partial<PurchaseState>) { state = { ...state, ...patch }; for (const listener of listeners) listener(stateForOwner()); }
  function unavailable() { publish({ status: 'unavailable', products: [], availableUnits: null, message: unavailableCopy }); }
  const valid = (owner: string | null, generation: number) => owner !== null && options.owner() === owner && generation === epoch;
  async function balance(owner: string) {
    const value = await native.balance();
    if (!object(value) || value.ownerId !== owner || value.scope !== 'live' || !Number.isSafeInteger(value.availableUnits) || (value.availableUnits as number) < 0) throw Error('PURCHASE_BALANCE_INVALID');
    return value.availableUnits as number;
  }
  async function load() {
    actor = options.owner(); const generation = ++epoch, owner = actor;
    if (!policy.available || !owner) { unavailable(); return; }
    publish({ status: 'loading', availableUnits: null, products: [], message: null });
    try {
      const value = catalog(await native.products(), owner); if (!valid(owner, generation)) return;
      publish({ status: value.pending ? 'awaiting_confirmation' : 'ready', products: value.products, message: value.pending ? pendingCopy : null });
    } catch { if (valid(owner, generation)) unavailable(); }
  }
  function buy(productId: string) {
    if (work) return work;
    const owner = options.owner(), generation = epoch;
    if (!policy.available || !valid(owner, generation) || state.status !== 'ready' || !state.products.some(p => p.productId === productId)) return Promise.resolve();
    publish({ status: 'purchasing', message: null });
    const operation = (async () => {
      try {
        const result = await native.purchase({ productId }); if (!valid(owner, generation)) return;
        if (!object(result)) throw Error('PURCHASE_UNCERTAIN');
        if (result.status === 'cancelled') { publish({ status: 'ready' }); return; }
        if (result.status === 'unavailable') { unavailable(); return; }
        if (result.status !== 'credited') { publish({ status: 'awaiting_confirmation', availableUnits: null, message: pendingCopy }); return; }
        const units = await balance(owner!); if (valid(owner, generation)) publish({ status: 'ready', availableUnits: units, message: null });
      } catch { if (valid(owner, generation)) publish({ status: 'awaiting_confirmation', availableUnits: null, message: pendingCopy }); }
    })();
    const job = operation.finally(() => { if (work === job) work = null; }); work = job; return job;
  }
  function syncBalance() {
    if (work) return work;
    const owner = options.owner(), generation = epoch;
    if (!policy.available || !valid(owner, generation)) return Promise.resolve();
    publish({ status: 'loading', availableUnits: null, message: 'Syncing your balance with your account.' });
    const operation = (async () => { try {
      const recovery = await native.recover(); if (!object(recovery) || typeof recovery.pending !== 'boolean') throw Error('PURCHASE_UNCERTAIN');
      const units = await balance(owner!); if (!valid(owner, generation)) return;
      publish({ status: recovery.pending ? 'awaiting_confirmation' : 'ready', availableUnits: units, message: recovery.pending ? pendingCopy : null });
    } catch { if (valid(owner, generation)) publish({ status: 'awaiting_confirmation', availableUnits: null, message: pendingCopy }); }
    })();
    const job = operation.finally(() => { if (work === job) work = null; }); work = job; return job;
  }
  return Object.freeze({ state: stateForOwner, load, buy, syncBalance,
    subscribe(listener: (value: PurchaseState) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reset() { ++epoch; actor = null; work = null; unavailable(); },
    refundHelp: () => native.refundHelp(),
    async listen() {
      const handle = await native.addListener('purchaseUpdate', () => { void syncBalance(); });
      return () => handle.remove();
    },
  });
}
export type NativePurchaseController = ReturnType<typeof createNativePurchases>;
