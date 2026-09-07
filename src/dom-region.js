/**
 * Keeps a group of DOM nodes between stable comment markers.
 */
export default class DOMRegion {
    #fragment;

    /**
     * Creates a region without moving its content.
     * @param {Comment} start The start marker.
     * @param {Comment} end The end marker.
     */
    constructor(start, end) {
        this.start = start;
        this.end = end;
    }

    /**
     * Detaches the content while leaving the markers in place.
     */
    hide() {
        this.#fragment ??= document.createDocumentFragment();
        while (this.start.nextSibling !== this.end) {
            this.#fragment.appendChild(this.start.nextSibling);
        }
    }

    /**
     * Moves the whole region, including its markers, before a sibling.
     * @param {Node} node The node to insert before.
     */
    moveBefore(node) {
        if (node === this.start || this.end.nextSibling === node) {
            return;
        }

        node.before(this.#getRange().extractContents());
    }

    /**
     * Removes the whole region, including its markers.
     */
    remove() {
        this.#getRange().deleteContents();
    }

    /**
     * Restores hidden content without moving content that is already shown.
     */
    show() {
        if (this.#fragment?.hasChildNodes()) {
            this.end.before(this.#fragment);
        }
    }

    /**
     * Gets a range covering the current content and both markers.
     * @returns {Range} The region's current DOM range.
     */
    #getRange() {
        const range = document.createRange();
        range.setStartBefore(this.start);
        range.setEndAfter(this.end);
        return range;
    }
}
