// A player's rating as a chip: gold text from 70, a gold tint from 85, solid
// gold from 95. The draft roster shows it (outside Hard Mode), and the scouting
// report reveals it after a Hard Mode run.

import { h } from './dom';

export function ratingChip(rating: number): HTMLElement {
  const tier = rating >= 95 ? '.r95' : rating >= 85 ? '.r85' : rating >= 70 ? '.r70' : '';
  return h(`span.rating-chip${tier}`, {}, String(rating));
}
