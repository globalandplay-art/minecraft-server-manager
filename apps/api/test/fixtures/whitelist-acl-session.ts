// Test compatibility alias; production store/default auth wiring remains absent.
export { aclSessionScript, AclSessionError, WhitelistAclSession as PrototypeAclSession } from "../../src/services/whitelist-acl-session.js";
export type { OwnedAclChild, SessionFault } from "../../src/services/whitelist-acl-session.js";
