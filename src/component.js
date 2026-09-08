/** @import { SlotDefinition } from './slots.js'; */

import { StateStore, useEffect } from '@fr0st/state';
import { bind } from './bind.js';
import { parseBlocks, processConditionals, processLoops } from './blocks.js';
import EffectScope from './effect-scope.js';
import { parseElements } from './element.js';
import { callDOMMethod, componentSymbol, findChildren, findParent, getDOMProperty, isComponent, waitForChildren } from './helpers.js';
import { getShadowAssets } from './shadow-assets.js';
import { parseSlots, processSlots } from './slots.js';
import { parseState } from './state.js';

/**
 * Base custom element class for Frost components.
 */
export default class Component extends HTMLElement {
    /** @type {'open'|'closed'|null} */
    static shadowMode = null;

    #connected = false;
    #effects = new Set();
    #element = this;
    #initialized = false;
    #loaded = false;
    #loadedGates = new Set();
    #mounted = false;
    #pendingEffects = new Set();
    #rootElement;
    #shadowRoot;
    #slots;
    #state = new StateStore();
    #visible = false;

    /**
     * Gets the symbol linking a rendered element to its owning component.
     * @returns {symbol} The component ownership key.
     */
    static get componentSymbol() {
        return componentSymbol;
    }

    /**
     * Gets the template.
     * @returns {string} The component template markup.
     */
    static get template() {
        return '<div><slot></slot></div>';
    }

