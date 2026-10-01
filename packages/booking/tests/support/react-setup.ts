// Testing Library unmounts after each test only when the runner has globals;
// this suite does not, so it says so itself.
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// What jsdom does not implement and the components call, as the suites these
// tests came from stubbed it: scrolling and pointer capture are no-ops.
window.HTMLElement.prototype.scrollIntoView = () => {
  // noop
};
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => {
  // noop
};
window.HTMLElement.prototype.releasePointerCapture = () => {
  // noop
};
