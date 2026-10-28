/** Pending-order overlay ids carry this prefix so hit-testing and drags can tell them from position ids. */
export const ORDER_ID_PREFIX = 'order:';

export function orderOverlayId(orderId: string): string {
  return `${ORDER_ID_PREFIX}${orderId}`;
}

export function parseOverlayId(id: string): { isOrder: boolean; rawId: string } {
  const isOrder = id.startsWith(ORDER_ID_PREFIX);
  return { isOrder, rawId: isOrder ? id.slice(ORDER_ID_PREFIX.length) : id };
}
