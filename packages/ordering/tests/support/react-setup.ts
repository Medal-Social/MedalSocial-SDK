// Testing Library unmounts after each test only when the runner has globals;
// this suite does not, so it says so itself.
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
