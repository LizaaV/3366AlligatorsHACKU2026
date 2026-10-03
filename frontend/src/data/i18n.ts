// Interface strings. The app is English only; `t(key)` falls back to the key itself.

type Dict = Record<string, string>;

const en: Dict = {
  'nav.ask': 'Ask', 'nav.places': 'Places', 'nav.watches': 'Watches', 'nav.library': 'Library',
  'hero.eyebrow': 'Connecting satellites to you', 'hero.title': 'Ask the planet a question.',
  'hero.sub': 'Ask about any field, coast or city. The agent picks the satellites, cleans the images and returns an answer with proof you can keep watching.',
  'chat.placeholder': 'Ask about any place on Earth…', 'chat.try': 'Try asking', 'chat.place': 'Place', 'chat.noPlace': 'No place · general question',
  'cta.saveWatch': 'Keep watching', 'cta.export': 'Export', 'cta.expert': 'Ask an expert', 'cta.addPlace': 'Add place', 'cta.newWatch': 'New watch', 'cta.newSkill': 'Build a skill',
  'cta.askHere': 'Ask about this place', 'cta.explore': 'Library',
  'tier.free': 'Free', 'tier.paid': 'Paid',
  'places.title': 'Places', 'places.sub': 'Fields, plots, sites and water bodies you have saved. Pick one to ask about it.',
  'watches.title': 'Triggers', 'watches.sub': 'Things the agent looks out for on every new satellite pass, and tells you when they happen.',
  'library.title': 'Skills library', 'library.sub': 'Reproducible recipes that turn a question into satellite steps. Official skills are built and validated by Constellation.',
  'common.all': 'All',
  'nav.triggers': 'Triggers',
  'nav.dashboard': 'Dashboard',
  'dashboard.title': 'Dashboards', 'dashboard.sub': 'Boards of live blocks you saved from answers. Refresh a block to re-run it on the latest satellite pass.',
  'cta.newTrigger': 'New trigger',
  'hero.line': "Ask any question about any place on Earth — we read free satellite images and answer in plain language.",
};

export const translate = (key: string) => en[key] ?? key;
