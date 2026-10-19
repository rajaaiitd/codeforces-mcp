import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTools } from '../src/tools.js';

function tool(name, result) {
  const calls = [];
  const selected = createTools({ call: async (...args) => { calls.push(args); return result; } }).find(t => t.name === `codeforces_${name}`);
  return { calls, schema: selected.schema, run: args => selected.run(selected.schema.parse(args)) };
}

test('problem search combines rating, all tags, names, sorting and pagination', async () => {
  const { run } = tool('problems', {
    problems: [
      { contestId: 1, index: 'A', name: 'Graph A', rating: 1000, tags: ['graphs', 'dfs and similar'] },
      { contestId: 2, index: 'B', name: 'Graph B', rating: 1200, tags: ['graphs', 'dfs and similar'] },
      { contestId: 3, index: 'A', name: 'Graph C', tags: ['graphs', 'dfs and similar'] },
      { contestId: 4, index: 'A', name: 'Graph D', rating: 1100, tags: ['graphs'] },
    ],
    problemStatistics: [{ contestId: 2, index: 'B', solvedCount: 99 }],
  });
  const result = await run({ query: 'GRAPH', tags: ['graphs', 'dfs and similar'], minRating: 800, maxRating: 1200, sort: 'most_solved', limit: 1 });
  assert.equal(result.total, 2);
  assert.equal(result.nextOffset, 1);
  assert.equal(result.items[0].solvedCount, 99);
  assert.equal(result.items[0].url, 'https://codeforces.com/contest/2/problem/B');
});

test('standings only send contestId upstream; filters and pagination happen locally', async () => {
  const { run, calls } = tool('contest_standings', {
    contest: { id: 1 }, problems: [], rows: [
      { rank: 1, party: { members: [{ handle: 'Alice' }] } },
      { rank: 2, party: { members: [{ handle: 'Bob' }] } },
      { rank: 3, party: { members: [{ handle: 'alice' }] } },
    ],
  });
  const result = await run({ contestId: 1, handles: ['ALICE'], offset: 1, limit: 1 });
  assert.deepEqual(calls[0], ['contest.standings', { contestId: 1 }]);
  assert.equal(result.total, 2);
  assert.equal(result.items[0].rank, 3);
  assert.equal(result.nextOffset, null);
});

test('upcoming contests sort soonest first and filter by name', async () => {
  const { run } = tool('contests', [
    { id: 3, name: 'Round C', phase: 'BEFORE', startTimeSeconds: 30 },
    { id: 1, name: 'Round A', phase: 'FINISHED', startTimeSeconds: 10 },
    { id: 2, name: 'Round B', phase: 'BEFORE', startTimeSeconds: 20 },
  ]);
  assert.deepEqual((await run({ phase: 'BEFORE', query: 'round' })).items.map(c => c.id), [2, 3]);
});

test('rating history reverses without mutating cached results', async () => {
  const history = [{ newRating: 1000 }, { newRating: 1200 }];
  const { run } = tool('user_rating', history);
  assert.equal((await run({ handle: 'tourist' })).items[0].newRating, 1200);
  assert.equal(history[0].newRating, 1000);
});

test('schemas reject invalid handles, oversized responses, and inverted rating range', () => {
  assert.throws(() => tool('user_info').schema.parse({ handles: ['a;b'] }));
  assert.throws(() => tool('user_submissions').schema.parse({ handle: 'a', count: 1000 }));
  assert.throws(() => tool('contest_standings').schema.parse({ contestId: -1 }));
  assert.throws(() => tool('problems').schema.parse({ minRating: 2000, maxRating: 1000 }));
});
