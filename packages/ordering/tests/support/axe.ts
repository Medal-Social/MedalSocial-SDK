import axe from 'axe-core';

/**
 * axe's violations inside `node`. `region` is off: a component under test is
 * not a whole page with landmarks. `color-contrast` is off too: jsdom cannot
 * paint, so it could only ever come back «incomplete» — contrast is the
 * site's theme's to check, in a browser.
 */
export async function axeViolations(node: Element): Promise<axe.Result[]> {
  const result = await axe.run(node, {
    rules: { region: { enabled: false }, 'color-contrast': { enabled: false } },
  });
  return result.violations;
}
