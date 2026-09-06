/** @import { default as Component } from './component.js'; */

const functionCache = new Map();

/**
 * Creates a deterministic 64-bit hash for source text.
 * @param {string} source The source text to hash.
 * @returns {string} The hash encoded in hexadecimal.
 */
function hashSource(source) {
    let hash1 = 0xDEADBEEF;
    let hash2 = 0x41C6CE57;

    for (let i = 0; i < source.length; i++) {
        const char = source.charCodeAt(i);

        hash1 = Math.imul(hash1 ^ char, 2654435761);
        hash2 = Math.imul(hash2 ^ char, 1597334677);
    }

    hash1 = Math.imul(hash1 ^ (hash1 >>> 16), 2246822507) ^
        Math.imul(hash2 ^ (hash2 >>> 13), 3266489909);
    hash2 = Math.imul(hash2 ^ (hash2 >>> 16), 2246822507) ^
        Math.imul(hash1 ^ (hash1 >>> 13), 3266489909);

    return (hash1 >>> 0).toString(16).padStart(8, '0') +
        (hash2 >>> 0).toString(16).padStart(8, '0');
};

/**
 * Creates a dynamically compiled function with a stable virtual source URL.
 * The URL hash is derived from the function parameters and body.
 * Caches up to 1,000 unbound functions, evicting the oldest entry when full.
 * @param {HTMLElement|string} component The component instance or tag name that owns the function.
 * @param {string[]} path The source path segments describing where the function is used.
 * @param {string} body The function body.
 * @param {string[]} [parameters=[]] The function parameter names.
 * @returns {Function} The compiled function.
 */
export function createFunction(component, path, body, parameters = []) {
    const source = JSON.stringify([...parameters, body]);
    const tagName = typeof component === 'string' ?
        component :
        component.localName;
    const sourcePath = [tagName, ...path, `${hashSource(source)}.js`]
        .map(encodeURIComponent)
        .join('/');
    const cached = functionCache.get(sourcePath);

    if (cached?.source === source) {
        return cached.callback;
    }

    const callback = Function.constructor(
        ...parameters,
        `${body}\n//# sourceURL=frost-component://${sourcePath}\n`,
    );

    functionCache.set(sourcePath, { source, callback });

    if (functionCache.size > 1000) {
        const [oldestKey] = functionCache.keys();
        functionCache.delete(oldestKey);
    }

    return callback;
};

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
