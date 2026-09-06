/** @import { default as Component } from './component.js'; */

import { evaluator } from './evaluator.js';
import { createFunction, findPropertyOwner, isComponent, isEmpty, isPlainObject, skipSubtree } from './helpers.js';
import { setInitialState } from './state.js';

/**
 * Boolean attributes defined by the HTML standard.
 * @type {Set<string>}
 */
const booleanAttributes = new Set([
    'allowfullscreen',
    'alpha',
    'async',
    'autofocus',
    'autoplay',
    'checked',
    'controls',
    'default',
    'defer',
    'disabled',
    'formnovalidate',
    'headingreset',
    'inert',
    'ismap',
    'itemscope',
    'loop',
    'multiple',
    'muted',
    'nomodule',
    'novalidate',
    'open',
    'playsinline',
    'readonly',
    'required',
    'reversed',
    'selected',
    'shadowrootclonable',
    'shadowrootcustomelementregistry',
    'shadowrootdelegatesfocus',
    'shadowrootserializable',
]);

/** @type {WeakSet<Text>} */
const boundTextNodes = new WeakSet();

/**
 * Binds an element subtree to a component.
 * @param {Component} component The component that owns bindings.
 * @param {Element} element The element subtree to bind.
 */
export function bind(component, element) {
    if (element.component && element.component !== component) {
        return;
    }

    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    );

    const bindElement = (node) => {
        for (const { name, value } of [...node.attributes]) {
            if (name.startsWith('.')) {
                bindProperty(component, node, name, value);
            } else if (name.startsWith(':')) {
                bindAttribute(component, node, name, value);
            } else if (name.startsWith('@')) {
                bindEvent(component, node, name, value);
            } if (name.startsWith('x:bind')) {
                bindInput(component, node, name, value);
            }
        }
    };

    let node = walker.currentNode;
    while (node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.component && node.component !== component) {
                // Skip subtrees owned by other components.
                node = skipSubtree(walker);
                continue;
            }

            bindElement(node);
        } else if (node.nodeType === Node.TEXT_NODE) {
            bindText(component, node);
        }

        node = walker.nextNode();
    }
};

/**
 * Binds a dynamic attribute to a component.
 * @param {Component} component The component that owns the binding.
 * @param {Element} element The target element.
 * @param {string} name The bound attribute name (including the ":" prefix).
 * @param {string} value The attribute expression string.
 */
function bindAttribute(component, element, name, value) {
    element.removeAttribute(name);

    if (!value) {
        return;
    }

    const attribute = name.slice(1);
    const callback = evaluator(component, value, ['attribute', attribute]);

    if (isComponent(element.tagName)) {
        component.effect(() => {
            const result = callback();

            if (element.initialized) {
                if (attribute === 'state' && isPlainObject(result)) {
                    element.state.set(result);
                } else {
                    element.state[attribute] = result;
                }
            } else if (attribute === 'state' && isPlainObject(result)) {
                setInitialState(element, result);
            } else {
                setInitialState(element, { [attribute]: result });
            }
        });
        return;
    }

    let previous;
    switch (attribute) {
        case 'class':
            component.effect(() => {
                const result = callback();

                if (previous) {
                    element.classList.remove(...previous);
                }

                if (isEmpty(result)) {
                    previous = null;
                    return;
                }

                let values = [result];
                if (Array.isArray(result)) {
                    values = result;
                } else if (isPlainObject(result)) {
                    values = Object.entries(result)
                        .filter(([_, value]) => !!value)
                        .map(([key, _]) => key);
                }

                const classes = values.flatMap((value) => `${value}`.trim().split(/\s+/).filter(Boolean));

                element.classList.add(...classes);
                previous = classes.length ? classes : null;
            });
            break;
        case 'style':
            component.effect(() => {
                const result = callback();

                if (previous?.type === 'string') {
                    element.style.cssText = '';
                } else if (previous?.type === 'object') {
                    for (const key of previous.keys) {
                        if (key.startsWith('--') || key.includes('-')) {
                            element.style.removeProperty(key);
                        } else {
                            element.style[key] = '';
                        }
                    }
                }

                if (isEmpty(result)) {
                    previous = null;
                } else if (isPlainObject(result)) {
                    for (const [key, value] of Object.entries(result)) {
                        if (!isEmpty(value)) {
                            if (key.startsWith('--') || key.includes('-')) {
                                element.style.setProperty(key, value);
                            } else {
                                element.style[key] = value;
                            }
                        }
                    }

                    previous = {
                        keys: Object.keys(result),
                        type: 'object',
                    };
                } else {
                    element.style.cssText = result;
                    previous = { type: 'string' };
                }
            });
            break;
        default:
            component.effect(() => {
                const result = callback();

                if (typeof result === 'boolean' && booleanAttributes.has(attribute)) {
                    element.toggleAttribute(attribute, result);
                } else if (isEmpty(result)) {
                    element.removeAttribute(attribute);
                } else {
                    element.setAttribute(attribute, result);
                }
            });
            break;
    }
};

