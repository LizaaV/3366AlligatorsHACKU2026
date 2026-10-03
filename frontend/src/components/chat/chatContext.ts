/**
 * What the chat is "about", shared by the full chat on the Ask tab and the floating bubble on
 * every other page.
 */

import type { Route } from '../../router';
import type { AskTurn } from '../../ask/useAskRun';

export type ChatContext =
  | { kind: 'general' }
  | { kind: 'place'; placeId: string }
  | { kind: 'dashboard'; dashboardId?: string }
  | { kind: 'trigger'; triggerId?: string }
  | { kind: 'library'; skillId?: string };

/**
 * Derive the context from the route. Page names are compared as plain strings so this keeps
 * working when the Dashboard page (`#/dashboard`) is added to the router by another branch.
 */
export function contextFromRoute(route: Route): ChatContext {
  const page = route.page as string;
  if (page === 'places' && route.id) return { kind: 'place', placeId: route.id };
  if (page === 'dashboard') return { kind: 'dashboard', dashboardId: route.id };
  if (page === 'triggers') return { kind: 'trigger', triggerId: route.id };
  if (page === 'library') return { kind: 'library', skillId: route.id && route.id !== 'new' ? route.id : undefined };
  return { kind: 'general' };
}

/** The place a context pins questions to, if any. */
export const contextPlaceId = (ctx: ChatContext): string | null => (ctx.kind === 'place' ? ctx.placeId : null);

export const contextKey = (ctx: ChatContext) => JSON.stringify(ctx);

/** Suggested first questions for the bubble, by where the user is. */
export const contextSuggestions = (ctx: ChatContext, placeName?: string): string[] => {
  switch (ctx.kind) {
    case 'place':
      return [`How healthy is ${placeName ?? 'this place'} this week?`, 'Where are the dry patches?', 'What changed here since last month?'];
    case 'dashboard':
      return ['Which free satellite is best for crop health?', 'How can I map a flood through clouds?'];
    case 'trigger':
      return ctx.triggerId
        ? ['What changed since the last pass?', 'Is this normal for the time of year?', 'When will it cross my threshold?']
        : ['What changed since last week?', 'Which place needs attention first?', 'What does this mean for my irrigation?'];
    case 'library':
      return ['Which skill fits crop health?', 'What does this skill need as input?'];
    default:
      return ['Which free satellite is best for crop health?', 'How can I map a flood through clouds?'];
  }
};

/**
 * What a question from the bubble really carries. `RunRequest` has a place and a skill but no
 * dashboard or trigger field, so the hint names only what is sent.
 */
export const contextHint = (ctx: ChatContext, placeName?: string, skillName?: string): string => {
  switch (ctx.kind) {
    case 'place':
      return placeName ? `Asking about ${placeName}` : 'Asking about this place';
    case 'trigger':
    case 'library': {
      const parts = [placeName && `Asking about ${placeName}`, skillName && `${placeName ? 'using' : 'Using'} the “${skillName}” skill`].filter(Boolean);
      return parts.length ? parts.join(' ') : 'General question';
    }
    default:
      return 'General question';
  }
};

/* ---------------------------------------------------------------- hand-off */

/**
 * "Open in full chat": the bubble leaves its conversation here and the Ask page picks it up.
 * A module variable rather than the URL, because a conversation does not fit in a hash.
 */
export interface ChatHandoff {
  turns: AskTurn[];
  placeId: string | null;
  /** An artifact to select once the Ask page has the conversation. */
  artifactId?: string;
}

let pending: ChatHandoff | null = null;

export const setChatHandoff = (h: ChatHandoff) => {
  pending = h;
};

export const takeChatHandoff = (): ChatHandoff | null => {
  const h = pending;
  pending = null;
  return h;
};

/**
 * The skill a context pins questions to, if it exists in the loaded skills: the skill being
 * viewed in the library, or the skill a trigger runs.
 */
export const contextSkillId = (
  ctx: ChatContext,
  watches: { id: string; skillId: string }[],
  skills: { id: string }[],
): string | null => {
  const id =
    ctx.kind === 'library' ? ctx.skillId : ctx.kind === 'trigger' && ctx.triggerId ? watches.find((w) => w.id === ctx.triggerId)?.skillId : undefined;
  return id && skills.some((s) => s.id === id) ? id : null;
};
