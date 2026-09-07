import path from 'node:path';
import process from 'node:process';
import { test as base, expect } from '@playwright/test';
import { addCoverageReport } from 'monocart-reporter';

const distPath = path.resolve('dist/frost-component.js');
const collectCoverage = process.env.FROST_COMPONENT_COVERAGE === 'true';

const test = base.extend({
    componentPage: [
        async ({ page }, use, testInfo) => {
            if (collectCoverage) {
                await page.coverage.startJSCoverage({
                    resetOnNavigation: false,
                });
            }

            await page.addScriptTag({ path: distPath });
            await use();

            if (collectCoverage) {
                const coverage = await page.coverage.stopJSCoverage();
                await addCoverageReport(coverage, testInfo);
            }
        },
        { auto: true },
    ],
});

export { expect, test };
