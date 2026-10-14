import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Environment, SignedDataVerifier, VerificationException, VerificationStatus } from '@apple/app-store-server-library';
import { createProductCatalog, findCatalogProduct, type ProductCatalog, type ProductCatalogConfig } from './catalog.js';
import { resolveAccessPrincipal } from './sessions.js';
import { WalletRepository, type WalletTransaction } from './wallet-repo.js';

export type ApplePurchaseEnvironment = typeof Environment.SANDBOX | typeof Environment.PRODUCTION;
export interface AppleVerifierConfig { bundleId?: string | null; appAppleId?: number | null; rootCertificates?: readonly Uint8Array[] }
export interface ApplePurchaseConfig extends AppleVerifierConfig, ProductCatalogConfig {}
export interface VerifiedAppleTransaction {
  transactionId?: string; productId?: string; bundleId?: string; environment?: ApplePurchaseEnvironment;
  quantity?: number; type?: string; appAccountToken?: string | null; inAppOwnershipType?: string; revocationDate?: number | null;
}
export interface VerifiedAppleNotification {
  notificationUUID: string; notificationType: string; subtype?: string; environment: ApplePurchaseEnvironment;
  transaction?: Pick<VerifiedAppleTransaction, 'transactionId' | 'productId' | 'environment' | 'revocationDate'>;
}
interface PurchaseOptions { db: DatabaseSync; config?: ApplePurchaseConfig; enableOnlineChecks?: boolean; clock?: () => Date; id?: () => string; onVerifiedRevocationInTransaction?: (wallet: WalletRepository, tx: WalletTransaction, environment: ApplePurchaseEnvironment, transactionId: string, productId: string, now: string) => true }
interface AdapterOptions { enableOnlineChecks?: boolean }

export class PurchaseError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = 'PurchaseError'; }
}

function purchaseVerificationError(error: unknown): PurchaseError {
  if (error instanceof PurchaseError) return error;
  const retryable = error instanceof VerificationException && error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE;
  return new PurchaseError(retryable ? 'APPLE_VERIFICATION_UNAVAILABLE' : 'APPLE_SIGNATURE_INVALID', retryable ? 503 : 400);
}

const isEnvironment = (value: unknown): value is ApplePurchaseEnvironment => value === Environment.SANDBOX || value === Environment.PRODUCTION;
const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const ownRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function verifierConfig(config: AppleVerifierConfig, options: AdapterOptions) {
  const bundleId = config.bundleId;
  const roots = config.rootCertificates;
  if (typeof bundleId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/.test(bundleId) || !Array.isArray(roots) || !roots.length ||
      roots.some(root => !(root instanceof Uint8Array) || !root.byteLength || root.byteLength > 1024 * 1024)) return undefined;
  if (options.enableOnlineChecks !== undefined && typeof options.enableOnlineChecks !== 'boolean') return undefined;
  const appAppleId = config.appAppleId;
  const productionId = Number.isSafeInteger(appAppleId) && (appAppleId ?? 0) > 0 ? appAppleId : undefined;
  const online = options.enableOnlineChecks ?? true;
  const certificates = roots.map(root => Buffer.from(root));
  return {
    bundleId,
    sandbox: new SignedDataVerifier(certificates, online, Environment.SANDBOX, bundleId),
    production: productionId ? new SignedDataVerifier(certificates, online, Environment.PRODUCTION, bundleId, productionId) : undefined,
    productionEnabled: !!productionId,
  };
}

/** Apple signs both the outer notification and its optional nested transaction independently. */
export function createAppleSignedDataAdapter(config: AppleVerifierConfig = {}, options: AdapterOptions = {}) {
  const setup = verifierConfig(config, options);
  function verifier(environment: ApplePurchaseEnvironment): SignedDataVerifier {
    if (!setup) throw new PurchaseError('PURCHASES_DISABLED', 503);
    const value = environment === Environment.SANDBOX ? setup.sandbox : setup.production;
    if (!value) throw new PurchaseError('PURCHASES_DISABLED', 503);
    return value;
  }
  async function verifyTransaction(signedTransaction: string, environment: ApplePurchaseEnvironment): Promise<VerifiedAppleTransaction> {
    try {
      const decoded = await verifier(environment).verifyAndDecodeTransaction(signedTransaction);
      if (decoded.environment !== environment || decoded.bundleId !== setup?.bundleId) throw new Error('transaction scope mismatch');
      return {
        transactionId: decoded.transactionId, productId: decoded.productId, bundleId: decoded.bundleId,
        environment: decoded.environment, quantity: decoded.quantity, type: decoded.type,
        appAccountToken: decoded.appAccountToken, inAppOwnershipType: decoded.inAppOwnershipType,
        revocationDate: decoded.revocationDate,
      };
    } catch (error) {
      throw purchaseVerificationError(error);
    }
  }
  async function verifyNotification(signedPayload: string, environment: ApplePurchaseEnvironment): Promise<VerifiedAppleNotification> {
    try {
      const notification = await verifier(environment).verifyAndDecodeNotification(signedPayload);
      if (!notification.notificationUUID || !notification.notificationType || notification.data?.bundleId !== setup?.bundleId || notification.data?.environment !== environment) throw new Error('notification scope mismatch');
      const signed = notification.data.signedTransactionInfo;
      const transaction = signed ? await verifyTransaction(signed, environment) : undefined;
      return {
        notificationUUID: notification.notificationUUID, notificationType: notification.notificationType,
        ...(notification.subtype ? { subtype: notification.subtype } : {}), environment,
        ...(transaction ? { transaction: {
          transactionId: transaction.transactionId, productId: transaction.productId,
          environment: transaction.environment, revocationDate: transaction.revocationDate,
        } } : {}),
      };
    } catch (error) {
      throw purchaseVerificationError(error);
    }
  }
  return Object.freeze({ enabled: !!setup, productionEnabled: !!setup?.productionEnabled, verifyTransaction, verifyNotification });
}

