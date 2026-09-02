/**
 * Push feature surface. Screens import from here, not from the files below, so
 * the internals (token store, device id) stay private to the module.
 */
export { PushProvider, usePush } from "@/push/PushProvider";
export type { PushPermission, PushState } from "@/push/PushProvider";
