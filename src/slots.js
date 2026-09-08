/** @import { default as Component } from './component.js'; */

import { useState } from '@fr0st/state';
import { bind } from './bind.js';
import { parseBlocks, processConditionals, processLoops } from './blocks.js';
import DOMRegion from './dom-region.js';
import EffectScope from './effect-scope.js';
import { callDOMMethod, getDOMProperty } from './helpers.js';

/**
 * @typedef {object} SlotDefinition
 * @property {Comment} start The start marker for the slot.
 * @property {Comment} end The end marker for the slot.
 * @property {(node: Node) => void} assign Assigns a node to the slot.
 * @property {() => Node[]} assigned Gets the nodes assigned to the slot.
 */

/**
 * Replaces descendant `<slot>` elements with comment markers.
 * @param {Element} element The element to scan for slots.
 * @returns {Record<string, SlotDefinition>} The slot map keyed by slot name.
 */
export function parseSlots(element) {
    const slotMarkers = [...callDOMMethod(element, 'querySelectorAll', 'slot')]
        .map((slot) => {
            const name = callDOMMethod(slot, 'getAttribute', 'name') || '';

            const start = callDOMMethod(document, 'createComment', `slot[${name}]`);
            const end = callDOMMethod(document, 'createComment', `/slot[${name}]`);

            const fallback = callDOMMethod(slot, 'hasChildNodes') ? createFallback(start, end) : null;
            start.fallback = fallback;

            const assign = (node) => {
                if (!getDOMProperty(end, 'parentNode')) {
                    return;
                }

                callDOMMethod(end, 'before', node);
                fallback?.update();
            };

            const assigned = () => {
                let current = start;
                const nodes = [];
                while (current = getDOMProperty(current, 'nextSibling')) {
                    if (callDOMMethod(current, 'isSameNode', end)) {
                        break;
                    }

                    if (current !== fallback?.end) {
                        nodes.push(current);
                    }
                }

                return nodes;
            };

            const parent = getDOMProperty(slot, 'parentNode');
            callDOMMethod(parent, 'insertBefore', start, slot);
            let child;
            while (child = getDOMProperty(slot, 'firstChild')) {
                callDOMMethod(parent, 'insertBefore', child, slot);
            }

            if (fallback) {
                callDOMMethod(parent, 'insertBefore', fallback.end, slot);
            }

            callDOMMethod(parent, 'insertBefore', end, slot);
            callDOMMethod(slot, 'remove');

            return [name, { start, end, assign, assigned }];
        });

    return Object.fromEntries(slotMarkers);
};

/**
 * Creates a fallback boundary with its own bindings and assignment watcher.
 * @param {Comment} start The slot's start marker.
 * @param {Comment} end The slot's end marker.
 * @returns {object} The fallback boundary and its binding and update callbacks.
 */
function createFallback(start, end) {
    const fallbackEnd = callDOMMethod(document, 'createComment', '/fallback');
    const region = new DOMRegion(start, fallbackEnd);
    const active = useState(true);
    let initialized = false;
    let observer;

    const hasContent = () => {
        let current = fallbackEnd;
        while ((current = getDOMProperty(current, 'nextSibling')) && current !== end) {
            const nodeType = getDOMProperty(current, 'nodeType');
            if (nodeType === Node.ELEMENT_NODE || nodeType === Node.TEXT_NODE) {
                return true;
            }
        }

        return false;
    };

    const update = () => {
        observer?.disconnect();

        const show = !hasContent();

        // Retain the DOM and pause its bindings while assigned content is present.
        active(show);
        if (show) {
            region.show();
        } else {
            region.hide();
        }

        // Blocks insert content directly between their assigned comment markers.
        const parent = getDOMProperty(end, 'parentNode');
        if (parent) {
            observer ??= new MutationObserver(update);
            observer.observe(parent, { childList: true });
        }
    };

    const bindFallback = (component) => {
        if (initialized) {
            return;
        }

        initialized = true;
        EffectScope.get(component).addCleanup(() => observer?.disconnect());
        let bound = false;

        component.effect(() => {
            if (bound || !active() || hasContent()) {
                return;
            }

            // A fallback hidden by initial content binds only when first shown.
            const [conditionals, loops] = parseBlocks(start);

            // Bindings may run before the assignment observer updates active.
            EffectScope.collect(component, () => {
                bind(component, start);
                processConditionals(component, conditionals);
                processLoops(component, loops);
            }, () => active() && !hasContent());
            bound = true;
        });
    };

    return { end: fallbackEnd, bind: bindFallback, update };
};

/**
 * Moves a component's light-DOM children into their matching slot markers.
 * @param {Component} component The component whose children are slotted.
 */
export function processSlots(component) {
    for (const element of [...getDOMProperty(component, 'childNodes')]) {
        // Block comments carry the same slot name as their content.
        const name = getDOMProperty(element, 'nodeType') === Node.ELEMENT_NODE ?
            callDOMMethod(element, 'getAttribute', 'slot') || '' :
            element.slot || '';

        const slot = component.getSlot(name);

        if (!slot) {
            continue;
        }

        slot.assign(element);
    };
};
