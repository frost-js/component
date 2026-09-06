/** @import { default as Component } from './component.js'; */

const functionCache = new Map();

/**
 * Finds child components rendered within an element subtree.
 * @param {Component} component The root component.
 * @param {Element} element The element to scan.
 * @param {Component[]} [components=[]] The accumulator for discovered components.
 * @returns {Component[]} The collected child components.
 */
export function findChildren(component, element, components = []) {
    if (element.component && element.component !== component) {
        components.push(element.component);
    } else if (isComponent(element.tagName)) {
        components.push(element);
    } else if (element.tagName === 'SLOT') {
        const assigned = element.assignedElements({ flatten: true });
        for (const child of assigned) {
            findChildren(component, child, components);
        }
    } else {
        for (const child of element.children) {
            findChildren(component, child, components);
        }
    }

    return components;
};

/**
 * Finds the components represented by a public DOM element.
 * @param {Element} element The public element to inspect.
 * @returns {Component[]} The components represented by the element, from inner to outer.
 */
export function findComponentChain(element) {
    const isShadowHost = isComponent(element.tagName) &&
        element.initialized &&
        element.renderRoot instanceof ShadowRoot;
    let component = isShadowHost ?
        element :
        element.component;

    if (component?.element !== element) {
        return [];
    }

    const owners = [];
    while (component) {
        owners.push(component);
        component = component.component;
    }

    return owners;
};

/**
 * Finds the parent component of a component.
 * @param {Component} component The component to resolve.
 * @returns {Component|null} The parent component, or `null` if none exists.
 */
export function findParent(component) {
    if (component.component) {
        let parentComponent = component.component;
        while (parentComponent.component) {
            parentComponent = parentComponent.component;
        }
        return parentComponent;
    }

    const baseNode = component.initialized ?
        component.element :
        component;

    let parent = baseNode.parentNode;
    while (parent) {
        if (parent.component) {
            return parent.component;
        }

        if (parent.nodeType === Node.DOCUMENT_FRAGMENT_NODE && parent.host) {
            parent = parent.host;
            continue;
        }

        if (parent.nodeType === Node.ELEMENT_NODE && isComponent(parent.tagName)) {
            return parent;
        }

        parent = parent.parentNode;
    }

    return null;
};

/**
 * Determines whether an element is a component.
 * @param {string} tagName The element tag name.
 * @returns {boolean} True when the tag name represents a component.
 */
export function isComponent(tagName) {
    return tagName.toLowerCase().startsWith('x-');
};

/**
 * Flattens a node list into a list of element nodes and their descendants.
 * @param {Iterable<Node>} nodes The nodes to flatten.
 * @returns {Element[]} The flattened element list.
 */
export function flattenElements(nodes) {
    return [...nodes].flatMap((node) => node.nodeType === Node.ELEMENT_NODE ?
        [node, ...node.querySelectorAll('*')] :
        [],
    );
};

/**
 * Finds the object in a prototype chain that owns a property.
 * @param {object|null|undefined} target The object to inspect.
 * @param {string} property The property name to resolve.
 * @param {object} [options] The lookup options.
 * @param {boolean} [options.includeSelf=true] Whether to start on the target itself.
 * @param {object|null} [options.stopAt=Object.prototype] The prototype at which to stop searching.
 * @returns {object|null} The owning object, or `null` if the property was not found before `stopAt`.
 */
export function findPropertyOwner(target, property, { includeSelf = true, stopAt = Object.prototype } = {}) {
    let owner = includeSelf ?
        target :
        Object.getPrototypeOf(target);

    while (owner && owner !== stopAt) {
        if (Object.prototype.hasOwnProperty.call(owner, property)) {
            return owner;
        }

        owner = Object.getPrototypeOf(owner);
    }

    return null;
};

/**
 * Determines whether a value is null or undefined.
 * @param {*} value The value to check.
 * @returns {boolean} True when the value is null or undefined.
 */
export function isEmpty(value) {
    return value === null || value === undefined;
};

/**
 * Determines whether a value is a plain object.
 * @param {*} value The value to check.
 * @returns {boolean} True when the value is a plain object.
 */
export function isPlainObject(value) {
    return value?.constructor === Object;
};

/**
 * Advances a TreeWalker to the next sibling outside the current subtree.
 * @param {TreeWalker} walker The TreeWalker instance to advance.
 * @returns {Node|null} The next node after the subtree, or null if none exists.
 */
export function skipSubtree(walker) {
    if (walker.nextSibling()) {
        return walker.currentNode;
    }

    while (walker.parentNode()) {
        if (walker.nextSibling()) {
            return walker.currentNode;
        }
    }

    return null;
};

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
