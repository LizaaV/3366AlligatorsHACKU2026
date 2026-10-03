/** The bands a spot can be looked at in (rendered by `GET /api/views`). Plain names on screen. */

export type Band = 'photo' | 'greenness' | 'water' | 'bare';

export const BANDS: { id: Band; label: string; hint: string }[] = [
  { id: 'photo', label: 'Photo', hint: 'True colour, as the satellite saw it' },
  { id: 'greenness', label: 'Greenness', hint: 'Living plants: brown is bare, green is lush' },
  { id: 'water', label: 'Water', hint: 'Open water and wet ground in blue' },
  { id: 'bare', label: 'Bare ground', hint: 'Bare soil and built surfaces' },
];