function tombstoneParts(environment: ApplePurchaseEnvironment, transactionId: string) {
  if (!isEnvironment(environment) || typeof transactionId !== 'string' || !/^[A-Za-z0-9._-]{1,256}$/.test(transactionId)) throw new PurchaseError('PURCHASE_METADATA_INVALID', 400);
  const digest = hash(transactionId);
  return { id: `apple-revocation:v1:${environment}:${digest}`, digest };
}

/** Stable global key shared with F25; the raw transaction ID is never copied to the audit event. */
export function appleRevocationTombstoneId(environment: ApplePurchaseEnvironment, transactionId: string): string {
  return tombstoneParts(environment, transactionId).id;
}

export function hasAppleRevocationTombstoneInTransaction(tx: WalletTransaction, environment: ApplePurchaseEnvironment, transactionId: string): boolean {
  const { id } = tombstoneParts(environment, transactionId);
  return !!tx.get("SELECT 1 FROM audit_events WHERE id=? AND event_type='apple_revocation_tombstone'", id);
}

export function recordAppleRevocationTombstoneInTransaction(tx: WalletTransaction, environment: ApplePurchaseEnvironment, transactionId: string, createdAt: string): void {
  const { id, digest } = tombstoneParts(environment, transactionId);
  const details = JSON.stringify({ version: 1, environment, transactionDigest: digest });
  tx.run("INSERT INTO audit_events(id,owner_id,event_type,details_json,created_at) VALUES(?,NULL,'apple_revocation_tombstone',?,?) ON CONFLICT(id) DO NOTHING", id, details, createdAt);
  const existing = tx.get<{ owner_id: string | null; event_type: string; details_json: string }>('SELECT owner_id,event_type,details_json FROM audit_events WHERE id=?', id);
  if (!existing || existing.owner_id !== null || existing.event_type !== 'apple_revocation_tombstone' || existing.details_json !== details) throw new PurchaseError('REVOCATION_TOMBSTONE_CONFLICT', 503);
}

function canonicalNow(clock: () => Date): string {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new PurchaseError('PURCHASE_UNAVAILABLE', 503);
  return value.toISOString();
}

function parseConfirmation(value: unknown): { signedTransaction: string; environment: ApplePurchaseEnvironment } {
  if (!ownRecord(value) || Reflect.ownKeys(value).length !== 2 || !Object.hasOwn(value, 'signedTransaction') || !Object.hasOwn(value, 'environment') ||
      typeof value.signedTransaction !== 'string' || value.signedTransaction.length < 1 || Buffer.byteLength(value.signedTransaction, 'utf8') > 64 * 1024 || !isEnvironment(value.environment)) {
    throw new PurchaseError('PURCHASE_REQUEST_INVALID', 400);
  }
  return { signedTransaction: value.signedTransaction, environment: value.environment };
}

