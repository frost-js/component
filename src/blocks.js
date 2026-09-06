/** @import { default as Component } from './component.js'; */

import { bind } from './bind.js';
import { collectEffects } from './effect-scope.js';
import { evaluator } from './evaluator.js';
import { isComponent, skipSubtree } from './helpers.js';
import { setInitialState } from './state.js';

/**
 * @typedef {object} ConditionalCase
 * @property {string} condition The condition expression for the case.
 * @property {Element} element The template element for the case.
 * @property {Comment} start The start marker for the case.
 * @property {Comment} end The end marker for the case.
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
 * @param {Element} element The root element to parse.
 * @param {ConditionalCase[][]} [conditionals=[]] The collected conditional blocks.
 * @param {LoopBlock[]} [loops=[]] The collected loop blocks.
 * @returns {[ConditionalCase[][], LoopBlock[]]} The collected conditionals and loops.
 */
export function parseBlocks(element, conditionals = [], loops = []) {
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_ELEMENT,
        {
            acceptNode(node) {
                if (node.hasAttribute('x:else') || node.hasAttribute('x:else-if')) {
                    return NodeFilter.FILTER_REJECT;
                }

                return (node.hasAttribute('x:if') || node.hasAttribute('x:each')) ?
                    NodeFilter.FILTER_ACCEPT :
                    NodeFilter.FILTER_SKIP;
            },
        },
    );

    const nodes = [];
    let node = walker.nextNode();
    while (node) {
        nodes.push(node);
        node = skipSubtree(walker);
    }

    for (const node of nodes) {
        const hasConditional = node.hasAttribute('x:if');
        const hasLoop = node.hasAttribute('x:each');

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
};

/**
 * Parses a conditional element.
 * @param {Element} element The element to parse.
 * @returns {ConditionalCase[]} The conditional cases for the element.
 */
function parseConditional(element) {
    const condition = element.getAttribute('x:if');
    element.removeAttribute('x:if');

    const start = document.createComment(`if[${condition}]`);
    const end = document.createComment(`/if[${condition}]`);

    element.parentNode.insertBefore(start, element);
    element.parentNode.insertBefore(end, element);

    const cases = [];
    cases.push({ condition, element, start, end });

    let next = element;
    while (next = next.nextElementSibling) {
        if (next.hasAttribute('x:else-if')) {
            const condition = next.getAttribute('x:else-if');
            next.removeAttribute('x:else-if');

            const start = document.createComment(`else-if[${condition}]`);
            const end = document.createComment(`/else-if[${condition}]`);

            next.parentNode.insertBefore(start, next);
            next.parentNode.insertBefore(end, next);

            cases.push({ condition, element: next, start, end });
            continue;
        }

        if (next.hasAttribute('x:else')) {
            next.removeAttribute('x:else');

            const start = document.createComment(`else`);
            const end = document.createComment(`/else`);

            next.parentNode.insertBefore(start, next);
            next.parentNode.insertBefore(end, next);

            cases.push({ condition: '{true}', element: next, start, end });
        }

        break;
    }

    for (const { element } of cases) {
        element.remove();
    }

    return cases;
};

/**
 * Parses a loop element.
 * @param {Element} element The element to parse as a loop block.
 * @returns {LoopBlock} The parsed loop metadata.
 */
function parseLoop(element) {
    if (!isComponent(element.tagName)) {
        throw new Error('Loop elements must be components');
    }

    const iterable = element.getAttribute('x:each') || 'items';
    const identifier = element.getAttribute('x:id') || 'id';
    element.removeAttribute('x:each');
    element.removeAttribute('x:id');

    const start = document.createComment(`each[${iterable}]`);
    const end = document.createComment(`/each[${iterable}]`);

    element.parentNode.insertBefore(start, element);
    element.parentNode.insertBefore(end, element);
    element.remove();

    return { iterable, identifier, element, start, end };
};

/**
 * Processes conditional elements.
 * @param {Component} component The component that owns the conditionals.
 * @param {ConditionalCase[][]} conditionals The conditional cases to evaluate.
 */
export function processConditionals(component, conditionals) {
    for (const cases of conditionals) {
        const conditions = [];
        for (const { condition, element, end } of cases) {
            const data = {
                attached: false,
                callback: evaluator(component, condition, ['conditional']),
                element,
                end,
            };

            conditions.push(data);

            if (isComponent(element.tagName)) {
                element.addEventListener('initialized', () => {
                    data.element = element.element;
                }, { once: true });
            }
        }

        const getActiveCondition = () => conditions.find((condition) => condition.callback());

        component.effect(() => {
            const activeCondition = getActiveCondition();
            for (const condition of conditions) {
                if (condition === activeCondition) {
                    if (!condition.attached) {
                        const [nestedConditionals, nestedLoops] = parseBlocks(condition.element);

                        collectEffects(component, () => {
                            bind(component, condition.element);
                            processConditionals(component, nestedConditionals);
                            processLoops(component, nestedLoops);
                        }, () => condition === getActiveCondition());

                        condition.attached = true;
                    }

                    if (condition.element.nextSibling !== condition.end) {
                        condition.end.parentNode.insertBefore(condition.element, condition.end);
                    }
                } else {
                    condition.element.remove();
                }
            }
        });
    }
};

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

                let loopComponent;
                let dispose;
                if (previousRecords.has(id)) {
                    const previous = previousRecords.get(id);
                    const state = { ...item };

                    loopComponent = previous.component;
                    dispose = previous.dispose;

                    for (const key of previous.stateKeys) {
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
                    loopComponent = element.cloneNode(true);
                    setInitialState(loopComponent, item);

                    const [nestedConditionals, nestedLoops] = parseBlocks(loopComponent);

                    dispose = collectEffects(component, () => {
                        bind(component, loopComponent);
                        processConditionals(component, nestedConditionals);
                        processLoops(component, nestedLoops);
                    });
                }

                const node = loopComponent.initialized ? loopComponent.element : loopComponent;

                if (previousNode.nextSibling !== node) {
                    end.parentNode.insertBefore(node, previousNode.nextSibling);
                }

                previousNode = node;

                loopRecords.set(id, {
                    component: loopComponent,
                    dispose,
                    stateKeys: Object.keys(item),
                });
            }

            for (const [id, { component: loopComponent, dispose }] of previousRecords) {
                if (loopRecords.has(id)) {
                    continue;
                }

                dispose();

                if (loopComponent.initialized) {
                    loopComponent.element.remove();
                } else {
                    loopComponent.remove();
                }
            }
        });
    }
};
