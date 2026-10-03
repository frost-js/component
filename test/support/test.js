import path from 'node:path';
import process from 'node:process';
import { test as base, expect } from '@playwright/test';
import { addCoverageReport } from 'monocart-reporter';

const distPath = path.resolve('dist/frost-component.js');
const collectCoverage = process.env.FROST_COMPONENT_COVERAGE === 'true';

const test = base.extend({
    expectedBrowserErrors: [[], { option: true }],
    componentPage: [
        async ({ page, expectedBrowserErrors }, use, testInfo) => {
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));

            if (collectCoverage) {
                await page.coverage.startJSCoverage({
                    resetOnNavigation: false,
                });
            }

            await page.addScriptTag({ path: distPath });
            await page.evaluate(() => {
                if (!window.Component) {
                    throw new Error('Failed to load Frost Component on the test page.');
                }
            });

            await use();

            if (collectCoverage) {
                const coverage = await page.coverage.stopJSCoverage();
                await addCoverageReport(coverage, testInfo);
            }

            expect(errors, 'Uncaught browser errors').toEqual(expectedBrowserErrors);
        },
        { auto: true },
    ],
});

export { expect, test };
