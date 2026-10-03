import { createContext, useContext, type ReactNode } from 'react';

const ChromeMarkContext = createContext<ReactNode>(null);

/** Renders `mark` at the top of every Screen under this provider. */
export function ChromeMark({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return <ChromeMarkContext.Provider value={mark}>{children}</ChromeMarkContext.Provider>;
}

export function useChromeMark(): ReactNode {
  return useContext(ChromeMarkContext);
}
