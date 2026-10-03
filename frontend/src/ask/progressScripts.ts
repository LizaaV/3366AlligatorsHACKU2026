/**
 * Prewritten step sequences for the fixture run stream (`api/endpoints/runs.ts`), used only
 * when `VITE_API_SOURCE=fixture`. Against the real backend the steps are the ones the agent
 * actually took, arriving as stream events.
 *
 * These are *presentation only* — they deliberately never state a finding. Every step
 * describes process ("kept 7 of 12 scenes", "applied cloud mask"); the numbers, confidence
 * and conclusions come from the answer and are rendered by the answer card.
 *
 * One script is picked at random per run, so a user who asks several questions does not
 * see the same sequence twice in a row.
 *
 * Keep each script between 6 and 9 steps: fewer feels abrupt, more outlasts a normal
 * response and starts to feel like padding.
 */

export interface ProgressStep {
  /** Headline for the step — what the agent is doing right now. */
  tool: string;
  /** Short stage label, shown dimmed before the description. */
  title: string;
  /** Plain-language explanation, written for a non-expert. */
  desc: string;
  /** Optional chip shown once the step completes. Process facts only, never findings. */
  result?: string;
}

export interface ProgressScript {
  id: string;
  /** Internal note on when this script reads best. Not shown to users. */
  label: string;
  steps: ProgressStep[];
}

