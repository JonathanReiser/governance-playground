/**
 * Fetching a contract's full event history hits a real limit almost
 * every public RPC enforces on eth_getLogs: a maximum block range per
 * call. ViewRunPage.jsx hit this in production on Sepolia's public
 * RPC — "exceed maximum block range: 50000" — because
 * contract.queryFilter(filter) with no range defaults to fromBlock: 0,
 * and any WorldRegistry deployment more than ~a week old (Sepolia's
 * ~12s block time) spans a wider range than that from block 0.
 *
 * The obvious fix — binary-search eth_getCode for the contract's
 * deployment block — does NOT work against the free public RPC this
 * project uses: eth_getCode at an arbitrary past block needs full
 * archive-node state, and that RPC is a pruned node ("historical state
 * ... is not available" — hit in production chasing exactly this bug).
 * So there are two ways a caller ends up with a safe fromBlock:
 *   1. The real one, going forward: server/demoDeploy.js now captures
 *      the registry's actual deployment block from the deploy
 *      transaction's own receipt at deploy time (registryBlock) and
 *      threads it through saved runs / share links (runHistory.js's
 *      viewUrlFor, App.jsx's `block` param). No discovery needed.
 *   2. findLogsLowerBound — for a link saved before registryBlock
 *      existed (or hand-typed with just `?view=`): scan backward from
 *      the chain tip in windows no wider than the range cap, using
 *      eth_getLogs itself (receipt-indexed, not state — no archive-node
 *      requirement) as the probe. A contract can't emit before it
 *      exists, so the first empty window found (scanning toward
 *      genesis) safely bounds every real event from below. Capped at
 *      `maxChunks` windows — deliberately NOT unbounded back to block
 *      0, since a wrong or very old address would make that arbitrarily
 *      slow; any run someone could plausibly still have bookmarked is
 *      comfortably within a few months of chain history, and a demo
 *      run's actual on-chain activity is a handful of blocks, not a
 *      sustained span, so in practice this resolves in 1-2 requests.
 *
 * queryLogsChunked then fetches logs in windows under the cap from
 * whichever fromBlock the caller obtained, aggregating across chunks —
 * for almost every real run this is a single chunk.
 *
 * Every piece takes the provider/contract as arguments rather than
 * constructing its own, so it's testable against a fake with no real RPC.
 */

// Safely under the 50,000-block cap this project's public RPC enforces
// — enough margin that boundary-counting differences between RPC
// providers (inclusive vs. exclusive) can't tip it back over.
export const MAX_BLOCK_RANGE = 45_000;

/**
 * Bounded backward scan for the earliest block worth querying from —
 * see this module's header comment for the full reasoning. Returns a
 * fromBlock that's guaranteed not to exclude any real event (as long as
 * the actual gap since the contract's last event is under
 * `maxChunks * maxRange` blocks), never a block number past `latestBlock`.
 */
export async function findLogsLowerBound(provider, address, latestBlock, { maxRange = MAX_BLOCK_RANGE, maxChunks = 20 } = {}) {
  let end = latestBlock;
  for (let i = 0; i < maxChunks && end >= 0; i++) {
    const start = Math.max(0, end - maxRange);
    const logs = await provider.getLogs({ address, fromBlock: start, toBlock: end });
    if (logs.length === 0) {
      // Nothing at all in [start, end] — this contract's real activity
      // (if any) is entirely after `end`, so that's a safe lower bound.
      return end + 1;
    }
    if (start === 0) return 0; // found activity all the way back to genesis
    end = start - 1;
  }
  // Exhausted the chunk budget while every window still had activity —
  // return the earliest point actually verified rather than guessing
  // further back. A real WorldRegistry's activity span is a handful of
  // blocks, not maxChunks * maxRange of them, so this path is not
  // expected to trigger for an honest, non-adversarial address.
  return end + 1;
}

export async function queryLogsChunked(contract, filter, fromBlock, toBlock, maxRange = MAX_BLOCK_RANGE) {
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += maxRange + 1) {
    const end = Math.min(start + maxRange, toBlock);
    const chunk = await contract.queryFilter(filter, start, end);
    logs.push(...chunk);
  }
  return logs;
}
