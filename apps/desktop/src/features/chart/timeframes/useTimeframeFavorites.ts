import { useCallback, useState } from 'react';
import { loadTimeframeFavorites, saveTimeframeFavorites } from './timeframeFavorites';

export function useTimeframeFavorites() {
  const [favorites, setFavorites] = useState(() => loadTimeframeFavorites());
  const toggleFavorite = useCallback((wire: string) => {
    setFavorites((current) => {
      const next = current.includes(wire) ? current.filter((code) => code !== wire) : [...current, wire];
      saveTimeframeFavorites(next);
      return next;
    });
  }, []);
  return { favorites, toggleFavorite };
}
