import { callDOMMethod } from './helpers.js';

/**
 * Collects elements keyed by `x:key`.
 * @param {Element} element The element to scan for keys.
 * @returns {Map<string, Element>} The key-to-element map.
 * @throws {Error} When duplicate keys are found.
 */
export function parseElements(element) {
    const elements = [...callDOMMethod(element, 'querySelectorAll', '[x\\:key]')];

    if (callDOMMethod(element, 'matches', '[x\\:key]')) {
        elements.unshift(element);
    }

    const result = new Map();

    for (const element of elements) {
        const key = callDOMMethod(element, 'getAttribute', 'x:key');
        callDOMMethod(element, 'removeAttribute', 'x:key');

        if (!key) {
            continue;
        }

        if (result.has(key)) {
            throw new Error(`Duplicate key element "${key}"`);
        }

        result.set(key, element);
    }

    return result;
};
