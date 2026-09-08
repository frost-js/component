import { bindTemplate } from './bind.js';
import Component from './component.js';
import { callDOMMethod, getDOMProperty, waitForChildren } from './helpers.js';

/**
 * Provides fallback content while child components load.
 */
export default class Suspense extends Component {
    /**
     * Gets the component template.
     * @returns {string} The component template markup.
     */
    static get template() {
        return `
            <div>
                <div x:key="fallback">
                    <slot name="fallback"></slot>
                </div>
                <div x:key="content" style="display: none;">
                    <slot></slot>
                </div>
            </div>
        `;
    }

    /**
     * Swaps fallback content for the assigned content once child components finish loading.
     */
    initialize() {
        super.initialize();

        const disposals = [...callDOMMethod(this.fallback, 'querySelectorAll', 'template')]
            .map((template) => bindTemplate(this, template));

        waitForChildren(this, this.content).then(() => {
            for (const dispose of disposals) {
                dispose();
            }

            const parent = getDOMProperty(this.rootElement, 'parentNode');
            if (!parent) {
                return;
            }

            const nodes = this.getSlot().assigned();
            for (const node of nodes) {
                callDOMMethod(parent, 'insertBefore', node, this.rootElement);
            }

            callDOMMethod(this.rootElement, 'remove');
        });
    }
}