/**
 * Binds an event handler to a component.
 * @param {Component} component The component that owns the handler.
 * @param {Element} element The target element.
 * @param {string} name The event attribute name (including the "@" prefix).
 * @param {string} value The handler attribute value.
 */
function bindEvent(component, element, name, value) {
    element.removeAttribute(name);

    const params = name.slice(1).split('.');
    const eventName = params.shift();
    const handlerValue = value?.trim();

    let callback;
    if (!handlerValue) {
        callback = () => { };
    } else if (handlerValue in component && typeof component[handlerValue] === 'function' && findPropertyOwner(component, handlerValue, {
        stopAt: HTMLElement.prototype,
    })) {
        callback = component[handlerValue].bind(component);
    } else if (handlerValue.startsWith('{') && handlerValue.endsWith('}')) {
        callback = createFunction(
            component,
            ['event', eventName],
            handlerValue.slice(1, -1),
            ['event'],
        ).bind(component);
    } else {
        const factory = createFunction(
            component,
            ['event', eventName],
            `"use strict"; return (${handlerValue})`,
        );

        try {
            const result = factory.call(component);

            if (typeof result !== 'function') {
                throw new Error();
            }

            callback = result.bind(component);
        } catch {
            throw new Error(
                `Event handler "${handlerValue}" must be a component method, function expression, or braced statement body`,
            );
        }
    }

    const once = params.includes('once');

    let ran = false;
    const handler = (event) => {
        ran = true;

        if (params.includes('self') && event.target !== event.currentTarget) {
            return;
        }

        if (params.includes('prevent')) {
            event.preventDefault();
        }

        if (params.includes('stop')) {
            event.stopPropagation();
        }

        callback(event);
    };

    const options = {
        once,
        capture: params.includes('capture'),
        passive: params.includes('passive'),
    };

    element.addEventListener(eventName, handler, options);

    if (isComponent(element.tagName) && !element.initialized) {
        element.addEventListener('initialized', () => {
            if (once && ran) {
                return;
            }

            const target = element.element;
            if (target !== element) {
                element.removeEventListener(eventName, handler, options);
                target.addEventListener(eventName, handler, options);
            }
        }, { once: true });
    }
};

/**
 * Binds an input element to component state.
 * @param {Component} component The component that owns the state.
 * @param {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement} element The input element.
 * @param {string} name The binding attribute name (including the "x:bind" prefix).
 * @param {string} value The state key to bind.
 */
function bindInput(component, element, name, value) {
    element.removeAttribute(name);

    if (!value) {
        return;
    }

    if (element.matches('select[multiple]')) {
        component.state(value, []);

        component.effect(() => {
            const values = component.state[value];
            for (const option of element.options) {
                option.selected = Array.isArray(values) && values.includes(option.value);
            }
        });

        element.addEventListener('change', () => {
            component.state[value] = [...element.selectedOptions].map((option) => option.value);
        });
    } else if (element.matches('input[type="checkbox"]')) {
        component.state(value, false);

        component.effect(() => {
            if (Array.isArray(component.state[value])) {
                element.checked = component.state[value].includes(element.value);
            } else {
                element.checked = !!component.state[value];
            }
        });

        element.addEventListener('change', () => {
            if (Array.isArray(component.state[value])) {
                if (element.checked) {
                    if (!component.state[value].includes(element.value)) {
                        component.state[value] = [...component.state[value], element.value];
                    }
                } else {
                    component.state[value] = [...component.state[value].filter((value) => value != element.value)];
                }
            } else {
                component.state[value] = element.checked;
            }
        });
    } else if (element.matches('input[type="radio"]')) {
        component.effect(() => {
            element.checked = component.state[value] == element.value;
        });

        element.addEventListener('change', () => {
            if (element.checked) {
                component.state[value] = element.value;
            } else if (component.state[value] == element.value) {
                component.state[value] = undefined;
            }
        });
    } else if (element.matches('input, select, textarea')) {
        component.effect(() => {
            if (isEmpty(component.state[value])) {
                element.value = '';
            } else {
                element.value = component.state[value];
            }
        });

        element.addEventListener('change', () => {
            component.state[value] = element.value;
        });

        element.addEventListener('input', () => {
            component.state[value] = element.value;
        });
    }
};

