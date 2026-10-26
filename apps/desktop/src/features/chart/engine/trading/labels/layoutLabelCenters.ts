/** Distance between label centres: a 20px body plus its tips and gap. */
const LABEL_CENTER_SPACING_PX = 32;
/** Closest a label centre may come to the pane's top or bottom edge. */
const LABEL_EDGE_INSET_PX = 15;

/** Least-squares placement with LABEL_CENTER_SPACING_PX between centres (20px body + tips/gap).
 * Pool adjacent collisions so displacement is shared instead of pushing all
 * rows down. Input is sorted by desired centre; isolated rows stay in place. */
export function layoutLabelCenters(desired: number[], top: number, bottom: number): number[] {
  const blocks: Array<{ start: number; count: number; mean: number }> = [];
  desired.forEach((y, i) => {
    blocks.push({ start: i, count: 1, mean: y - i * LABEL_CENTER_SPACING_PX });
    while (blocks.length > 1 && blocks.at(-2)!.mean > blocks.at(-1)!.mean) {
      const right = blocks.pop()!;
      const left = blocks.pop()!;
      blocks.push({
        start: left.start,
        count: left.count + right.count,
        mean: (left.mean * left.count + right.mean * right.count) / (left.count + right.count),
      });
    }
  });
  const result: number[] = [];
  const lower = top + LABEL_EDGE_INSET_PX;
  const upper = Math.max(lower, bottom - LABEL_EDGE_INSET_PX - (desired.length - 1) * LABEL_CENTER_SPACING_PX);
  for (const block of blocks) {
    const base = Math.max(lower, Math.min(upper, block.mean));
    for (let i = block.start; i < block.start + block.count; i++) {
      result[i] = base + i * LABEL_CENTER_SPACING_PX;
    }
  }
  return result;
}
