/** @import { default as Component } from './component.js'; */

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
    const isShadowHost = isComponent(element.localName) &&
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

        if (parent.nodeType === Node.ELEMENT_NODE && isComponent(parent.localName)) {
            return parent;
        }

        parent = parent.parentNode;
    }

    return null;
};

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
    } else if (isComponent(element.localName)) {
        components.push(element);
    } else if (element instanceof HTMLSlotElement) {
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
    let pendingChildren = findChildren(component, element)
        .filter((child) => !child.loaded);

    if (!pendingChildren.length) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const check = () => {
            const children = findChildren(component, element);
            pendingChildren = pendingChildren.filter((child) => {
                if (child.loaded) {
                    return false;
                }

                if (children.includes(child)) {
                    return true;
                }

                child.removeEventListener('loaded', check);
                return false;
            });

            for (const child of children) {
                if (!child.loaded && !pendingChildren.includes(child)) {
                    pendingChildren.push(child);
                    child.addEventListener('loaded', check, { once: true });
                }
            }

            observer.disconnect();

            if (pendingChildren.length) {
                const targets = new Set([element]);

                if (component.renderRoot instanceof ShadowRoot) {
                    targets.add(component);
                }

                for (const target of targets) {
                    observer.observe(target, {
                        childList: true,
                        subtree: true,
                    });

                    for (const slot of [target, ...target.querySelectorAll('slot')]) {
                        if (!(slot instanceof HTMLSlotElement)) {
                            continue;
                        }

                        for (const assigned of slot.assignedElements({ flatten: true })) {
                            targets.add(assigned);
                        }
                    }
                }

                return;
            }

            element.removeEventListener('slotchange', check);
            resolve();
        };

        const observer = new MutationObserver(check);
        element.addEventListener('slotchange', check);

        for (const child of pendingChildren) {
            child.addEventListener('loaded', check, { once: true });
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
