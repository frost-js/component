/** @import { default as Component } from './component.js'; */

import { bind } from './bind.js';
import DOMRegion from './dom-region.js';
import EffectScope from './effect-scope.js';
import { evaluator } from './evaluator.js';
import { callDOMMethod, getDOMProperty, isComponent, skipSubtree } from './helpers.js';
import { setInitialState } from './state.js';

/**
 * @typedef {object} ConditionalCase
 * @property {string} condition The condition expression for the case.
 * @property {Element} element The template element for the case.
 * @property {DOMRegion} region The case's DOM boundaries and retained content.
 */

/**
 * @typedef {object} LoopBlock
 * @property {string} iterable The expression that resolves to the loop items.
 * @property {string} identifier The property name used as the item key.
 * @property {Element} element The component template cloned for each item.
 * @property {Comment} start The start marker for the loop block.
 * @property {Comment} end The end marker for the loop block.
 */

/**
 * Parses top-level conditional and loop blocks from an element subtree.
 * @param {Element|DocumentFragment|Comment} element The root element, template content, or fallback start marker to parse.
 * @param {ConditionalCase[][]} [conditionals=[]] The collected conditional blocks.
 * @param {LoopBlock[]} [loops=[]] The collected loop blocks.
 * @returns {[ConditionalCase[][], LoopBlock[]]} The collected conditionals and loops.
 */
export function parseBlocks(element, conditionals = [], loops = []) {
    const end = getDOMProperty(element, 'nodeType') === Node.COMMENT_NODE ? element.fallback.end : null;
    const walker = callDOMMethod(document, 'createTreeWalker',
        end ? getDOMProperty(element, 'parentNode') : element,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT,
        {
            acceptNode(node) {
                if (getDOMProperty(node, 'nodeType') === Node.COMMENT_NODE) {
                    return node === end || node.fallback ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }

                if (callDOMMethod(node, 'hasAttribute', 'x:else') || callDOMMethod(node, 'hasAttribute', 'x:else-if')) {
                    return NodeFilter.FILTER_REJECT;
                }

                return (callDOMMethod(node, 'hasAttribute', 'x:if') || callDOMMethod(node, 'hasAttribute', 'x:each')) ?
                    NodeFilter.FILTER_ACCEPT :
                    NodeFilter.FILTER_SKIP;
            },
        },
    );

    const nodes = [];
    walker.currentNode = element;
    let node = walker.nextNode();
    while (node && node !== end) {
        if (getDOMProperty(node, 'nodeType') === Node.COMMENT_NODE) {
            walker.currentNode = node.fallback.end;
            node = walker.nextNode();
        } else {
            nodes.push(node);
            node = skipSubtree(walker);
        }
    }

    for (const node of nodes) {
        const hasConditional = callDOMMethod(node, 'hasAttribute', 'x:if');
        const hasLoop = callDOMMethod(node, 'hasAttribute', 'x:each');

        if (hasConditional && hasLoop) {
            throw new Error('Conditional elements cannot be looped');
        }

        if (hasConditional) {
            conditionals.push(parseConditional(node));
        } else if (hasLoop) {
            loops.push(parseLoop(node));
        }
    }

    return [conditionals, loops];
}

/**
 * Parses a conditional element.
 * @param {Element} element The element to parse.
 * @returns {ConditionalCase[]} The conditional cases for the element.
 */
function parseConditional(element) {
    const condition = callDOMMethod(element, 'getAttribute', 'x:if');
    callDOMMethod(element, 'removeAttribute', 'x:if');

    const start = callDOMMethod(document, 'createComment', `if[${condition}]`);
    const end = callDOMMethod(document, 'createComment', `/if[${condition}]`);

    callDOMMethod(element, 'before', start);
    callDOMMethod(element, 'after', end);

    const cases = [];
    cases.push({ condition, element, start, end });

    let next = element;
    while (next = getDOMProperty(next, 'nextElementSibling')) {
        if (callDOMMethod(next, 'hasAttribute', 'x:else-if')) {
            const condition = callDOMMethod(next, 'getAttribute', 'x:else-if');
            callDOMMethod(next, 'removeAttribute', 'x:else-if');

            const start = callDOMMethod(document, 'createComment', `else-if[${condition}]`);
            const end = callDOMMethod(document, 'createComment', `/else-if[${condition}]`);

            callDOMMethod(next, 'before', start);
            callDOMMethod(next, 'after', end);

            cases.push({ condition, element: next, start, end });
            continue;
        }

        if (callDOMMethod(next, 'hasAttribute', 'x:else')) {
            callDOMMethod(next, 'removeAttribute', 'x:else');

            const start = callDOMMethod(document, 'createComment', `else`);
            const end = callDOMMethod(document, 'createComment', `/else`);

            callDOMMethod(next, 'before', start);
            callDOMMethod(next, 'after', end);

            cases.push({ condition: '{true}', element: next, start, end });
        }

        break;
    }

    return cases.map(({ condition, element, start, end }) => {
        start.slot = callDOMMethod(element, 'getAttribute', 'slot') || '';
        end.slot = start.slot;

        const region = new DOMRegion(start, end);
        region.hide();

        return { condition, element, region };
    });
}

