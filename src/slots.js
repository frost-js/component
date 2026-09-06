/** @import { default as Component } from './component.js'; */

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

            let hasAssigned = false;
            const assign = (node) => {
                if (!end.parentNode) {
                    return;
                }

                if (!hasAssigned) {
                    while (start.nextSibling !== end) {
                        start.nextSibling.remove();
                    }
                    hasAssigned = true;
                }

                end.before(node);
            };

            const assigned = () => {
                let current = start;
                const nodes = [];
                while (current = current.nextSibling) {
                    if (current.isSameNode(end)) {
                        break;
                    }

                    nodes.push(current);
                }

                return nodes;
            };

            slot.parentNode.insertBefore(start, slot);
            while (slot.firstChild) {
                slot.parentNode.insertBefore(slot.firstChild, slot);
            }
            slot.parentNode.insertBefore(end, slot);
            slot.remove();

            return [name, { start, end, assign, assigned }];
        });

    return Object.fromEntries(slotMarkers);
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
