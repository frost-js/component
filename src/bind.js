/** @import { default as Component } from './component.js'; */

import { parseBlocks, processConditionals, processLoops } from './blocks.js';
import EffectScope from './effect-scope.js';
import { createFunction, evaluator } from './evaluator.js';
import { callDOMMethod, componentSymbol, findPropertyOwner, getDOMProperty, isComponent, isEmpty, isPlainObject, skipSubtree } from './helpers.js';
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

/** Events dispatched on the component instance rather than its rendered element. */
const componentEvents = new Set([
    'connected',
    'dismounted',
    'elementchange',
    'initialized',
    'invisible',
    'loaded',
    'mounted',
    'visible',
]);

/** @type {WeakSet<Text>} */
const boundTextNodes = new WeakSet();

/** @type {WeakMap<HTMLTemplateElement, { component: Component, scope: EffectScope }>} */
const templateBindings = new WeakMap();

/**
 * Binds an element subtree to a component.
 * @param {Component} component The component that owns bindings.
 * @param {Element|DocumentFragment|Comment} element The root element, template content, or fallback start marker to bind.
 */
export function bind(component, element) {
    if (element[componentSymbol] && element[componentSymbol] !== component) {
        return;
    }

    const end = getDOMProperty(element, 'nodeType') === Node.COMMENT_NODE ? element.fallback.end : null;
    const walker = callDOMMethod(document, 'createTreeWalker',
        end ? getDOMProperty(element, 'parentNode') : element,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT,
    );

    const bindElement = (node) => {
        for (const attribute of [...getDOMProperty(node, 'attributes')]) {
            const name = getDOMProperty(attribute, 'name');
            const value = getDOMProperty(attribute, 'value');

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

    walker.currentNode = element;
    let node = end ? walker.nextNode() : element;
    while (node && node !== end) {
        if (getDOMProperty(node, 'nodeType') === Node.ELEMENT_NODE) {
            if (node[componentSymbol] && node[componentSymbol] !== component) {
                // Skip subtrees owned by other components.
                node = skipSubtree(walker);
                continue;
            }

            bindElement(node);

            // Inert template content must keep its declaring scope when rendered later.
            if (node instanceof HTMLTemplateElement && !templateBindings.has(node)) {
                templateBindings.set(node, { component, scope: EffectScope.get(component) });
            }
        } else if (getDOMProperty(node, 'nodeType') === Node.TEXT_NODE) {
            bindText(component, node);
        } else if (node.fallback) {
            node.fallback.bind(component);
            walker.currentNode = node.fallback.end;
        }

        node = walker.nextNode();
    }
}

/**
 * Renders a template using the component and effect scope that declared it.
 * @param {Component} component The component to use when the template has no binding owner.
 * @param {HTMLTemplateElement} template The template to render.
 * @returns {() => void} Stops the rendered template's bindings.
 */
export function bindTemplate(component, template) {
    const binding = templateBindings.get(template) || { component, scope: EffectScope.get(component) };
    const fragment = callDOMMethod(getDOMProperty(template, 'content'), 'cloneNode', true);
    let dispose = () => { };

    binding.scope.run(() => {
        const [conditionals, loops] = parseBlocks(fragment);

        dispose = EffectScope.collect(binding.component, () => {
            bind(binding.component, fragment);
            processConditionals(binding.component, conditionals);
            processLoops(binding.component, loops);
        });
    });

    callDOMMethod(template, 'replaceWith', fragment);
    return dispose;
}

/**
 * Binds a dynamic attribute to a component.
 * @param {Component} component The component that owns the binding.
 * @param {Element} element The target element.
 * @param {string} name The bound attribute name (including the ":" prefix).
 * @param {string} value The attribute expression string.
 */
function bindAttribute(component, element, name, value) {
    callDOMMethod(element, 'removeAttribute', name);

    if (!value) {
        return;
    }

    const attribute = name.slice(1);
    const callback = evaluator(component, value, ['attribute', attribute]);

    if (isComponent(getDOMProperty(element, 'localName'))) {
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
                const classList = getDOMProperty(element, 'classList');

                if (previous) {
                    classList.remove(...previous);
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
                        .filter(([_, value]) => Boolean(value))
                        .map(([key, _]) => key);
                }

                const classes = values.flatMap((value) => `${value}`.trim().split(/\s+/).filter(Boolean));

                classList.add(...classes);
                previous = classes.length ? classes : null;
            });
            break;
        case 'style':
            component.effect(() => {
                const result = callback();
                const style = getDOMProperty(element, 'style');

                if (previous?.type === 'string') {
                    style.cssText = '';
                } else if (previous?.type === 'object') {
                    for (const key of previous.keys) {
                        if (key.startsWith('--') || key.includes('-')) {
                            style.removeProperty(key);
                        } else {
                            style[key] = '';
                        }
                    }
                }

                if (isEmpty(result)) {
                    previous = null;
                } else if (isPlainObject(result)) {
                    for (const [key, value] of Object.entries(result)) {
                        if (!isEmpty(value)) {
                            if (key.startsWith('--') || key.includes('-')) {
                                style.setProperty(key, value);
                            } else {
                                style[key] = value;
                            }
                        }
                    }

                    previous = {
                        keys: Object.keys(result),
                        type: 'object',
                    };
                } else {
                    style.cssText = result;
                    previous = { type: 'string' };
                }
            });
            break;
        default:
            component.effect(() => {
                const result = callback();

                if (typeof result === 'boolean' && booleanAttributes.has(attribute)) {
                    callDOMMethod(element, 'toggleAttribute', attribute, result);
                } else if (isEmpty(result)) {
                    callDOMMethod(element, 'removeAttribute', attribute);
                } else {
                    callDOMMethod(element, 'setAttribute', attribute, result);
                }
            });
            break;
    }
}

