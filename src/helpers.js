/** @import { default as Component } from './component.js'; */

/** The component that owns a rendered DOM element. */
export const componentSymbol = Symbol('component');

/**
 * Reads a DOM prototype property without named-property collisions, or an ordinary property for non-DOM values.
 * @param {*} node The node or ordinary value.
 * @param {string|symbol} property The property to read.
 * @returns {*} The property value.
 */
export const getDOMProperty = (node, property) => {
    const prototype = Object.getPrototypeOf(node);
    return prototype && 'nodeType' in prototype ?
        Reflect.get(prototype, property, node) :
        node[property];
};

/**
 * Calls a DOM method without named-property collisions, preserving the receiver.
 * @param {*} node The node or ordinary value.
 * @param {string|symbol} method The method to call.
 * @param {...*} args The arguments to pass.
 * @returns {*} The method's return value.
 */
export const callDOMMethod = (node, method, ...args) =>
    Reflect.apply(getDOMProperty(node, method), node, args);

/**
 * Determines whether an element is a component.
 * @param {string} tagName The normalized element tag name.
 * @returns {boolean} True when the tag name represents a component.
 */
export function isComponent(tagName) {
    return tagName.startsWith('x-');
};

/**
 * Finds the components represented by a public DOM element.
 * @param {Element} element The public element to inspect.
 * @returns {Component[]} The components represented by the element, from inner to outer.
 */
export function findComponentChain(element) {
    const isShadowHost = isComponent(getDOMProperty(element, 'localName')) &&
        element.initialized &&
        element.renderRoot instanceof ShadowRoot;
    let component = isShadowHost ?
        element :
        element[componentSymbol];

    if (component?.element !== element) {
        return [];
    }

    const owners = [];
    while (component) {
        owners.push(component);
        component = component[componentSymbol];
    }

    return owners;
};

/**
 * Finds the parent component of a component.
 * @param {Component} component The component to resolve.
 * @returns {Component|null} The parent component, or `null` if none exists.
 */
export function findParent(component) {
    if (component[componentSymbol]) {
        let parentComponent = component[componentSymbol];
        while (parentComponent[componentSymbol]) {
            parentComponent = parentComponent[componentSymbol];
        }
        return parentComponent;
    }

    const baseNode = component.initialized ?
        component.element :
        component;

    let parent = getDOMProperty(baseNode, 'parentNode');
    while (parent) {
        if (parent[componentSymbol]) {
            return parent[componentSymbol];
        }

        const nodeType = getDOMProperty(parent, 'nodeType');
        const host = nodeType === Node.DOCUMENT_FRAGMENT_NODE ? getDOMProperty(parent, 'host') : null;
        if (host) {
            parent = host;
            continue;
        }

        if (nodeType === Node.ELEMENT_NODE && isComponent(getDOMProperty(parent, 'localName'))) {
            return parent;
        }

        parent = getDOMProperty(parent, 'parentNode');
    }

    return null;
};

/**
 * Finds child components and the DOM subtrees that can change their membership.
 * @param {Component} component The root component.
 * @param {Element} element The element to scan.
 * @returns {{ children: Component[], targets: Set<Element> }} The child components and observation targets.
 */
export function findChildren(component, element) {
    const children = [];
    const targets = new Set([element]);

    if (component.renderRoot instanceof ShadowRoot) {
        targets.add(component);
    }

    const visit = (element) => {
        if (element[componentSymbol] && element[componentSymbol] !== component) {
            children.push(element[componentSymbol]);
        } else if (isComponent(getDOMProperty(element, 'localName'))) {
            children.push(element);
        } else if (element instanceof HTMLSlotElement) {
            for (const child of callDOMMethod(element, 'assignedElements', { flatten: true })) {
                // Forwarded content can live outside the root and host subtrees.
                targets.add(child);
                visit(child);
            }
        } else {
            for (const child of getDOMProperty(element, 'children')) {
                visit(child);
            }
        }
    };

    visit(element);

    return { children, targets };
};

/**
 * Flattens a node list into a list of element nodes and their descendants.
 * @param {Iterable<Node>} nodes The nodes to flatten.
 * @returns {Element[]} The flattened element list.
 */
export function flattenElements(nodes) {
    return [...nodes].flatMap((node) => getDOMProperty(node, 'nodeType') === Node.ELEMENT_NODE ?
        [node, ...callDOMMethod(node, 'querySelectorAll', '*')] :
        [],
    );
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
 * Waits for pending child components to load or be removed.
 * @param {Component} component The root component.
 * @param {Element} [element=component.rootElement] The element containing the children.
 * @returns {Promise<void>} A promise that resolves when no pending children remain.
 */
export function waitForChildren(component, element = component.rootElement) {
    let pendingChildren = findChildren(component, element).children
        .filter((child) => !child.loaded);

    if (!pendingChildren.length) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const check = () => {
            const { children, targets } = findChildren(component, element);
            pendingChildren = pendingChildren.filter((child) => {
                if (child.loaded) {
                    return false;
                }

                if (children.includes(child)) {
                    return true;
                }

                callDOMMethod(child, 'removeEventListener', 'loaded', check);
                return false;
            });

            for (const child of children) {
                if (!child.loaded && !pendingChildren.includes(child)) {
                    pendingChildren.push(child);
                    callDOMMethod(child, 'addEventListener', 'loaded', check, { once: true });
                }
            }

            observer.disconnect();

            if (pendingChildren.length) {
                for (const target of targets) {
                    observer.observe(target, {
                        childList: true,
                        subtree: true,
                    });
                }

                return;
            }

            callDOMMethod(element, 'removeEventListener', 'slotchange', check);
            resolve();
        };

        const observer = new MutationObserver(check);
        callDOMMethod(element, 'addEventListener', 'slotchange', check);

        for (const child of pendingChildren) {
            callDOMMethod(child, 'addEventListener', 'loaded', check, { once: true });
        }

        check();
    });
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
