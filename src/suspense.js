import { bindTemplate } from './bind.js';
import Component from './component.js';
import { waitForChildren } from './helpers.js';

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

        const disposals = [...this.fallback.querySelectorAll('template')]
            .map((template) => bindTemplate(this, template));

        waitForChildren(this, this.content).then(() => {
            for (const dispose of disposals) {
                dispose();
            }

            if (!this.rootElement.parentNode) {
                return;
            }

            const nodes = this.getSlot().assigned();
            for (const node of nodes) {
                this.rootElement.parentNode.insertBefore(node, this.rootElement);
            }

            this.rootElement.remove();
        });
    }
}
