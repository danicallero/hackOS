/**
 * Several queue actions are legitimately reachable from more than one
 * capability (e.g. notify_enter and no_show are both a judge-view action AND
 * an operator-view action). `requireAnyCapability` now lives in the shared
 * capabilities lib; re-exported here to keep the queue module's imports stable.
 */
export { requireAnyCapability } from "../../lib/capabilities.js";
