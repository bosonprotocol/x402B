// `ResolverActor` — the dispute-resolver-operator persona for scenario
// tests.
//
// The local Boson stack ships with a pre-deployed dispute resolver
// (`id: 1`) but the *operator account* that controls it depends on how
// the stack was set up. For e2e scenarios the operator wallet is one
// of the deterministic accounts in `ROLE_ACCOUNTS.resolver`
// (`ACCOUNT_4`). Scenarios that exercise the post-escalation decide
// path (`decideDispute(buyerPercent)`) will use this actor in PR 6.
//
// PR 5 keeps the surface minimal — wallet + entity id only. Specific
// on-chain operations land alongside the scenarios that need them.

import type { Address, LocalAccount } from "viem";

import { LOCAL_31337_0 } from "../config/local-31337-0.js";

export interface ResolverActorArgs {
  /** Operator wallet for the dispute resolver entity. */
  account: LocalAccount;
  /**
   * Boson dispute resolver entity id. Defaults to the upstream stack's
   * pre-deployed DR (`LOCAL_31337_0.defaultDisputeResolverId === "1"`).
   */
  entityId?: string;
}

export interface ResolverActor {
  readonly address: Address;
  readonly account: LocalAccount;
  /** Dispute resolver entity id on the Boson Diamond. */
  readonly entityId: string;
}

export function createResolverActor(args: ResolverActorArgs): ResolverActor {
  return {
    address: args.account.address,
    account: args.account,
    entityId: args.entityId ?? LOCAL_31337_0.defaultDisputeResolverId,
  };
}
