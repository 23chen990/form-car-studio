import {
  WalletRepository,
  type FinalizeInput,
  type GrantInput,
  type ReserveInput,
  type WalletScope,
  type WalletSummary,
} from "./wallet-repo";

/** Server-only wallet operations. Grants must originate from a trusted server event. */
export class WalletService {
  private readonly repository: WalletRepository;
  constructor(repository: WalletRepository) { this.repository = repository; }

  grantFromTrustedSource(input: GrantInput) {
    return this.repository.transaction((tx) => this.repository.grantInTransaction(tx, input));
  }

  reserveTask(input: ReserveInput) {
    return this.repository.transaction((tx) => this.repository.reserveTaskInTransaction(tx, input));
  }

  finalizeTask(input: FinalizeInput) {
    return this.repository.transaction((tx) => this.repository.finalizeTaskInTransaction(tx, input));
  }

  summary(ownerId: string, scope: WalletScope): WalletSummary {
    return this.repository.summary(ownerId, scope);
  }
}

export { WalletError, WalletRepository } from "./wallet-repo";
export type { FinalizeInput, GrantInput, ReserveInput, WalletScope, WalletSummary } from "./wallet-repo";
