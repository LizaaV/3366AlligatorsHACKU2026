/** "About you": the facts the agent keeps about the person, fed to every answer. */

import { useCallback, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../state/store';
import { useResource } from '../hooks/useResource';
import { ErrorState, Skeleton } from '../components/async';
import { Modal, ModalHead } from '../components/ui';
import { ProfileEditor, rowsOf } from '../components/memory/ProfileEditor';

export function AboutYouModal() {
  const { close, notify } = useStore();
  const res = useResource(useCallback((signal) => api.memory.getMe(signal), []), []);
  const [saved, setSaved] = useState<Record<string, string> | null>(null);
  const profile = saved ?? res.data?.profile;
  const rows = useMemo(() => rowsOf(profile), [profile]);

  const save = async (patch: Record<string, string>) => {
    const next = await api.memory.patchMe(patch);
    setSaved(next.profile);
    notify('Saved what the agent knows about you', undefined, undefined, 'check_circle');
  };

  return (
    <Modal onClose={close} label="About you">
      <ModalHead
        eyebrow="Private memory"
        title="About you"
        sub="Facts like your units or the crops you grow. The agent reads them on every question so its answers fit you. Only you can see this."
        onClose={close}
      />
      {res.isLoading && <Skeleton lines={4} h={14} />}
      {res.error && <ErrorState error={res.error} onRetry={res.refetch} title="Could not load your memory" />}
      {profile && (
        <ProfileEditor
          rows={rows}
          onSave={save}
          emptyHint="Nothing yet. Add a fact, for example units: metric, or crops: maize and soybean."
          keyPlaceholder="e.g. units"
          valuePlaceholder="e.g. metric"
        />
      )}
    </Modal>
  );
}
