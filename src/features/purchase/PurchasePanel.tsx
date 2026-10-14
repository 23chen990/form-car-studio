import { useEffect, useState } from 'react';
import type { NativePurchaseController } from '../../platform/native-purchases';
export function PurchasePanel({ purchases }: { purchases: NativePurchaseController }) {
  const [state, setState] = useState(purchases.state());
  useEffect(() => purchases.subscribe(setState), [purchases]);
  return <section aria-label="Credit packs" aria-busy={state.status === 'purchasing' || state.status === 'loading'}>
    {state.availableUnits !== null && <p>{state.availableUnits} credits available</p>}
    {state.products.map(product => <button type="button" key={product.productId} disabled={state.status !== 'ready'} onClick={() => { void purchases.buy(product.productId); }}>{product.units} credits · {product.displayPrice}</button>)}
    <button type="button" disabled={state.status === 'purchasing' || state.status === 'loading' || state.status === 'unavailable'} onClick={() => { void purchases.syncBalance(); }}>Sync balance</button>
    <button type="button" onClick={() => { void purchases.refundHelp().catch(() => {}); }}>Apple refund help</button>
    {state.message && <p role="status">{state.message}</p>}
  </section>;
}
