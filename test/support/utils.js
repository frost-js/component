/** @import { JSHandle, Page } from '@playwright/test'; */
/** @import Component from '../../src/component.js'; */

/**
 * Serves component templates and returns 404 for unknown component names.
 * @param {Page} page The Playwright page.
 * @param {Record<string, string>} templates The templates keyed by component tag name.
 * @returns {Promise<void>} A promise that resolves once the route is registered.
 */
export async function mockComponents(page, templates) {
    await page.route('**/components/*', (route) => {
        const tagName = new URL(route.request().url()).pathname.split('/').at(-1);
        if (!Object.hasOwn(templates, tagName)) {
            return route.fulfill({ status: 404 });
        }

        return route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: templates[tagName],
        });
    });
}

/**
 * Defines a component class in a browser page.
 * @param {Page} page The Playwright page.
 * @param {string} tagName The component tag name.
 * @param {string} className The component class name.
 * @param {string} template The component template markup.
 * @returns {Promise<void>} A promise that resolves once the component is defined.
 */
export async function defineComponent(page, tagName, className, template) {
    await page.addScriptTag({
        content: `
            class ${className} extends window.Component {
                static get template() {
                    return ${JSON.stringify(template)};
                }
            }
            window.${className} = ${className};
            customElements.define('${tagName}', ${className});
        `,
    });
}

/**
 * Attaches a method to a component class in a browser page.
 * @param {Page} page The Playwright page.
 * @param {string} className The component class name.
 * @param {string} methodName The method name.
 * @param {Function} fn The method implementation.
 * @returns {Promise<void>} A promise that resolves once the method is attached.
 */
export async function attachMethod(page, className, methodName, fn) {
    const source = fn.toString();
    await page.evaluate(({ className, methodName, source }) => {
        const targetClass = window[className];
        if (!targetClass) {
            throw new Error(`Class not found: ${className}`);
        }
        const method = new Function(`return (${source});`)();
        targetClass.prototype[methodName] = method;
    }, { className, methodName, source });
}

/**
 * Mounts component markup and retains the original instance before root replacement.
 * @param {Page} page The Playwright page.
 * @param {string} markup The markup containing a single component host.
 * @returns {Promise<JSHandle<Component>>} A handle to the component instance.
 */
export async function mountComponent(page, markup) {
    return await page.evaluateHandle((markup) => {
        const template = document.createElement('template');
        template.innerHTML = markup;
        const component = template.content.firstElementChild;
        document.body.append(template.content);
        return component;
    }, markup);
}

/**
 * Waits for a component to finish loading.
 * @param {Page} page The Playwright page.
 * @param {JSHandle<Component>} component The retained component instance.
 * @returns {Promise<void>} A promise that resolves when the component is loaded.
 */
export async function waitForComponent(page, component) {
    await page.waitForFunction((component) => component.loaded === true, component);
}

/**
 * Updates state on a component in a browser page.
 * @param {Page} page The Playwright page.
 * @param {JSHandle<Component>} component The retained component instance.
 * @param {Record<string, *>} newState The state values to apply.
 * @returns {Promise<void>} A promise that resolves once the state is updated.
 */
export async function updateState(page, component, newState) {
    await page.waitForFunction((component) => component.initialized === true, component);

    await component.evaluate((component, newState) => {
        for (const [key, value] of Object.entries(newState)) {
            component.state[key] = value;
        }
    }, newState);
}

/**
 * Waits for queued browser tasks to complete.
 * @param {Page} page The Playwright page.
 * @returns {Promise<void>} A promise that resolves after queued tasks run.
 */
export async function flushTasks(page) {
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
}
