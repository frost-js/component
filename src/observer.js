import { findComponentChain, flattenElements, isComponent } from './helpers.js';
import { load, registerLoadedResources } from './loader.js';
import Suspense from './suspense.js';

const mountedComponents = new WeakSet();
const observedNodes = new WeakSet();
const observedShadowRoots = new WeakSet();
const pendingComponents = new WeakSet();
let mutationObserver;
let intersectionObserver;
let currentBaseUrl = null;
let currentExtension = null;
let pendingBootstrapCallback = null;

/**
 * Loads undefined component elements in a node collection when autoload is enabled.
 * @param {NodeList|Node[]} nodes The nodes to scan for components.
 */
const loadComponents = (nodes) => {
    if (!currentBaseUrl || !nodes.length) {
        return;
    }

    load(nodes, { baseUrl: currentBaseUrl, extension: currentExtension });
};

/**
 * Mounts the components represented by a connected node and observes shadow descendants.
 * @param {Element} node The node to mount.
 */
const mountNode = (node) => {
    if (!node.isConnected) {
        return;
    }

    const owners = findComponentChain(node);
    if (owners.length) {
        if (!observedNodes.has(node)) {
            observedNodes.add(node);
            intersectionObserver.observe(node);
        }

        for (const component of owners) {
            if (mountedComponents.has(component)) {
                continue;
            }

            mountedComponents.add(component);
            component.dispatchEvent(new Event('mounted'));
        }
    }

    if (!isComponent(node.localName)) {
        return;
    }

    if (!node.initialized) {
        if (pendingComponents.has(node)) {
            return;
        }

        pendingComponents.add(node);
        node.addEventListener('initialized', () => {
            pendingComponents.delete(node);
            mountNode(node);
        }, { once: true });
        return;
    }

    if (!(node.renderRoot instanceof ShadowRoot)) {
        return;
    }

    const renderRoot = node.renderRoot;

    if (!observedShadowRoots.has(renderRoot)) {
        observedShadowRoots.add(renderRoot);
        mutationObserver.observe(renderRoot, {
            childList: true,
            subtree: true,
        });
    }

    const elements = renderRoot.querySelectorAll('*');

    loadComponents(elements);

    for (const element of elements) {
        mountNode(element);
    }
};

/**
 * Dismounts the components represented by a removed node and its shadow descendants.
 * @param {Element} node The removed node to dismount.
 */
const dismountNode = (node) => {
    if (observedNodes.has(node)) {
        observedNodes.delete(node);
        intersectionObserver.unobserve(node);
    }

    for (const component of findComponentChain(node)) {
        if (component.element.isConnected || !mountedComponents.has(component)) {
            continue;
        }

        mountedComponents.delete(component);
        component.dispatchEvent(new Event('dismounted'));
    }

    if (!isComponent(node.localName) || !(node.renderRoot instanceof ShadowRoot)) {
        return;
    }

    const renderRoot = node.renderRoot;
    const elements = renderRoot.querySelectorAll('*');

    for (const element of elements) {
        dismountNode(element);
    }
};

const bootstrapCallback = () => {
    const elements = document.body.querySelectorAll(':not(script, link[rel="stylesheet"], style)');

    registerLoadedResources();

    if (!intersectionObserver) {
        intersectionObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                for (const component of findComponentChain(entry.target)) {
                    if (entry.isIntersecting === component.visible) {
                        continue;
                    }

                    const event = new Event(entry.isIntersecting ? 'visible' : 'invisible');
                    component.dispatchEvent(event);
                }
            }
        });
    }

    if (!mutationObserver) {
        mutationObserver = new MutationObserver((mutations) => {
            const addedNodes = new Set();
            const removedNodes = new Set();

            for (const mutation of mutations) {
                if (mutation.type !== 'childList') {
                    continue;
                }

                for (const node of flattenElements(mutation.addedNodes)) {
                    addedNodes.add(node);
                }

                for (const node of flattenElements(mutation.removedNodes)) {
                    removedNodes.add(node);
                }
            }

            loadComponents([...addedNodes]);

            for (const node of removedNodes) {
                if (node.isConnected) {
                    continue;
                }

                dismountNode(node);
            }

            for (const node of addedNodes) {
                if (!node.isConnected) {
                    continue;
                }

                mountNode(node);
            }
        });

        for (const element of elements) {
            mountNode(element);
        }

        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    loadComponents(elements);
};

/**
 * Bootstraps DOM observation, built-in components, and optional autoloading.
 * @param {object} [options] The bootstrap options.
 * @param {string|null} [options.baseUrl] The base URL to fetch component templates. Omit to preserve the current setting.
 * @param {string|null} [options.extension] The file extension to append to component URLs. Omit to preserve the current setting.
 */
export function bootstrap(options = {}) {
    if (!customElements.get('x-suspense')) {
        customElements.define('x-suspense', Suspense);
    }

    if (Object.hasOwn(options, 'baseUrl')) {
        currentBaseUrl = options.baseUrl;
    }

    if (Object.hasOwn(options, 'extension')) {
        currentExtension = options.extension;
    }

    if (document.body) {
        if (pendingBootstrapCallback) {
            document.removeEventListener('DOMContentLoaded', pendingBootstrapCallback);
            pendingBootstrapCallback = null;
        }

        bootstrapCallback();
    } else if (!pendingBootstrapCallback) {
        pendingBootstrapCallback = () => {
            pendingBootstrapCallback = null;
            bootstrapCallback();
        };

        document.addEventListener('DOMContentLoaded', pendingBootstrapCallback, { once: true });
    }
}
