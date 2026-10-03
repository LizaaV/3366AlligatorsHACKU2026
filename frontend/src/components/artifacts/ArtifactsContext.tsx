/** Lets the chat refer to artifacts (reference chips, names in the text) without knowing where they are shown. */

import { createContext, useContext } from 'react';
import type { Artifact } from './artifacts';

export interface ArtifactsApi {
  artifacts: Artifact[];
  selectedId: string | null;
  /** Select an artifact and open wherever artifacts are shown. */
  select: (id: string) => void;
}

const NONE: ArtifactsApi = { artifacts: [], selectedId: null, select: () => {} };

export const ArtifactsContext = createContext<ArtifactsApi>(NONE);
export const useArtifacts = () => useContext(ArtifactsContext);
