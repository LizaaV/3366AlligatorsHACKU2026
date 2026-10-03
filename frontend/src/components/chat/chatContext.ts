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
      return ['What changed on this dashboard today?', 'Which block needs my attention?'];
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

export const contextHint = (ctx: ChatContext, placeName?: string): string => {
  switch (ctx.kind) {
    case 'place':
      return placeName ? `Asking about ${placeName}` : 'Asking about this place';
    case 'dashboard':
      return 'Asking about your dashboard';
    case 'trigger':
      return ctx.triggerId ? 'Asking about this trigger' : 'Asking about your triggers';
    case 'library':
      return ctx.skillId ? 'Asking about this skill' : 'Asking about the skills library';
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