/**
 * Binds an event handler to a component.
 * @param {Component} component The component that owns the handler.
 * @param {Element} element The target element.
 * @param {string} name The event attribute name (including the "@" prefix).
 * @param {string} value The handler attribute value.
 */
function bindEvent(component, element, name, value) {
    callDOMMethod(element, 'removeAttribute', name);

    const params = name.slice(1).split('.');
    const eventName = params.shift();
    const handlerValue = value?.trim();

    let callback;
    if (!handlerValue) {
        callback = () => { };
    } else if (
        handlerValue in component &&
        typeof component[handlerValue] === 'function' &&
        findPropertyOwner(component, handlerValue, {
            stopAt: HTMLElement.prototype,
        })
    ) {
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

    const followElement = isComponent(getDOMProperty(element, 'localName')) && !componentEvents.has(eventName);
    let target = followElement && element.initialized ? element.element : element;
    const update = ({ detail }) => {
        callDOMMethod(target, 'removeEventListener', eventName, handler, options);
        target = detail.element;

        if (!once || !ran) {
            callDOMMethod(target, 'addEventListener', eventName, handler, options);
        }
    };

    callDOMMethod(target, 'addEventListener', eventName, handler, options);

    if (followElement) {
        callDOMMethod(element, 'addEventListener', 'elementchange', update);
    }

    EffectScope.get(component).addCleanup(() => {
        callDOMMethod(target, 'removeEventListener', eventName, handler, options);
        callDOMMethod(element, 'removeEventListener', 'elementchange', update);
    });
}

/**
 * Binds an input element to component state.
 * @param {Component} component The component that owns the state.
 * @param {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement} element The input element.
 * @param {string} name The binding attribute name (including the "x:bind" prefix).
 * @param {string} value The state key to bind.
 */
function bindInput(component, element, name, value) {
    callDOMMethod(element, 'removeAttribute', name);

    if (!value) {
        return;
    }

    let update;

    if (callDOMMethod(element, 'matches', 'input[type="checkbox"]')) {
        component.state(value, false);

        update = () => {
            if (Array.isArray(component.state[value])) {
                element.checked = component.state[value].includes(getDOMProperty(element, 'value'));
            } else {
                element.checked = Boolean(component.state[value]);
            }
        };

        callDOMMethod(element, 'addEventListener', 'change', () => {
            const checked = getDOMProperty(element, 'checked');
            if (Array.isArray(component.state[value])) {
                const inputValue = getDOMProperty(element, 'value');
                if (checked) {
                    if (!component.state[value].includes(inputValue)) {
                        component.state[value] = [...component.state[value], inputValue];
                    }
                } else {
                    // eslint-disable-next-line eqeqeq -- DOM input values are strings and may represent numeric state.
                    component.state[value] = [...component.state[value].filter((value) => value != inputValue)];
                }
            } else {
                component.state[value] = checked;
            }
        });
    } else if (callDOMMethod(element, 'matches', 'input[type="radio"]')) {
        update = () => {
            // eslint-disable-next-line eqeqeq -- DOM input values are strings and may represent numeric state.
            element.checked = component.state[value] == getDOMProperty(element, 'value');
        };

        callDOMMethod(element, 'addEventListener', 'change', () => {
            const inputValue = getDOMProperty(element, 'value');
            if (getDOMProperty(element, 'checked')) {
                component.state[value] = inputValue;
            // eslint-disable-next-line eqeqeq -- DOM input values are strings and may represent numeric state.
            } else if (component.state[value] == inputValue) {
                component.state[value] = undefined;
            }
        });
    } else if (callDOMMethod(element, 'matches', 'input, select, textarea')) {
        const multiple = callDOMMethod(element, 'matches', 'select[multiple]');

        if (multiple) {
            component.state(value, []);
        }

        update = multiple ?
            () => {
                const values = component.state[value];
                for (const option of getDOMProperty(element, 'options')) {
                    option.selected = Array.isArray(values) && values.includes(getDOMProperty(option, 'value'));
                }
            } :
            () => {
                element.value = isEmpty(component.state[value]) ?
                    '' :
                    component.state[value];
            };

        const change = multiple ?
            () => {
                component.state[value] = [...getDOMProperty(element, 'selectedOptions')].map((option) => getDOMProperty(option, 'value'));
            } :
            () => {
                component.state[value] = getDOMProperty(element, 'value');
            };

        callDOMMethod(element, 'addEventListener', 'change', change);

        if (!multiple) {
            callDOMMethod(element, 'addEventListener', 'input', change);
        }
    }

    if (!update) {
        return;
    }

    component.effect(update);

    if (callDOMMethod(element, 'matches', 'input[type="checkbox"], input[type="radio"], select')) {
        // DOM value and option changes also affect the current selection.
        const select = getDOMProperty(element, 'localName') === 'select';
        const observer = new MutationObserver(update);
        observer.observe(element, {
            attributeFilter: ['value'],
            characterData: select,
            childList: select,
            subtree: select,
        });
        EffectScope.get(component).addCleanup(() => observer.disconnect());
    }
}

/**
 * Binds a component expression to a DOM property.
 * @param {Component} component The component that owns the binding.
 * @param {Element} element The target element.
 * @param {string} name The bound property name (including the "." prefix).
 * @param {string} value The property expression string.
 */
function bindProperty(component, element, name, value) {
    callDOMMethod(element, 'removeAttribute', name);

    if (!value) {
        return;
    }

    const property = name.slice(1)
        .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const tagName = getDOMProperty(element, 'localName');

    const setup = () => {
        const owner = findPropertyOwner(element, property, { includeSelf: false });
        const customOwner = findPropertyOwner(
            customElements.get(tagName)?.prototype,
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

    if (tagName.includes('-') && !callDOMMethod(element, 'matches', ':defined')) {
        const scope = EffectScope.get(component);
        customElements.whenDefined(tagName).then(() => scope.run(() => {
            customElements.upgrade(element);
            if (callDOMMethod(element, 'matches', ':defined')) {
                setup();
            }
        }));
        return;
    }

    setup();
}

/**
 * Binds a text node to component expressions.
 * @param {Component} component The component that owns the bindings.
 * @param {Text} node The text node to bind.
 */
function bindText(component, node) {
    if (boundTextNodes.has(node)) {
        return;
    }

    const raw = getDOMProperty(node, 'textContent');
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
}
