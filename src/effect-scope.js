/** @import { default as Component } from './component.js'; */

/**
 * @typedef {object} EffectScope
 * @property {Set<() => void>} cleanups The effect and nested-scope cleanup callbacks.
 * @property {boolean} disposed Whether the scope has been stopped.
 */

const activeScopes = new WeakMap();

/**
 * Gets the active effect scope for a component.
 * @param {Component} component The component that owns the effects.
 * @returns {EffectScope|undefined} The active scope, if any.
 */
export function getEffectScope(component) {
    return activeScopes.get(component);
};

/**
 * Runs a callback with its original effect scope, restoring the previous scope afterward.
 * @param {Component} component The component that owns the effects.
 * @param {EffectScope|undefined} scope The scope to activate.
 * @param {() => void} callback The synchronous callback to execute.
 */
export function runInEffectScope(component, scope, callback) {
    const previous = activeScopes.get(component);
    if (scope) {
        activeScopes.set(component, scope);
    } else {
        activeScopes.delete(component);
    }

    try {
        callback();
    } finally {
        if (previous) {
            activeScopes.set(component, previous);
        } else {
            activeScopes.delete(component);
        }
    }
};

/**
 * Collects effects for a loop row, including nested scopes and effects created by later runs.
 * @param {Component} component The component that owns the bindings.
 * @param {() => void} callback The synchronous binding setup callback.
 * @returns {() => void} Stops and releases the collected effects.
 */
export function collectEffects(component, callback) {
    const parent = activeScopes.get(component);
    const scope = { cleanups: new Set(), disposed: false };
    const dispose = () => {
        if (scope.disposed) {
            return;
        }

        scope.disposed = true;
        for (const cleanup of scope.cleanups) {
            cleanup();
        }

        scope.cleanups.clear();
        parent?.cleanups.delete(dispose);
    };

    parent?.cleanups.add(dispose);

    try {
        runInEffectScope(component, scope, callback);
    } catch (error) {
        dispose();
        throw error;
    }

    return dispose;
};
