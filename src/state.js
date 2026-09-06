/** @import { default as Component } from './component.js'; */

import { createFunction } from './evaluator.js';
import { isPlainObject } from './helpers.js';

const initialStates = new WeakMap();

/**
 * Adds initial state values for a component before it has initialized.
 * @param {Element} component The component element.
 * @param {object} values The state values to apply.
 */
export function setInitialState(component, values) {
    const state = initialStates.get(component) || {};

    Object.assign(state, values);
    initialStates.set(component, state);
};

/**
 * Consumes initial state values waiting for a component.
 * @param {Element} component The component element.
 * @returns {object|undefined} The pending state values, if any.
 */
function consumeInitialState(component) {
    const state = initialStates.get(component);

    initialStates.delete(component);
    return state;
};

/**
 * Parses component state from non-framework attributes and removes them from the host.
 * @param {Component} component The component to populate with state.
 */
export function parseState(component) {
    for (const attr of [...component.attributes]) {
        if (attr.name === 'slot' || attr.name.startsWith('x:')) {
            continue;
        }

        let value;
        try {
            value = createFunction(
                component,
                ['state', attr.name],
                `return ${attr.value};`,
            ).call(component);
        } catch {
            value = attr.value;
        }

        if (attr.name === 'state' && isPlainObject(value)) {
            component.state.set(value);
        } else {
            component.state[attr.name] = value;
        }

        component.removeAttribute(attr.name);
    }

    const initialState = consumeInitialState(component);
    if (initialState) {
        component.state.set(initialState);
    }
};