/**
 * Binds a component expression to a DOM property.
 * @param {Component} component The component that owns the binding.
 * @param {Element} element The target element.
 * @param {string} name The bound property name (including the "." prefix).
 * @param {string} value The property expression string.
 */
function bindProperty(component, element, name, value) {
    element.removeAttribute(name);

    if (!value) {
        return;
    }

    const property = name.slice(1)
        .replace(/-([a-z])/g, (_, char) => char.toUpperCase());

    const owner = findPropertyOwner(element, property, { includeSelf: false });
    const customOwner = findPropertyOwner(
        customElements.get(element.localName)?.prototype,
        property,
        { stopAt: HTMLElement.prototype },
    );

    if (owner && !customOwner) {
        throw new Error(`Property binding ".${property}" only supports custom properties`);
    }

    const callback = evaluator(component, value, ['property', property]);

    component.effect(() => {
        element[property] = callback();
    });
};

/**
 * Binds a text node to component expressions.
 * @param {Component} component The component that owns the bindings.
 * @param {Text} node The text node to bind.
 */
function bindText(component, node) {
    if (boundTextNodes.has(node)) {
        return;
    }

    const raw = node.textContent;
    if (!raw || !raw.includes('{')) {
        return;
    }

    const parts = [];
    let index = 0;

    while (index < raw.length) {
        const start = raw.indexOf('{', index);

        if (start === -1) {
            parts.push(raw.slice(index));
            break;
        }

        if (start > index) {
            parts.push(raw.slice(index, start));
        }

        const exprStart = start + 1;
        const isExpression = raw.slice(exprStart).trimStart().startsWith('{');

        let callback;
        let syntaxError;
        let stringChar = null;
        let escaped = false;
        let braceDepth = 0;
        let end = null;

        for (let i = exprStart; i < raw.length; i++) {
            const char = raw[i];

            if (stringChar) {
                if (escaped) {
                    escaped = false;
                } else if (char === '\\') {
                    escaped = true;
                } else if (char === stringChar) {
                    stringChar = null;
                }

                continue;
            }

            if (char === '"' || char === '\'' || char === '`') {
                stringChar = char;
                continue;
            }

            if (char === '{') {
                braceDepth++;
                continue;
            }

            if (char === '}' && braceDepth > 0) {
                braceDepth--;
                continue;
            }

            if (char === '}' && braceDepth === 0) {
                end = i;
                break;
            }
        }

        if (isExpression) {
            const compileExpression = (position) => {
                const inner = raw.slice(exprStart, position).trim();
                if (!inner.endsWith('}')) {
                    return null;
                }

                const expression = inner.slice(1, -1);
                try {
                    return evaluator(component, expression.trim() ? `{(${expression})}` : '{}', ['text']);
                } catch (error) {
                    if (!(error instanceof SyntaxError)) {
                        throw error;
                    }

                    syntaxError = error;
                    return null;
                }
            };

            if (end !== null) {
                callback = compileExpression(end);
            }

            // Retry boundaries only when the fast scan cannot parse the expression.
            // Compilation checks JavaScript syntax without executing the expression.
            for (let i = exprStart; !callback && i < raw.length; i++) {
                if (raw[i] !== '}' || i === end) {
                    continue;
                }

                callback = compileExpression(i);
                if (callback) {
                    end = i;
                }
            }
        }

        if (end === null) {
            parts.push(raw.slice(start));
            break;
        }

        if (!callback && syntaxError) {
            throw syntaxError;
        }

        const inner = raw.slice(exprStart, end).trim();

        if (inner) {
            parts.push(callback ?? evaluator(component, inner, ['text']));
        }

        index = end + 1;
    }

    if (parts.every((part) => typeof part === 'string')) {
        return;
    }

    // Prevent children from interpreting slotted binding output as expressions.
    boundTextNodes.add(node);

    component.effect(() => {
        node.textContent = parts
            .map((part) => typeof part === 'string' ? part : part())
            .join('');
    });
};
