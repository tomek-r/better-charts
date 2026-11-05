/** A data attribute that exists only while its condition holds, which is how object-tree.css selects it. */
export function presentWhileTrue(holds: boolean): 'true' | undefined {
  return holds ? 'true' : undefined;
}
