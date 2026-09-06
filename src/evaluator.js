/** @import { default as Component } from './component.js'; */

import { createFunction } from './helpers.js';

/**
 * Builds an evaluator for a binding expression.
 * @param {Component} component The component that owns the expression.
 * @param {string} expression The expression string to evaluate.
 * @param {string[]} [source=['expression']] The virtual source path segments.
 * @param {*} [defaultValue] The fallback value to use when resolving a state path.
 * @returns {() => *} A callback that resolves the current expression value.
 */
export function evaluator(component, expression, source = ['expression'], defaultValue) {
    expression = expression.trim();

    if (!expression) {
        return () => null;
    }

    if (
        (expression.startsWith('{') && expression.endsWith('}')) ||
        (expression.startsWith('({') && expression.endsWith('})'))
    ) {
        expression = expression.slice(1, -1).trim();

        return createFunction(component, source, `return ${expression};`).bind(component);
    }

    return () => component.state(expression, defaultValue).value;
};
