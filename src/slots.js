/** @import { default as Component } from './component.js'; */

import { bind } from './bind.js';
import { parseBlocks, processConditionals, processLoops } from './blocks.js';
import { collectEffects, getEffectScope } from './effect-scope.js';

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
    const slotMarkers = [...element.querySelectorAll('slot')]
        .map((slot) => {
            const name = slot.getAttribute('name') || '';

            const start = document.createComment(`slot[${name}]`);
            const end = document.createComment(`/slot[${name}]`);

            const fallback = slot.hasChildNodes() ? createFallback(start, end) : null;
            start.fallback = fallback;

            const assign = (node) => {
                if (!end.parentNode) {
                    return;
                }

                end.before(node);
                fallback?.update();
            };

            const assigned = () => {
                let current = start;
                const nodes = [];
                while (current = current.nextSibling) {
                    if (current.isSameNode(end)) {
                        break;
                    }

                    if (current !== fallback?.end) {
                        nodes.push(current);
                    }
                }

                return nodes;
            };

            slot.parentNode.insertBefore(start, slot);
            while (slot.firstChild) {
                slot.parentNode.insertBefore(slot.firstChild, slot);
            }

            if (fallback) {
                slot.parentNode.insertBefore(fallback.end, slot);
            }

            slot.parentNode.insertBefore(end, slot);
            slot.remove();

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
    const fallbackEnd = document.createComment('/fallback');
    let active = true;
    let dispose;
    let observer;

    const update = () => {
        if (!active) {
            return;
        }

        observer?.disconnect();

        let current = fallbackEnd;
        while ((current = current.nextSibling) && current !== end) {
            if (current.nodeType !== Node.ELEMENT_NODE && current.nodeType !== Node.TEXT_NODE) {
                continue;
            }

            active = false;
            dispose?.();
            while (start.nextSibling !== fallbackEnd) {
                start.nextSibling.remove();
            }

            return;
        }

        // Blocks insert content directly between their assigned comment markers.
        if (end.parentNode) {
            observer ??= new MutationObserver(update);
            observer.observe(end.parentNode, { childList: true });
        }
    };

    const bindFallback = (component) => {
        if (!active || dispose) {
            return;
        }

        // Assignment must stop nested blocks and bindings before removing their nodes.
        const [conditionals, loops] = parseBlocks(start);
        dispose = collectEffects(component, () => {
            getEffectScope(component).cleanups.add(() => observer?.disconnect());
            bind(component, start);
            processConditionals(component, conditionals);
            processLoops(component, loops);
        }, () => active);

        if (!active) {
            dispose();
        }
    };

    return { end: fallbackEnd, bind: bindFallback, update };
};

/**
 * Moves a component's light-DOM children into their matching slot markers.
 * @param {Component} component The component whose children are slotted.
 */
export function processSlots(component) {
    for (const element of [...component.childNodes]) {
        // Block comments carry the same slot name as their content.
        let name = element.slot || '';
        if (element.nodeType === Node.ELEMENT_NODE) {
            name = element.getAttribute('slot') || '';
        }

        const slot = component.getSlot(name);

        if (!slot) {
            continue;
        }

        slot.assign(element);
    };
};
