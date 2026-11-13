import type { GoogleObjectType } from "../logistics/wallet-passes.js";

export type AccountRemovalAction = "delete" | "anonymize";

interface GoogleWalletObjectRef {
  objectId: string;
  objectType: GoogleObjectType;
}

export type AccountRemovalEligibility = {
  action: AccountRemovalAction;
  reasonCode: "fresh_account" | "operational_history" | "inconsistent_operational_reference";
  accessRevoked: true;
  operationalHistoryRetained: boolean;
  /** True while the configured event is live and the account has event history. */
  activeEventConsequences: boolean;
  /** A live open door session must be closed before irreversible account closure. */
  requiresVenueExit: boolean;
  /** Non-canonical operational rows exist without accreditation; reconcile safely. */
  integrityWarning: boolean;
  /** Verified-primary-email self-service requests require a one-time PIN. */
  securityPinRequired: boolean;
  /** Unverified real accounts must prove possession of their current password. */
  reauthenticationRequired: boolean;
};

export interface UserRemovalRow {
  id: number;
  email: string;
  email_verified: boolean;
  name: string | null;
  surname: string | null;
  dni: string | null;
  is_test_account: boolean;
  badge_id: string | null;
  badge_id_history: string[];
  account_state: "active" | "removal_pending";
  removal_action: AccountRemovalAction | null;
  removal_requires_exit: boolean;
  removal_expires_at: Date | null;
  removal_idempotency_key: string | null;
}

export interface RemovalPreparation {
  targetId: number;
  action: AccountRemovalAction;
  walletPassIds: number[];
  uploadPrefixes: string[];
  exportPrefixes: string[];
  storageKeys: string[];
  googleWalletObjectIds: GoogleWalletObjectRef[];
  appleWalletPushTokens: string[];
  requiresVenueExit: boolean;
}

export interface RunAccountRemovalOptions {
  targetId: number;
  actorId: number | null;
  source: string;
  reason?: string;
  /** One-time email PIN required for verified-primary-email self-service. */
  securityPin?: string;
  /** Current credential for an unverified real self-service account. */
  reauthenticationPassword?: string;
  /** An unverified account that never had a password has none to re-enter. */
  allowPasswordlessReauthentication?: boolean;
  /** The authenticated session that initiated self-service removal, if known. */
  sessionToken?: string | null;
  /** Admin routes can force the action only after the locked preflight agrees. */
  requestedAction?: AccountRemovalAction;
  /** Internal queue jobs already have BullMQ retry semantics. */
  scheduleRetry?: boolean;
  /** The self-service idempotency row remains in an identity-free scope. */
  preserveIdempotency?: {
    key: string;
    scope: string;
    completionScope: string;
  };
  /** Internal retry guard: never restart a removal that was cancelled. */
  retryOnlyPending?: boolean;
  /** Internal worker handoff: provider invalidation already succeeded. */
  skipWalletProviderInvalidation?: boolean;
}

export type AccountRemovalResult =
  | { status: "completed"; deleted: true; anonymized?: never }
  | { status: "completed"; anonymized: true; deleted?: never }
  | { status: "pending_exit"; pendingExit: true; accessRevoked: true }
  | { status: "processing"; accessRevoked: true };

export type OperationalSignals = {
  accredited: boolean;
  hasIntegritySignals: boolean;
};

export type RemovalVenueState = {
  /** Raw door state: the latest door event is an `in`. */
  open: boolean;
  /** Whether identity must remain available for a real or system exit. */
  requiresExit: boolean;
  /** The latest H24 certainty window expired and no longer credits presence. */
  expired: boolean;
};

export type PendingAccountRemovalStatus =
  | { status: "active" }
  | {
      status: "pending_exit";
      action: "anonymize";
      expiresAt: string;
      canCancel: true;
    }
  | {
      status: "processing";
      action: AccountRemovalAction;
      expiresAt: string | null;
      canCancel: false;
    };

export type WalletArtifacts = Pick<
  RemovalPreparation,
  "walletPassIds" | "googleWalletObjectIds" | "appleWalletPushTokens"
>;

export type RemovalRetryJob = Omit<
  RunAccountRemovalOptions,
  | "scheduleRetry"
  | "reauthenticationPassword"
  | "retryOnlyPending"
  | "skipWalletProviderInvalidation"
> & {
  requestedAction: AccountRemovalAction;
  retryOnlyPending: true;
  walletPassIds: number[];
};

export type AnonymousAuditValue = string | number | boolean | Array<string | number | boolean>;

export type AnonymousAuditField = {
  applicationId: number;
  applicationFormVersion: number;
  fieldKey: string;
  dimension: string | null;
  fieldKind: string;
  value: AnonymousAuditValue;
};
