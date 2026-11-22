/** One choice of a `Select`: the stored value, the text the user reads, and whether it can be picked yet. */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
  /** A disabled choice is listed but cannot be picked: the arrows, typing and clicks step over it. */
  readonly disabled?: boolean;
  /** The tooltip a choice explains itself with, usually the reason it is disabled. */
  readonly title?: string;
}
