import '@testing-library/jest-dom/extend-expect';

const { webcrypto } = require('crypto');
const { TextDecoder, TextEncoder } = require('util');

Object.defineProperty(global, 'TextEncoder', { value: TextEncoder });
Object.defineProperty(global, 'TextDecoder', { value: TextDecoder });
Object.defineProperty(global, 'crypto', { value: webcrypto });

// Allow router mocks.
// eslint-disable-next-line no-undef
jest.mock('next/router', () => require('next-router-mock'));