    /**
     * Creates a new component instance.
     * @throws {Error} When a slot has conditional or loop directives.
     */
    constructor() {
        super();

        const tagName = getDOMProperty(this, 'localName');
        if (!isComponent(tagName)) {
            throw new Error('Components must begin with "x-"');
        }

        this.#shadowRoot = this.constructor.shadowMode ?
            callDOMMethod(this, 'attachShadow', {
                mode: this.constructor.shadowMode,
            }) :
            null;

        this.#rootElement = this.render();

        if (callDOMMethod(this.#rootElement, 'querySelector', 'slot:is([x\\:if], [x\\:else-if], [x\\:else], [x\\:each])')) {
            throw new Error('Slot elements cannot have conditional or loop directives');
        }

        this.#rootElement[componentSymbol] = this;
        callDOMMethod(this.#rootElement, 'setAttribute', 'x:component', tagName);

        for (const [key, element] of parseElements(this.#rootElement)) {
            if (key in this) {
                throw new Error(`Component property "${key}" already exists`);
            }

            this[key] = element;
        }

        this.#slots = this.#shadowRoot ? {} : parseSlots(this.#rootElement);

        if (this.#shadowRoot) {
            const fragment = callDOMMethod(document, 'createDocumentFragment');
            const { styleBlocks, stylesheets } = getShadowAssets(this.constructor);

            for (const stylesheet of stylesheets) {
                if (!callDOMMethod(stylesheet, 'getAttribute', 'href')?.trim()) {
                    continue;
                }

                callDOMMethod(fragment, 'appendChild', callDOMMethod(stylesheet, 'cloneNode', true));
            }

            for (const styleBlock of styleBlocks) {
                callDOMMethod(fragment, 'appendChild', callDOMMethod(styleBlock, 'cloneNode', true));
            }

            callDOMMethod(this.#shadowRoot, 'appendChild', fragment);
        }
    }

    /**
     * Gets the child components.
     * @returns {Component[]} The child components rendered within this component.
     */
    get childComponents() {
        return findChildren(this, this.#rootElement).children;
    }

    /**
     * Determines whether the component has entered its connection lifecycle.
     * @returns {boolean} True when the component has connected.
     */
    get connected() {
        return this.#connected;
    }

    /**
     * Gets the component's current public DOM element.
     * @returns {Element} The host until replacement, or permanently in shadow mode.
     */
    get element() {
        return this.#element;
    }

    /**
     * Determines whether the component is initialized.
     * @returns {boolean} True when the component is initialized.
     */
    get initialized() {
        return this.#initialized;
    }

    /**
     * Determines whether the component has fully loaded.
     * @returns {boolean} True when the component has fully loaded.
     */
    get loaded() {
        return this.#loaded;
    }

    /**
     * Determines whether the component is mounted.
     * @returns {boolean} True when the component is mounted.
     */
    get mounted() {
        return this.#mounted;
    }

    /**
     * Gets the parent component.
     * @returns {Component|null} The parent component, or `null` if none exists.
     */
    get parentComponent() {
        return findParent(this);
    }

    /**
     * Gets the node that contains the rendered output.
     * @returns {ShadowRoot|Element} The shadow root in shadow mode, otherwise the root element.
     */
    get renderRoot() {
        return this.#shadowRoot || this.#rootElement;
    }

    /**
     * Gets the rendered root element.
     * @returns {Element} The rendered root element.
     */
    get rootElement() {
        return this.#rootElement;
    }

    /**
     * Gets the state store.
     * @returns {StateStore} The component state store.
     */
    get state() {
        return this.#state;
    }

    /**
     * Determines whether the component is visible.
     * @returns {boolean} True when the component is visible.
     */
    get visible() {
        return this.#visible;
    }

    /**
     * Handles the custom element connection lifecycle.
     */
    connectedCallback() {
        if (this.#initialized && !this.#shadowRoot) {
            throw new Error('A component cannot be reattached after it has been initialized');
        }

        if (this.#initialized) {
            this.onConnected();
            return;
        }

        const parentComponent = this.parentComponent;

        // don't initialize slot components until they have been assigned
        if (parentComponent && callDOMMethod(parentComponent, 'contains', this) && parentComponent.renderRoot === parentComponent.rootElement) {
            callDOMMethod(parentComponent, 'addEventListener', 'initialized', () => {
                if (this.#connected || !callDOMMethod(parentComponent, 'contains', this)) {
                    return;
                }

                this.connectedCallback();
            }, { once: true });
            return;
        }

        setTimeout(() => {
            if (this.#connected || !getDOMProperty(this, 'isConnected') || !getDOMProperty(this, 'parentNode')) {
                return;
            }

            this.#connected = true;
            this.onConnected();

            const event = new Event('connected');
            callDOMMethod(this, 'dispatchEvent', event);

            const parentComponent = this.parentComponent;

            const initializedPromise = parentComponent && !parentComponent.initialized ?
                new Promise((resolve) => {
                    callDOMMethod(parentComponent, 'addEventListener', 'initialized', resolve, { once: true });
                }) :
                Promise.resolve();

            initializedPromise.then(() => this.#initializeComponent());
        }, 0);
    }

    /**
     * Registers a promise to defer the loaded event.
     * @param {Promise<*>} promise The promise to await before marking the component as loaded.
     * @throws {Error} When called after the component has loaded.
     */
    deferLoad(promise) {
        if (this.loaded) {
            throw new Error('Loading cannot be deferred after the component has loaded');
        }

        const guarded = promise.catch(() => { });

        this.#loadedGates.add(guarded);

        guarded.finally(() => {
            this.#loadedGates.delete(guarded);
        });
    }

    /**
     * Dispatches a bubbling composed custom event from the component's public DOM node.
     * @param {string} name The custom event name.
     * @param {*} [detail={}] The event detail payload.
     */
    dispatch(name, detail = {}) {
        const event = new CustomEvent(name, {
            detail,
            bubbles: true,
            composed: true,
        });

        callDOMMethod(this.element, 'dispatchEvent', event);
    }

    /**
     * Registers an effect callback.
     * @param {() => void} callback The effect callback to register.
     * @param {object} [options] The effect options.
     * @param {boolean} [options.waitForVisible=true] Whether to defer effects until the component is visible.
     * @returns {() => void} Stops the effect and releases its active and deferred registrations.
     */
    effect(callback, { waitForVisible = true } = {}) {
        const ref = {};
        const scope = EffectScope.get(this);
        const effect = useEffect(() => scope.run(() => {
            if (!this.#mounted || (waitForVisible && !this.#visible)) {
                this.#pendingEffects.add(ref);
                return;
            }

            if (!scope.isActive()) {
                return;
            }

            callback();
        }), { weak: true });

        ref.effect = effect;

        this.#effects.add(effect);

        return scope.addCleanup(() => {
            effect.stop();
            this.#effects.delete(effect);
            this.#pendingEffects.delete(ref);
        });
    }

    /**
     * Gets a slot definition.
     * @param {string} [name=''] The slot name.
     * @returns {SlotDefinition | undefined} The slot definition, or `undefined` if the slot is missing.
     */
    getSlot(name = '') {
        return Object.hasOwn(this.#slots, name) ? this.#slots[name] : undefined;
    }

    /**
     * Lifecycle hook that runs after state parsing and DOM placement, before bindings and blocks are activated.
     */
    initialize() {

    }

    /**
     * Lifecycle hook that runs when the component actually connects.
     * Runs on the initial connection and on later shadow-mode reconnections.
     */
    onConnected() {

    }

    /**
     * Executes a callback when the component has fully loaded.
     * @param {() => void} callback The callback to execute.
     */
    ready(callback) {
        if (this.loaded) {
            callback();
        } else {
            callDOMMethod(this, 'addEventListener', 'loaded', callback, { once: true });
        }
    }

    /**
     * Renders the component element.
     * @returns {Element} The rendered root element.
     * @throws {Error} When the template does not render exactly one supported root element.
     */
    render() {
        const fragment = callDOMMethod(document, 'createRange')
            .createContextualFragment(this.constructor.template);

        if (this.constructor.shadowMode) {
            const { styleBlocks, stylesheets } = getShadowAssets(this.constructor);

            for (const node of [...getDOMProperty(fragment, 'children')]) {
                if (callDOMMethod(node, 'matches', 'style')) {
                    if (!styleBlocks.some((block) => callDOMMethod(block, 'isEqualNode', node))) {
                        styleBlocks.push(node);
                    }

                    callDOMMethod(node, 'remove');
                } else if (callDOMMethod(node, 'matches', 'link[rel="stylesheet"]')) {
                    if (!stylesheets.some((sheet) => callDOMMethod(sheet, 'isEqualNode', node))) {
                        stylesheets.push(node);
                    }

                    callDOMMethod(node, 'remove');
                }
            }
        }

        if (getDOMProperty(fragment, 'childElementCount') !== 1) {
            throw new Error('Components must only render a single element');
        }

        const element = getDOMProperty(fragment, 'firstElementChild');
        if (callDOMMethod(element, 'matches', 'slot')) {
            throw new Error('Components cannot render a root slot element');
        }

        if (callDOMMethod(element, 'matches', 'x-suspense')) {
            throw new Error('Components cannot render a root x-suspense element');
        }

        return element;
    }

    /**
     * Runs and clears effects deferred while the component was dismounted or invisible.
     */
    #flushPendingEffects() {
        for (const { effect } of this.#pendingEffects) {
            effect.sync();
        }

        this.#pendingEffects.clear();
    }

    /**
     * Initializes the component's DOM, bindings, and lifecycle after its parent is ready.
     */
    #initializeComponent() {
        if (!getDOMProperty(this, 'isConnected') || !getDOMProperty(this, 'parentNode')) {
            this.#connected = false;
            return;
        }

        callDOMMethod(this, 'addEventListener', 'mounted', () => {
            this.#mounted = true;
            this.#visible = true;
            this.#flushPendingEffects();
        });

        callDOMMethod(this, 'addEventListener', 'dismounted', () => {
            this.#mounted = false;
        });

        callDOMMethod(this, 'addEventListener', 'visible', () => {
            this.#visible = true;
            this.#flushPendingEffects();
        });

        callDOMMethod(this, 'addEventListener', 'invisible', () => {
            this.#visible = false;
        });

        // Discard replaced slot fallbacks before parsing their blocks.
        if (!this.#shadowRoot) {
            processSlots(this);
        }

        // extract outer conditionals/loops
        const [conditionals, loops] = parseBlocks(this.#rootElement);

        parseState(this);

        if (this.#shadowRoot) {
            callDOMMethod(this.#shadowRoot, 'appendChild', this.#rootElement);
        } else {
            const slot = callDOMMethod(this, 'getAttribute', 'slot');
            if (slot !== null) {
                callDOMMethod(this.#rootElement, 'setAttribute', 'slot', slot);
            }

            // replace element
            callDOMMethod(getDOMProperty(this, 'parentNode'), 'insertBefore', this.#rootElement, this);
            callDOMMethod(this, 'remove');
            this.#setElement(this.#rootElement);
        }

        this.#initialized = true;

        // mark component as mounted/visible, so effects will run the first time
        this.#mounted = true;
        this.#visible = true;

        this.initialize();

        bind(this, this.#rootElement);
        processConditionals(this, conditionals);
        processLoops(this, loops);

        const event = new Event('initialized');
        callDOMMethod(this, 'dispatchEvent', event);

        this.#waitForLoad().then(() => {
            this.#loaded = true;

            const event = new Event('loaded');
            callDOMMethod(this, 'dispatchEvent', event);
        });
    }

    /**
     * Updates the public element and notifies owners and bindings after replacement.
     * @param {Element} element The new public DOM element.
     */
    #setElement(element) {
        if (element === this.#element) {
            return;
        }

        const previous = this.#element;
        this.#element = element;

        // Shadow owners keep their host even when their template root changes.
        const owner = this[componentSymbol];
        if (owner && !owner.#shadowRoot) {
            owner.#setElement(element);
        }

        callDOMMethod(this, 'dispatchEvent', new CustomEvent('elementchange', {
            detail: { element, previous },
        }));
    }

    /**
     * Waits for child components and deferred loading promises, including any added while waiting.
     * @returns {Promise<void>} A promise that resolves when children and loading gates have settled.
     */
    async #waitForLoad() {
        do {
            await waitForChildren(this);
            await Promise.allSettled([...this.#loadedGates]);
        } while (this.#loadedGates.size || this.childComponents.some((child) => !child.loaded));
    }
}
