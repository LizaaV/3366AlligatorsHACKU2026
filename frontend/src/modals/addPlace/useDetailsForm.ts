/**
 * Step 3: name, project, category, tags, and which watches to start.
 *
 * The locate-method can *suggest* a name and a category; this hook applies those suggestions
 * only until the user has touched the field themselves. The previous version re-applied the
 * suggestion every time step 3 was entered, so going Back and Continue again silently reverted
 * a category the user had just chosen — and that in turn cleared their watch selections.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import type { Loc } from './types';

export function useDetailsForm(loc: Loc | null) {
  const { places, skills } = useStore();
  const projects = useMemo(() => Array.from(new Set(places.map((p) => p.project))), [places]);

  const [name, setName] = useState('');
  const [project, setProject] = useState<string | null>(null);
  const [newProject, setNewProject] = useState('');
  const [categoryKey, setCategoryKey] = useState('agriculture');
  const [tags, setTags] = useState('');
  const [startWatch, setStartWatch] = useState<string[]>([]);

  const nameTouched = useRef(false);
  const categoryTouched = useRef(false);

  // `places` may still be loading when the modal opens, so the default project is resolved
  // lazily rather than captured at first render (where it would stick on "New project…").
  const effectiveProject = project ?? projects[0] ?? '__new';

  const suggested = useMemo(() => skills.filter((sk) => sk.categoryKey === categoryKey).slice(0, 3), [skills, categoryKey]);

  // Changing category changes which watches are on offer, so a stale selection is cleared —
  // but only when the user actually changes it, not on mount.
  const firstCategory = useRef(true);
  useEffect(() => {
    if (firstCategory.current) { firstCategory.current = false; return; }
    setStartWatch([]);
  }, [categoryKey]);

  /** Apply what the locate-method suggested, without overwriting the user's own choices. */
  const applySuggestions = useCallback((at: Loc) => {
    if (!nameTouched.current) setName(at.label);
    if (at.categoryKey && !categoryTouched.current) setCategoryKey(at.categoryKey);
  }, []);

  const finalName = name.trim();
  const finalProject = effectiveProject === '__new' ? newProject.trim() : effectiveProject;

  return {
    projects,
    name, setName: (v: string) => { nameTouched.current = true; setName(v); },
    project: effectiveProject, setProject,
    newProject, setNewProject,
    categoryKey, setCategoryKey: (v: string) => { categoryTouched.current = true; setCategoryKey(v); },
    tags, setTags,
    startWatch, setStartWatch,
    suggested,
    finalName, finalProject,
    applySuggestions,
    /** Whether step 3 has enough to save. */
    complete: !!finalName && !!finalProject && !!loc,
  };
}

export type DetailsForm = ReturnType<typeof useDetailsForm>;
