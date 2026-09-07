/** @import { default as Component } from './component.js'; */

/**
 * Owns the execution context and cleanup callbacks for a group of bindings.
 */
export default class EffectScope {
    static #activeScopes = new WeakMap();

    #cleanups = new Set();
    #component;
    #disposed = false;
    #isActive;

    /**
     * Collects effects for a block, including nested scopes and effects created by later runs.
     * @param {Component} component The component that owns the bindings.
     * @param {() => void} callback The synchronous binding setup callback.
     * @param {() => boolean} [isActive] The reactive condition that enables the block's effects.
     * @returns {() => void} Stops and releases the collected effects.
     */
    static collect(component, callback, isActive) {
        const parent = this.get(component);
        const scope = new this(component, () => parent.isActive() && (!isActive || isActive()));
        const dispose = parent.addCleanup(() => scope.dispose());

        try {
            scope.run(callback);
        } catch (error) {
            dispose();
            throw error;
        }

        return dispose;
    }

    /**
     * Gets the active effect scope, creating a default scope for the component if needed.
     * @param {Component} component The component that owns the effects.
     * @returns {EffectScope} The current scope for the component.
     */
    static get(component) {
        let scope = this.#activeScopes.get(component);
        if (!scope) {
            scope = new this(component);
            this.#activeScopes.set(component, scope);
        }

        return scope;
    }

    /**
     * Creates an effect scope.
     * @param {Component} component The component that owns the bindings.
     * @param {() => boolean} [isActive] Whether the scope's bindings should run.
     */
    constructor(component, isActive) {
        this.#component = component;
        this.#isActive = isActive;
    }

    /**
     * Registers cleanup, running it immediately if the scope is already disposed.
     * @param {() => void} cleanup The cleanup callback.
     * @returns {() => void} Runs and unregisters the cleanup once.
     */
    addCleanup(cleanup) {
        const dispose = () => {
            if (this.#cleanups.delete(dispose)) {
                cleanup();
            }
        };

        this.#cleanups.add(dispose);
        if (this.#disposed) {
            dispose();
        }

        return dispose;
    }

    /**
     * Stops the scope and releases its registered bindings and nested scopes.
     */
    dispose() {
        if (this.#disposed) {
            return;
        }

        this.#disposed = true;
        for (const cleanup of this.#cleanups) {
            cleanup();
        }
    }

    /**
     * Checks whether the scope and its enclosing branch conditions match.
     * @returns {boolean} Whether the scope's bindings should run.
     */
    isActive() {
        return !this.#isActive || this.#isActive();
    }

    /**
     * Runs a callback in this scope, restoring the previous scope afterward.
     * @param {() => void} callback The synchronous callback to execute.
     */
    run(callback) {
        if (this.#disposed) {
            return;
        }

        const previous = this.constructor.get(this.#component);
        this.constructor.#activeScopes.set(this.#component, this);

        try {
            callback();
        } finally {
            this.constructor.#activeScopes.set(this.#component, previous);
        }
    }
}
