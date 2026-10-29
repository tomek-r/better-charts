/** What a Tauri `listen` callback receives; the handlers read only the payload. */
export type PayloadEvent<T> = { payload: T };

/** The account the session is bound to, kept in refs so event handlers read the latest without re-subscribing. */
export type AccountRefs = {
  accountLoginRef: { current: string | undefined };
  brokerServerRef: { current: string | undefined };
};
