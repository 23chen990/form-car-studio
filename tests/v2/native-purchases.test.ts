import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createNativePolicy } from '../../src/platform/ios-shell';
async function load() {
  assert.ok(existsSync(new URL('../../src/platform/native-purchases.ts', import.meta.url)), 'native purchase controller must exist');
  return import('../../src/platform/native-purchases.js');
}
const ownerId = '11111111-1111-4111-8111-111111111111';
const policy = () => createNativePolicy({ enabled: true, apiOrigin: 'https://api.form.example', approvedApiOrigins: ['https://api.form.example'] });
const catalog = () => ({ ownerId, storefront: 'USA', environment: 'Production', products: [{ productId: 'synthetic.pack5', units: 5, type: 'consumable', displayPrice: 'US$ 3.99' }], pendingProductIds: [] });
const port = (overrides: Record<string, unknown> = {}): any => ({ products: async () => catalog(), purchase: async () => ({ status: 'cancelled' }), recover: async () => ({ pending: false }), balance: async () => ({ ownerId, scope: 'live', availableUnits: 7 }), refundHelp: async () => {}, addListener: async () => ({ remove: async () => {} }), ...overrides });
test('unknown native configuration or owner invokes zero StoreKit product/purchase calls', async () => {
  const { createNativePurchases } = await load(); let calls = 0;
  const controller = createNativePurchases({ native: port({ products: async () => { calls++; return catalog(); } }), owner: () => ownerId });
  await controller.load(); assert.equal(calls, 0); assert.equal(controller.state().status, 'unavailable');
});
test('product units and localized price come from validated native/server catalog', async () => {
  const { createNativePurchases } = await load();
  const controller = createNativePurchases({ policy: policy(), native: port(), owner: () => ownerId }); await controller.load();
  assert.equal(controller.state().products[0].displayPrice, 'US$ 3.99'); assert.equal(controller.state().products[0].units, 5);
});
test('catalog mismatch, subscription or missing actual storefront exposes no buy product', async () => {
  const { createNativePurchases } = await load();
  for (const patch of [{ storefront: null }, { products: [{ ...catalog().products[0], type: 'subscription' }] }, { products: [{ ...catalog().products[0], units: 2 }] }, { ownerId: 'other-owner' }]) {
    const controller = createNativePurchases({ policy: policy(), native: port({ products: async () => ({ ...catalog(), ...patch }) }), owner: () => ownerId });
    await controller.load(); assert.equal(controller.state().products.length, 0); assert.equal(controller.state().status, 'unavailable');
  }
});
test('pending payment blocks a second tap after its first promise resolves', async () => {
  const { createNativePurchases } = await load(); let calls = 0;
  const controller = createNativePurchases({ policy: policy(), native: port({ purchase: async () => { calls++; return { status: 'pending' }; } }), owner: () => ownerId }); await controller.load();
  await controller.buy('synthetic.pack5'); await controller.buy('synthetic.pack5'); assert.equal(calls, 1); assert.equal(controller.state().status, 'awaiting_confirmation');
});
test('double taps during purchase open one native payment request', async () => {
  const { createNativePurchases } = await load(); let calls = 0, finish!: (x: unknown) => void;
  const controller = createNativePurchases({ policy: policy(), native: port({ purchase: () => { calls++; return new Promise(r => { finish = r; }); } }), owner: () => ownerId }); await controller.load();
  const first = controller.buy('synthetic.pack5'), second = controller.buy('synthetic.pack5'); finish({ status: 'cancelled' }); await Promise.all([first,second]); assert.equal(calls, 1);
});
test('acknowledged purchase refreshes authoritative balance without client increment', async () => {
  const { createNativePurchases } = await load();
  const controller = createNativePurchases({ policy: policy(), native: port({ purchase: async () => ({ status: 'credited' }), balance: async () => ({ ownerId, scope: 'live', availableUnits: 42 }) }), owner: () => ownerId }); await controller.load(); await controller.buy('synthetic.pack5');
  assert.equal(controller.state().availableUnits, 42);
});
test('lost ack or balance failure stays awaiting confirmation, never invites repayment', async () => {
  const { createNativePurchases } = await load();
  for (const overrides of [{ purchase: async () => { throw Error('signed payload'); } }, { purchase: async () => ({ status: 'credited' }), balance: async () => { throw Error('offline'); } }]) {
    const controller = createNativePurchases({ policy: policy(), native: port(overrides), owner: () => ownerId }); await controller.load(); await controller.buy('synthetic.pack5');
    assert.equal(controller.state().status, 'awaiting_confirmation'); assert.equal(controller.state().availableUnits, null); assert.doesNotMatch(JSON.stringify(controller.state()), /signed payload/);
  }
});
test('Sync balance uses unfinished recovery and ledger read, never buys/regrants history', async () => {
  const { createNativePurchases } = await load(); let purchases = 0, recoveries = 0;
  const controller = createNativePurchases({ policy: policy(), native: port({ purchase: async () => { purchases++; }, recover: async () => { recoveries++; return { pending: false }; } }), owner: () => ownerId }); await controller.load(); await controller.syncBalance(); await controller.syncBalance();
  assert.equal(purchases, 0); assert.equal(recoveries, 2); assert.equal(controller.state().availableUnits, 7);
});
test('identity change hides previous balance and ignores late payment callback', async () => {
  const { createNativePurchases } = await load(); let owner: string | null = ownerId, finish!: (x: unknown) => void;
  const controller = createNativePurchases({ policy: policy(), native: port({ purchase: () => new Promise(r => { finish = r; }) }), owner: () => owner }); await controller.load();
  const payment = controller.buy('synthetic.pack5'); owner = null; finish({ status: 'credited' }); await payment;
  assert.equal(controller.state().availableUnits, null); assert.equal(controller.state().products.length, 0);
});
test('concurrent Sync balance calls share one recovery and balance read', async () => {
  const { createNativePurchases } = await load(); let finish!: (x: unknown) => void, calls = 0;
  const controller = createNativePurchases({ policy: policy(), native: port({ recover: () => { calls++; return new Promise(r => { finish = r; }); } }), owner: () => ownerId }); await controller.load();
  const first = controller.syncBalance(), second = controller.syncBalance();
  assert.equal(calls, 1); finish({ pending: false }); await Promise.all([first,second]);
});
test('unfinished verification is recoverable while travelling without loading sale products', () => {
  const source = readFileSync(new URL('../../ios/App/App/Plugins/FORMPurchase.swift', import.meta.url), 'utf8');
  const recover = source.slice(source.indexOf('@objc public func recover'), source.indexOf('@objc public func balance'));
  assert.doesNotMatch(recover, /loadProducts/);
});
test('native has no exposed finish bridge and finishes only after durable server ack', () => {
  const path = new URL('../../ios/App/App/Plugins/FORMPurchase.swift', import.meta.url); assert.ok(existsSync(path), 'native StoreKit plugin must exist'); const source = readFileSync(path, 'utf8');
  assert.match(source, /Transaction.updates/); assert.match(source, /Transaction.unfinished/);
  assert.match(source, /\/purchases\/verify/); assert.match(source, /already-credited/); assert.match(source, /appAccountToken/);
  assert.match(source, /await transaction.finish\(\)/); assert.match(source, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/);
  assert.doesNotMatch(source, /@objc public func finish|Transaction.all|UserDefaults|print\(/);
});
