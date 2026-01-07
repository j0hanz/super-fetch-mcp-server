import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  acceptsEventStream,
  ensurePostAcceptHeader,
} from '../dist/http/accept-policy.js';

type AcceptCase = {
  name: string;
  header?: string;
  expected: string;
};

type EventStreamCase = {
  name: string;
  header?: string;
  expected: boolean;
};

const postAcceptCases: AcceptCase[] = [
  {
    name: 'defaults POST Accept when missing',
    expected: 'application/json, text/event-stream',
  },
  {
    name: 'defaults POST Accept when */*',
    header: '*/*',
    expected: 'application/json, text/event-stream',
  },
  {
    name: 'defaults POST Accept when incomplete',
    header: 'application/json',
    expected: 'application/json, text/event-stream',
  },
  {
    name: 'preserves POST Accept when already includes JSON and SSE',
    header: 'application/json, text/event-stream',
    expected: 'application/json, text/event-stream',
  },
];

const eventStreamCases: EventStreamCase[] = [
  {
    name: 'returns false when Accept is missing',
    expected: false,
  },
  {
    name: 'returns true when Accept includes SSE',
    header: 'text/event-stream',
    expected: true,
  },
];

function runPostAcceptCase(testCase: AcceptCase) {
  const req = {
    headers: testCase.header ? { accept: testCase.header } : {},
  } as never;

  ensurePostAcceptHeader(req);

  assert.equal(req.headers.accept, testCase.expected);
}

function runEventStreamCase(testCase: EventStreamCase) {
  const req = {
    headers: testCase.header ? { accept: testCase.header } : {},
  } as never;

  assert.equal(acceptsEventStream(req), testCase.expected);
}

function registerPostAcceptCases() {
  postAcceptCases.forEach((testCase) => {
    it(testCase.name, () => {
      runPostAcceptCase(testCase);
    });
  });
}

function registerEventStreamCases() {
  eventStreamCases.forEach((testCase) => {
    it(`acceptsEventStream ${testCase.name}`, () => {
      runEventStreamCase(testCase);
    });
  });
}

function registerAcceptPolicyTests() {
  describe('accept-policy', () => {
    registerPostAcceptCases();
    registerEventStreamCases();
  });
}

registerAcceptPolicyTests();
