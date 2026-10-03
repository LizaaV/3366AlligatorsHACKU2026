/**
 * Place-examining components (stream E). Standalone; AskPage mounts them.
 *
 * LayerRail  - mount inside the map container (position: relative parent), over the map:
 *                <LayerRail layers={layers} onToggle={toggleLayer} top={76} />
 *              `layers: MapLayer[]` (model.ts), `onToggle(id)`, optional `top` px offset.
 *              Absolutely positioned at the left edge; replaces the old layer panel.
 *
 * SatelliteCompare - a side panel or modal body, opened from a "What each satellite saw" action:
 *                <SatelliteCompare place={place} blocks={answer.blocks} runId={runId} onClose={close} />
 *              `blocks` = `answer.blocks` of a finished run; `runId` enables the plant health /
 *              moisture / heat / water views via /api/layers/{run_id}/{measure}/{scene}.png.
 *              Shows an empty state when `blocks` has no scenes.
 *
 * PassStepper - render inside the chat thread when the user clicks "Step through satellite passes":
 *                const timeline = passTimelineFrom(answer.blocks);
 *                {timeline && <PassStepper timeline={timeline} index={cursor} onChange={setCursor} />}
 *              The parent owns `index` (the shared time cursor) and moves the map in `onChange`.
 */

export { LayerRail } from './LayerRail';
export { SatelliteCompare } from './SatelliteCompare';
export { PassStepper } from './PassStepper';
export { layerLook } from './layerNames';
