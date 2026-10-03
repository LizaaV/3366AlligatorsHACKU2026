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
import { MapPickMethod } from './MapPickMethod';
import { UploadMethod } from './UploadMethod';
import { ParcelMethod } from './ParcelMethod';
import { WhatsAppMethod } from './WhatsAppMethod';
import { ProjectMethod } from './ProjectMethod';

export function MethodInput({ method, onChange }: { method: Method; onChange: (loc: Loc | null) => void }) {
  switch (method) {
    case 'search':
      return <SearchMethod onChange={onChange} />;
    case 'coords':
      return <CoordsMethod onChange={onChange} />;
    case 'draw':
      return <MapPickMethod mode="draw" onChange={onChange} />;
    case 'pin':
      return <MapPickMethod mode="pin" onChange={onChange} />;
    case 'upload':
      return <UploadMethod onChange={onChange} />;
    case 'parcel':
      return <ParcelMethod onChange={onChange} />;
    case 'whatsapp':
      return <WhatsAppMethod onChange={onChange} />;
    case 'project':
      return <ProjectMethod onChange={onChange} />;
    default:
      return assertNever(method);
  }
}

/** Compile-time proof that every method has a component. */
function assertNever(method: never): null {
  void method;
  return null;
}