export function createApplePurchaseService(options: PurchaseOptions) {
  const { db, config = {} } = options;
  const clock = options.clock ?? (() => new Date()), makeId = options.id ?? randomUUID;
  const wallet = new WalletRepository(db), catalogConfig: ProductCatalogConfig = config;
  const productCatalog = createProductCatalog(catalogConfig);
  const verifier = createAppleSignedDataAdapter(config, { enableOnlineChecks: options.enableOnlineChecks });
  const productionEnabled = verifier.productionEnabled && productCatalog.enabled && typeof options.onVerifiedRevocationInTransaction === 'function';
  function catalog(): ProductCatalog {
    return productionEnabled ? productCatalog : Object.freeze({ enabled: false, products: Object.freeze([]) });
  }

  async function confirm(accessToken: string, raw: unknown): Promise<{ status: 'credited' | 'already-credited'; purchaseId: string; units: 5 | 15; scope: 'live' }> {
    const request = parseConfirmation(raw);
    if (!verifier.enabled || !productCatalog.enabled || request.environment === Environment.PRODUCTION && !productionEnabled) throw new PurchaseError('PURCHASES_DISABLED', 503);
    if (typeof accessToken !== 'string') throw new PurchaseError('AUTH_REQUIRED', 401);
    const acceptedAt = new Date(canonicalNow(clock)), principal = resolveAccessPrincipal(db, accessToken, acceptedAt);
    if (!principal || !isUuid(principal.ownerId)) throw new PurchaseError('AUTH_REQUIRED', 401);
    const transaction = await verifier.verifyTransaction(request.signedTransaction, request.environment);
    if (!transaction.transactionId || transaction.transactionId.length > 256 || !/^[A-Za-z0-9._-]+$/.test(transaction.transactionId) ||
        !transaction.productId || !Number.isSafeInteger(transaction.quantity) || transaction.quantity !== 1 || transaction.type !== 'Consumable' ||
        transaction.inAppOwnershipType !== 'PURCHASED') throw new PurchaseError('PURCHASE_METADATA_INVALID', 400);
    const product = findCatalogProduct(productCatalog, transaction.productId);
    if (!product) throw new PurchaseError('PURCHASE_METADATA_INVALID', 400);
    if (typeof transaction.appAccountToken !== 'string' || !isUuid(transaction.appAccountToken.toLowerCase())) throw new PurchaseError('PURCHASE_METADATA_INVALID', 400);
    if (transaction.appAccountToken.toLowerCase() !== principal.ownerId) throw new PurchaseError('PURCHASE_ACCOUNT_TOKEN_MISMATCH', 409);

    const outcome = wallet.transaction(tx => {
      const now = canonicalNow(clock);
      const fresh = resolveAccessPrincipal(db, accessToken, new Date(now));
      const user = tx.get<{ deleted_at: string | null }>('SELECT deleted_at FROM users WHERE id=?', principal.ownerId);
      const appleIdentity = tx.get('SELECT 1 FROM identities WHERE user_id=? AND provider=\'apple\'', principal.ownerId);
      if (!fresh || fresh.ownerId !== principal.ownerId || fresh.sessionId !== principal.sessionId || fresh.familyId !== principal.familyId || !user || user.deleted_at || !appleIdentity) throw new PurchaseError('AUTH_REQUIRED', 401);

      const existing = tx.get<{ id: string; owner_id: string; product_id: string }>('SELECT id,owner_id,product_id FROM purchases WHERE environment=? AND transaction_id=?', request.environment, transaction.transactionId!);
      if (existing && (existing.owner_id !== principal.ownerId || existing.product_id !== product.productId)) throw new PurchaseError('PURCHASE_OWNER_CONFLICT', 409);
      if ((transaction.revocationDate !== undefined && transaction.revocationDate !== null) || hasAppleRevocationTombstoneInTransaction(tx, request.environment, transaction.transactionId!)) {
        if (options.onVerifiedRevocationInTransaction?.(wallet, tx, request.environment, transaction.transactionId!, product.productId, now) !== true) throw new PurchaseError('PURCHASE_REVOCATION_UNAVAILABLE', 503);
        return { kind: 'revoked' as const };
      }
      if (request.environment === Environment.SANDBOX) return { kind: 'sandbox' as const };

      const purchaseId = existing?.id ?? makeId();
      if (!existing) {
        tx.run('INSERT INTO purchases(id,owner_id,environment,transaction_id,product_id,created_at) VALUES(?,?,?,?,?,?)', purchaseId, principal.ownerId, request.environment, transaction.transactionId!, product.productId, now);
      }
      const sourceEventKey = `apple-purchase:v1:${request.environment}:${hash(transaction.transactionId!)}`;
      wallet.grantInTransaction(tx, { ownerId: principal.ownerId, kind: 'purchased', sourceKind: 'purchase', purchaseId, sourceEventKey, units: product.units, scope: 'live', createdAt: existing ? undefined : now });
      if (!existing) {
        const payload = JSON.stringify({ version: 1, environment: request.environment, transactionDigest: hash(transaction.transactionId!), productId: product.productId, units: product.units, scope: 'live' });
        tx.run("INSERT INTO purchase_events(id,purchase_id,event_type,payload_json,created_at) VALUES(?,?,'credited',?,?)", makeId(), purchaseId, payload, now);
      }
      return { kind: existing ? 'replayed' as const : 'credited' as const, purchaseId };
    });
    if (outcome.kind === 'revoked') throw new PurchaseError('PURCHASE_REVOKED', 409);
    if (outcome.kind === 'sandbox') throw new PurchaseError('SANDBOX_CREDITING_DISABLED', 409);
    return { status: outcome.kind === 'replayed' ? 'already-credited' : 'credited', purchaseId: outcome.purchaseId, units: product.units, scope: 'live' };
  }

  return Object.freeze({ catalog, confirm, verifier });
}

export type ApplePurchaseService = ReturnType<typeof createApplePurchaseService>;
