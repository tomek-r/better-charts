import { useContext, type Context } from 'react';

export function useRequiredContext<T>(context: Context<T | null>, errorMessage: string): T {
  const value = useContext(context);
  if (value === null) {
    throw new Error(errorMessage);
  }
  return value;
}
