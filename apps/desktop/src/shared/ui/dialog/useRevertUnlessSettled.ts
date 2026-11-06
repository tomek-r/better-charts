import { useEffect, useEffectEvent, useRef } from 'react';

/**
 * Keeps a preview from outliving its dialog. The returned mark says the dialog left through OK or Cancel,
 * which have settled the preview themselves; a dialog that unmounts without it — its subject was removed
 * from under it, so no close ever came — calls `onRevert` instead, which drops the preview.
 */
export function useRevertUnlessSettled(onRevert: () => void): () => void {
  const settled = useRef(false);
  const revertUnlessSettled = useEffectEvent(() => {
    if (!settled.current) {
      onRevert();
    }
  });
  useEffect(() => revertUnlessSettled, []);
  return () => {
    settled.current = true;
  };
}
