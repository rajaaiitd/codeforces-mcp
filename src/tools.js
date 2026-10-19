import { z } from 'zod/v4';

const handle = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/);
const contestId = z.number().int().positive();
const limit = z.number().int().min(1).max(100).default(20);
const offset = z.number().int().min(0).default(0);
const page = { offset, limit };
const submissions = { from: z.number().int().min(1).default(1), count: z.number().int().min(1).max(100).default(20) };
const phase = z.enum(['BEFORE', 'CODING', 'PENDING_SYSTEM_TEST', 'SYSTEM_TEST', 'FINISHED']);
const slice = (items, offset, limit) => ({
  total: items.length, offset, limit, items: items.slice(offset, offset + limit),
  nextOffset: offset + limit < items.length ? offset + limit : null,
});
const problemKey = p => `${p.contestId ?? p.problemsetName}/${p.index}`;
const problemUrl = p => p.contestId
  ? `https://codeforces.com/contest/${p.contestId}/problem/${encodeURIComponent(p.index)}`
  : `https://codeforces.com/problemsets/${encodeURIComponent(p.problemsetName)}/problem/99999/${encodeURIComponent(p.index)}`;

export function createTools(api) {
  return [
    {
      name: 'codeforces_user_info',
      description: 'Get public profiles, ratings, ranks, and organizations for up to 100 Codeforces handles.',
      schema: z.object({ handles: z.array(handle).min(1).max(100) }),
      run: async ({ handles }) => ({ users: await api.call('user.info', { handles: handles.join(';') }) }),
    },
    {
      name: 'codeforces_user_rating',
      description: 'Get a user’s contest rating history, newest first, with pagination.',
      schema: z.object({ handle, ...page }),
      run: async ({ handle, offset, limit }) => slice([...(await api.call('user.rating', { handle }))].reverse(), offset, limit),
    },
    {
      name: 'codeforces_user_submissions',
      description: 'Get a user’s submissions, newest first. Includes verdicts and problem metadata, not source code. from is 1-based.',
      schema: z.object({ handle, ...submissions }),
      run: async args => ({ submissions: await api.call('user.status', args, 10000), from: args.from, count: args.count }),
    },
    {
      name: 'codeforces_contests',
      description: 'List public contests or gyms, optionally filtered by phase and name. Upcoming contests sort soonest first; others newest first.',
      schema: z.object({ gym: z.boolean().default(false), phase: phase.optional(), query: z.string().max(200).optional(), ...page }),
      run: async ({ gym, phase, query, offset, limit }) => {
        let contests = await api.call('contest.list', { gym });
        contests = contests.filter(c => (!phase || c.phase === phase) && (!query || c.name.toLowerCase().includes(query.toLowerCase())));
        contests.sort((a, b) => phase === 'BEFORE'
          ? (a.startTimeSeconds ?? Infinity) - (b.startTimeSeconds ?? Infinity)
          : (b.startTimeSeconds ?? 0) - (a.startTimeSeconds ?? 0));
        return slice(contests.map(c => ({ ...c, url: `https://codeforces.com/${gym ? 'gym' : 'contest'}/${c.id}` })), offset, limit);
      },
    },
    {
      name: 'codeforces_problems',
      description: 'Search problem metadata by name, contest, difficulty rating, and tags (all tags must match). Returns solve counts and links to statements. Full statement text is not supplied by this API.',
      schema: z.object({
        query: z.string().max(200).optional(), contestId: contestId.optional(),
        tags: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
        minRating: z.number().int().min(0).max(5000).optional(),
        maxRating: z.number().int().min(0).max(5000).optional(),
        sort: z.enum(['newest', 'rating_asc', 'rating_desc', 'most_solved']).default('newest'), ...page,
      }).refine(a => a.minRating === undefined || a.maxRating === undefined || a.minRating <= a.maxRating, { message: 'minRating must not exceed maxRating' }),
      run: async ({ query, contestId, tags, minRating, maxRating, sort, offset, limit }) => {
        const data = await api.call('problemset.problems', {}, 300000);
        const stats = new Map(data.problemStatistics.map(p => [problemKey(p), p.solvedCount]));
        let problems = data.problems.filter(p =>
          (!query || p.name.toLowerCase().includes(query.toLowerCase())) &&
          (!contestId || p.contestId === contestId) &&
          tags.every(t => p.tags.includes(t.toLowerCase())) &&
          (minRating === undefined || p.rating >= minRating) &&
          (maxRating === undefined || p.rating <= maxRating));
        problems = problems.map(p => ({ ...p, solvedCount: stats.get(problemKey(p)) ?? 0, url: problemUrl(p) }));
        if (sort === 'rating_asc') problems.sort((a, b) => (a.rating ?? Infinity) - (b.rating ?? Infinity));
        if (sort === 'rating_desc') problems.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
        if (sort === 'most_solved') problems.sort((a, b) => b.solvedCount - a.solvedCount);
        if (sort === 'newest') problems.sort((a, b) => (b.contestId ?? 0) - (a.contestId ?? 0) || a.index.localeCompare(b.index));
        return slice(problems, offset, limit);
      },
    },
    {
      name: 'codeforces_contest_standings',
      description: 'Get official standings and problems for a public regular contest. Handles and pagination are applied locally after fetching the full standings. Gym/private/unofficial standings are not supported.',
      schema: z.object({ contestId, handles: z.array(handle).min(1).max(100).optional(), ...page }),
      run: async ({ contestId, handles, offset, limit }) => {
        // Public regular contests require exactly this one upstream parameter.
        const data = await api.call('contest.standings', { contestId });
        const wanted = handles && new Set(handles.map(h => h.toLowerCase()));
        const rows = data.rows.filter(r => !wanted || r.party.members.some(m => wanted.has(m.handle.toLowerCase())));
        return { contest: data.contest, problems: data.problems, ...slice(rows, offset, limit) };
      },
    },
    {
      name: 'codeforces_contest_submissions',
      description: 'Get recent public submissions for a contest, optionally for one user. from is 1-based.',
      schema: z.object({ contestId, handle: handle.optional(), ...submissions }),
      run: async args => ({ submissions: await api.call('contest.status', args, 10000), from: args.from, count: args.count }),
    },
    {
      name: 'codeforces_contest_rating_changes',
      description: 'Get published rating changes for a contest, optionally filtered by handle. Changes may be unavailable until after the contest.',
      schema: z.object({ contestId, handle: handle.optional(), ...page }),
      run: async ({ contestId, handle, offset, limit }) => {
        const changes = await api.call('contest.ratingChanges', { contestId }, 300000);
        return slice(changes.filter(c => !handle || c.handle.toLowerCase() === handle.toLowerCase()), offset, limit);
      },
    },
  ];
}
