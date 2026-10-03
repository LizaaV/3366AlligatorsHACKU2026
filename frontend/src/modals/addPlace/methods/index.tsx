/**
 * Picks the component for the chosen locate-method.
 *
 * Each method owns its own state, so switching method unmounts the previous one and its inputs
 * go with it. The old single-component version kept every method's state alive in one scope,
 * so a drawn outline survived a switch to "upload" and could still be read afterwards.
 */

import type { Loc, Method } from '../types';
import { SearchMethod } from './SearchMethod';
import { CoordsMethod } from './CoordsMethod';
import { PinMethod } from './PinMethod';
import { UploadMethod } from './UploadMethod';

export function MethodInput({ method, onChange }: { method: Method; onChange: (loc: Loc | null) => void }) {
  switch (method) {
    case 'search':
      return <SearchMethod onChange={onChange} />;
    case 'coords':
      return <CoordsMethod onChange={onChange} />;
    case 'pin':
      return <PinMethod onChange={onChange} />;
    case 'upload':
      return <UploadMethod onChange={onChange} />;
    default:
      return assertNever(method);
  }
}

/** Compile-time proof that every method has a component. */
function assertNever(method: never): null {
  void method;
  return null;
}
