export interface NativePolicyConfig {
  enabled?: boolean;
  apiOrigin?: string | null;
  approvedApiOrigins?: readonly string[];
}
export const NATIVE_PLUGINS = Object.freeze({ media: 'FORMMedia', auth: 'FORMAuth', purchases: 'FORMPurchase' });
function exactHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value && !url.username && !url.password;
  } catch { return false; }
}
/** Isolated until F32; an origin alone cannot enable authenticated native traffic. */
export function createNativePolicy(config: NativePolicyConfig = {}) {
  const approved = new Set(config.approvedApiOrigins ?? []), origin = config.apiOrigin ?? null;
  if ([...approved].some(value => !exactHttpsOrigin(value)) || origin !== null && (!exactHttpsOrigin(origin) || !approved.has(origin))) {
    throw new Error('INVALID_NATIVE_API_ORIGIN');
  }
  const available = config.enabled === true && origin !== null;
  return Object.freeze({ available, apiURL(path: string) {
    if (!available) throw new Error('NATIVE_BINDING_DISABLED');
    if (!/^\/api\/v2\/[A-Za-z0-9/_-]+$/.test(path)) throw new Error('INVALID_NATIVE_API_PATH');
    return origin + path;
  } });
}
export type NativePolicy = ReturnType<typeof createNativePolicy>;