/**
 * Parses a loop element.
 * @param {Element} element The element to parse as a loop block.
 * @returns {LoopBlock} The parsed loop metadata.
 */
function parseLoop(element) {
    if (!isComponent(getDOMProperty(element, 'localName'))) {
        throw new Error('Loop elements must be components');
    }

    const iterable = callDOMMethod(element, 'getAttribute', 'x:each') || 'items';
    const identifier = callDOMMethod(element, 'getAttribute', 'x:id') || 'id';
    callDOMMethod(element, 'removeAttribute', 'x:each');
    callDOMMethod(element, 'removeAttribute', 'x:id');

    const start = callDOMMethod(document, 'createComment', `each[${iterable}]`);
    const end = callDOMMethod(document, 'createComment', `/each[${iterable}]`);
    start.slot = callDOMMethod(element, 'getAttribute', 'slot') || '';
    end.slot = start.slot;

    const parent = getDOMProperty(element, 'parentNode');
    callDOMMethod(parent, 'insertBefore', start, element);
    callDOMMethod(parent, 'insertBefore', end, element);
    callDOMMethod(element, 'remove');

    return { iterable, identifier, element, start, end };
}

/**
 * Processes conditional elements.
 * @param {Component} component The component that owns the conditionals.
 * @param {ConditionalCase[][]} conditionals The conditional cases to evaluate.
 */
export function processConditionals(component, conditionals) {
    for (const cases of conditionals) {
        const conditions = [];
        for (const { condition, element, region } of cases) {
            conditions.push({
                attached: false,
                callback: evaluator(component, condition, ['conditional']),
                element,
                region,
            });
        }

        const getActiveCondition = () => conditions.find((condition) => condition.callback());

        component.effect(() => {
            const activeCondition = getActiveCondition();
            for (const condition of conditions) {
                if (condition === activeCondition) {
                    if (!condition.attached) {
                        const [nestedConditionals, nestedLoops] = parseBlocks(condition.element);

                        EffectScope.collect(component, () => {
                            bind(component, condition.element);
                            processConditionals(component, nestedConditionals);
                            processLoops(component, nestedLoops);
                        }, () => condition === getActiveCondition());

                        condition.attached = true;
                    }

                    condition.region.show();
                } else {
                    condition.region.hide();
                }
            }
        });
    }
}

/**
 * Processes loop elements.
 * @param {Component} component The component that owns the loops.
 * @param {LoopBlock[]} loops The loop descriptors to render.
 */
export function processLoops(component, loops) {
    for (const { iterable, identifier, element, start, end } of loops) {
        let loopRecords = new Map();
        const callback = evaluator(component, iterable, ['loop'], []);

        component.effect(() => {
            const items = callback();

            if (!Array.isArray(items)) {
                throw new Error(`Iterable "${iterable}" must be an array`);
            }

            const previousRecords = loopRecords;

            loopRecords = new Map();
            let previousNode = start;

            for (const item of items) {
                if (!(identifier in item)) {
                    throw new Error(`Item in "${iterable}" must have a "${identifier}" property`);
                }

                const id = item[identifier];

                if (loopRecords.has(id)) {
                    throw new Error(`Duplicate identifier "${id}" in "${iterable}"`);
                }

                let record = previousRecords.get(id);
                if (record) {
                    const loopComponent = record.component;
                    const state = { ...item };

                    for (const key of record.stateKeys) {
                        if (!Object.hasOwn(item, key)) {
                            state[key] = undefined;
                        }
                    }

                    if (loopComponent.initialized) {
                        loopComponent.state.set(state);
                    } else {
                        setInitialState(loopComponent, state);
                    }
                } else {
                    const loopComponent = callDOMMethod(element, 'cloneNode', true);
                    setInitialState(loopComponent, item);

                    const [nestedConditionals, nestedLoops] = parseBlocks(loopComponent);

                    const dispose = EffectScope.collect(component, () => {
                        bind(component, loopComponent);
                        processConditionals(component, nestedConditionals);
                        processLoops(component, nestedLoops);
                    });

                    // Keep row boundaries when a component replaces or unwraps its root.
                    const region = new DOMRegion(callDOMMethod(document, 'createComment', 'item'), callDOMMethod(document, 'createComment', '/item'));
                    region.start.slot = start.slot;
                    region.end.slot = end.slot;

                    const fragment = callDOMMethod(document, 'createDocumentFragment');
                    callDOMMethod(fragment, 'append', region.start, loopComponent, region.end);

                    record = { component: loopComponent, dispose, region };
                }

                record.region.moveBefore(getDOMProperty(previousNode, 'nextSibling'));
                previousNode = record.region.end;

                record.stateKeys = Object.keys(item);
                loopRecords.set(id, record);
            }

            for (const [id, record] of previousRecords) {
                if (loopRecords.has(id)) {
                    continue;
                }

                record.dispose();
                record.region.remove();
            }
        });
    }
}