export const PROGRESS_SCRIPTS: ProgressScript[] = [
  {
    id: 'standard-optical',
    label: 'Default optical pipeline — the most common route.',
    steps: [
      { tool: 'Read the question', title: 'Understand', desc: 'Work out what is being asked and which measurements could answer it.', result: 'Matched to a measurable question' },
      { tool: 'Loaded the area', title: 'Mark the area', desc: 'Pull the outline and work out how much ground it covers.' },
      { tool: 'Set the time window', title: 'Pick dates', desc: 'The last few weeks, plus the same weeks in earlier years for comparison.', result: 'Recent window + multi-year baseline' },
      { tool: 'Chose Sentinel-2', title: 'Pick the satellite', desc: 'Free sources are checked first; paid imagery only if the area is too small to see.', result: 'Free · 10 m · 5-day revisit' },
      { tool: 'Filtered the scenes', title: 'Find clear images', desc: 'Drop anything too cloudy, and anything taken right after rain.', result: 'Kept 7 of 12 · 3 cloudy, 2 after rain' },
      { tool: 'Cleaned the images', title: 'Prepare the data', desc: 'Cut each image to the outline, then mask out cloud and shadow.', result: 'Clipped · cloud & shadow mask applied' },
      { tool: 'Computed the indices', title: 'Measure', desc: 'Turn raw bands into the plant, water and temperature measures the question needs.' },
      { tool: 'Compared with the baseline', title: 'Find what changed', desc: 'Hold every date against what is normal here for this time of year.' },
      { tool: 'Writing the answer', title: 'Explain', desc: 'Summarise what was found, how sure it is, and what to do next.' },
    ],
  },
  {
    id: 'cloud-gauntlet',
    label: 'Cloud-heavy route — leans on honest data loss.',
    steps: [
      { tool: 'Read the question', title: 'Understand', desc: 'Decide what has to be measured to answer this properly.' },
      { tool: 'Loaded the area', title: 'Mark the area', desc: 'Pull the outline and check it is big enough for free imagery.' },
      { tool: 'Searched the archive', title: 'Find passes', desc: 'Every satellite pass over this spot in the chosen window.', result: '14 passes found' },
      { tool: 'Checked the cloud cover', title: 'Screen the scenes', desc: 'Cloud hides the ground, so those dates cannot be used.', result: '6 of 14 too cloudy to use' },
      { tool: 'Checked the weather record', title: 'Screen again', desc: 'Images taken just after rain read as wetter than normal and skew the result.', result: '2 more dropped · rain within 48 h' },
      { tool: 'Built a clear-sky stack', title: 'Prepare the data', desc: 'Keep only the usable dates and line them up on the same grid.', result: '6 usable dates kept' },
      { tool: 'Filled the gaps', title: 'Handle the gaps', desc: 'Mark where the record is thin so the answer can say so honestly.' },
      { tool: 'Computed the indices', title: 'Measure', desc: 'Run the measurements across every clear date.' },
      { tool: 'Writing the answer', title: 'Explain', desc: 'Report the finding together with how much of the record was lost to cloud.' },
    ],
  },
  {
    id: 'radar-through-cloud',
    label: 'Radar route — when optical cannot see through weather.',
    steps: [
      { tool: 'Read the question', title: 'Understand', desc: 'Work out whether this needs to be seen through cloud or at night.' },
      { tool: 'Loaded the area', title: 'Mark the area', desc: 'Pull the outline and its surroundings for context.' },
      { tool: 'Checked optical cover', title: 'Try the obvious source', desc: 'Optical imagery first — it is easier to interpret when it is available.', result: 'Mostly cloudy in this window' },
      { tool: 'Switched to Sentinel-1', title: 'Pick the satellite', desc: 'Radar works through cloud, day and night, and it is free.', result: 'Free · radar · 6-day revisit' },
      { tool: 'Calibrated the radar', title: 'Prepare the data', desc: 'Correct for terrain and the angle the satellite looked from.', result: 'Terrain-corrected · speckle filtered' },
      { tool: 'Compared the passes', title: 'Find what changed', desc: 'Radar brightness changes where the surface changes.' },
      { tool: 'Cross-checked optically', title: 'Confirm', desc: 'Use the one clear optical date available to sanity-check the radar.' },
      { tool: 'Writing the answer', title: 'Explain', desc: 'Report what radar can and cannot distinguish here.' },
    ],
  },
  {
    id: 'baseline-years',
    label: 'Historical baseline route — "is this actually unusual?"',
    steps: [
      { tool: 'Read the question', title: 'Understand', desc: 'This needs a sense of what is normal here, not just what is happening now.' },
      { tool: 'Loaded the area', title: 'Mark the area', desc: 'Pull the outline so every year is measured over the same ground.' },
      { tool: 'Pulled this season', title: 'Recent data', desc: 'Every usable pass over the last few weeks.' },
      { tool: 'Pulled five years back', title: 'Historical data', desc: 'The same calendar weeks in each of the last five years.', result: 'Baseline built from 5 years' },
      { tool: 'Aligned the dates', title: 'Make it comparable', desc: 'Match this year against the same point in the season, not the same date.' },
      { tool: 'Built the normal range', title: 'Define normal', desc: 'Work out the usual spread, so "unusual" means something specific.', result: 'Range and average computed' },
      { tool: 'Positioned this year', title: 'Compare', desc: 'Place the current reading inside or outside that normal range.' },
      { tool: 'Writing the answer', title: 'Explain', desc: 'Say how far from normal this is, and how confident that is.' },
    ],
  },
  {
    id: 'cross-check',
    label: 'Two-sensor agreement route — builds trust through corroboration.',
    steps: [
      { tool: 'Read the question', title: 'Understand', desc: 'Decide what would count as solid evidence here.' },
      { tool: 'Loaded the area', title: 'Mark the area', desc: 'Pull the outline and lock it so both sources measure the same ground.' },
      { tool: 'Chose a primary source', title: 'Pick the satellite', desc: 'The best free source for this kind of question.', result: 'Primary source selected' },
      { tool: 'Added a second source', title: 'Pick a cross-check', desc: 'A different satellite, so one sensor is not the only evidence.', result: 'Second independent source added' },
      { tool: 'Resampled to one grid', title: 'Prepare the data', desc: 'The two sources see at different detail; put them on a shared grid.' },
      { tool: 'Measured both', title: 'Measure', desc: 'Run the measurement separately on each source.' },
      { tool: 'Tested agreement', title: 'Confirm', desc: 'Where the two agree, confidence goes up; where they differ, it goes down.', result: 'Agreement checked date by date' },
      { tool: 'Writing the answer', title: 'Explain', desc: 'Report the finding and whether both sources back it.' },
    ],
  },
  {
    id: 'resolution-routing',
    label: 'Resolution routing — honest about what free pixels can resolve.',
    steps: [
      { tool: 'Read the question', title: 'Understand', desc: 'Work out how small a feature would have to be visible to answer this.' },
      { tool: 'Measured the area', title: 'Mark the area', desc: 'Size the outline, because size decides which satellite can see it.' },
      { tool: 'Checked free resolution', title: 'Pick the satellite', desc: 'Free imagery sees 10 m pixels — fine for fields, not for small objects.', result: 'Checked against the 10 m limit' },
      { tool: 'Weighed the paid option', title: 'Consider paid', desc: 'Sharper imagery costs money, so it is only suggested when it changes the answer.', result: 'Paid option priced, not ordered' },
      { tool: 'Stayed on free data', title: 'Decide', desc: 'Free sources can answer this; nothing is charged.', result: 'Free sources only' },
      { tool: 'Filtered the scenes', title: 'Find clear images', desc: 'Keep the dates clear enough to measure.' },
      { tool: 'Measured at the edges', title: 'Measure', desc: 'Edges are where coarse pixels blur, so uncertainty is estimated there.' },
      { tool: 'Writing the answer', title: 'Explain', desc: 'Give the result with the margin that pixel size implies.' },
    ],
  },
  {
    id: 'change-over-time',
    label: 'Time-series route — emphasises trend over a single reading.',
    steps: [
      { tool: 'Read the question', title: 'Understand', desc: 'This is about a direction of travel, not a single snapshot.' },
      { tool: 'Loaded the area', title: 'Mark the area', desc: 'Pull the outline so every date covers the same ground.' },
      { tool: 'Built the time series', title: 'Assemble the record', desc: 'One measurement per usable pass, in order.', result: 'Series built across the window' },
      { tool: 'Removed the outliers', title: 'Clean the record', desc: 'Drop readings distorted by haze, shadow or a partial pass.' },
      { tool: 'Fitted the trend', title: 'Find the direction', desc: 'Work out whether this is rising, falling or flat, and how fast.' },
      { tool: 'Tested the trend', title: 'Check it is real', desc: 'A short run of dates can look like a trend by chance; test against that.', result: 'Trend tested against noise' },
      { tool: 'Projected the next pass', title: 'Look ahead', desc: 'If this rate holds, say when it would cross a threshold worth acting on.' },
      { tool: 'Writing the answer', title: 'Explain', desc: 'Report the direction, the rate, and how sure the direction is.' },
    ],
  },
  {
    id: 'thermal-assist',
    label: 'Thermal route — surface temperature as supporting evidence.',
    steps: [
      { tool: 'Read the question', title: 'Understand', desc: 'Temperature can support this, though it rarely answers it alone.' },
      { tool: 'Loaded the area', title: 'Mark the area', desc: 'Pull the outline and a surrounding margin for comparison.' },
      { tool: 'Chose an optical source', title: 'Pick the satellite', desc: 'Start with the detailed free optical imagery.', result: 'Free · 10 m' },
      { tool: 'Added Landsat thermal', title: 'Add temperature', desc: 'Surface temperature comes in at 100 m — coarse, but free and useful.', result: 'Free · 100 m thermal' },
      { tool: 'Matched the dates', title: 'Line them up', desc: 'The two satellites pass on different days; pair the closest dates.', result: 'Date pairs matched' },
      { tool: 'Compared inside and out', title: 'Measure', desc: 'Temperature only means something relative to the ground around it.' },
      { tool: 'Weighted the evidence', title: 'Combine', desc: 'Thermal supports the finding; it is too coarse to size it on its own.' },
      { tool: 'Writing the answer', title: 'Explain', desc: 'Separate what was measured from what the temperature merely supports.' },
    ],
  },
  {
    id: 'water-indices',
    label: 'Water route — surfaces, edges and colour.',
    steps: [
      { tool: 'Read the question', title: 'Understand', desc: 'Work out whether this is about the extent of water or its condition.' },
      { tool: 'Loaded the area', title: 'Mark the area', desc: 'Pull the outline, including the shoreline margin.' },
      { tool: 'Filtered the scenes', title: 'Find clear images', desc: 'Water reads badly through cloud and glare; keep the clean dates.', result: 'Glare and cloud screened' },
      { tool: 'Traced the water edge', title: 'Find the boundary', desc: 'Water and land separate cleanly in the infrared bands.' },
      { tool: 'Measured the surface', title: 'Measure', desc: 'Area inside the traced edge, on every usable date.' },
      { tool: 'Checked the shallows', title: 'Check the hard part', desc: 'Shallow and muddy edges are where this measurement is least reliable.', result: 'Edge uncertainty estimated' },
      { tool: 'Compared with the baseline', title: 'Compare', desc: 'Hold the result against the normal seasonal pattern here.' },
      { tool: 'Writing the answer', title: 'Explain', desc: 'Report the measurement and where the edge is least certain.' },
    ],
  },
  {
    id: 'library-routing',
    label: 'General question route — no place selected, answers from the catalogue.',
    steps: [
      { tool: 'Read the question', title: 'Understand', desc: 'Work out what kind of question this is before reaching for data.', result: 'General question · no place needed' },
      { tool: 'Searched the library', title: 'Find the method', desc: 'Look for skills built to answer this kind of question.' },
      { tool: 'Checked the satellites', title: 'Check what can see it', desc: 'Which free and paid sources could realistically answer it.', result: 'Free options checked first' },
      { tool: 'Compared the trade-offs', title: 'Weigh them up', desc: 'Detail, how often it passes over, and cost rarely point the same way.' },
      { tool: 'Checked the limits', title: 'Find the catch', desc: 'Every source has something it cannot see; that belongs in the answer.' },
      { tool: 'Writing the answer', title: 'Explain', desc: 'A short answer, plus what it can and cannot tell you.' },
    ],
  },
];

/** Pick a script at random, avoiding an immediate repeat of `exclude`. */
export function pickProgressScript(exclude?: string): ProgressScript {
  const pool = exclude ? PROGRESS_SCRIPTS.filter((s) => s.id !== exclude) : PROGRESS_SCRIPTS;
  const list = pool.length ? pool : PROGRESS_SCRIPTS;
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * The general-question scripts. `/ask` without a place has nothing to measure, so the
 * catalogue-routing choreography is the only honest one to show.
 */
export const GENERAL_SCRIPT_ID = 'library-routing';

export const scriptById = (id: string) => PROGRESS_SCRIPTS.find((s) => s.id === id);
