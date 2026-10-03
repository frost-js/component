/** @import { default as Component } from './component.js'; */

/**
 * @typedef {object} ShadowAssets
 * @property {HTMLStyleElement[]} styleBlocks The cached style blocks.
 * @property {HTMLLinkElement[]} stylesheets The cached stylesheet links.
 */

const shadowAssets = new WeakMap();

/**
 * Gets the cached shadow assets for a component class.
 * @param {typeof Component} ComponentClass The component constructor.
 * @returns {ShadowAssets} The cached style blocks and stylesheet links.
 */
export function getShadowAssets(ComponentClass) {
    let assets = shadowAssets.get(ComponentClass);

    if (!assets) {
        assets = { styleBlocks: [], stylesheets: [] };
        shadowAssets.set(ComponentClass, assets);
    }

    return assets;
}

/**
 * Sets the cached shadow assets for a component class.
 * @param {typeof Component} ComponentClass The component constructor.
 * @param {object} [options] The shadow asset options.
 * @param {Iterable<HTMLStyleElement>} [options.styleBlocks=[]] The shadow style blocks.
 * @param {Iterable<HTMLLinkElement>} [options.stylesheets=[]] The shadow stylesheet links.
 */
export function setShadowAssets(ComponentClass, { styleBlocks = [], stylesheets = [] } = {}) {
    shadowAssets.set(ComponentClass, {
        styleBlocks: [...styleBlocks],
        stylesheets: [...stylesheets],
    });
}
