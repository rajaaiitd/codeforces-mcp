import { z } from 'zod/v4';

const page = { offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(20) };
const paginate = (items, { offset, limit }) => ({ total: items.length, offset, limit, items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null });

export function createAccountTools(api) {
  return [
    {
      name: 'codeforces_my_friends',
      description: 'Get the connected Codeforces account’s friends. Uses the account authorized in the browser; never accepts credentials as tool arguments.',
      schema: z.object({ onlyOnline: z.boolean().default(false), ...page }),
      run: async ({ onlyOnline, ...paging }) => paginate(await api.authenticatedCall('user.friends', { onlyOnline }), paging),
    },
    {
      name: 'codeforces_my_contests',
      description: 'List contests available to the connected Codeforces account, including private gyms and mashups the account can access.',
      schema: z.object({ gym: z.boolean().default(false), ...page }),
      run: async ({ gym, ...paging }) => paginate(await api.authenticatedCall('contest.list', { gym }), paging),
    },
    {
      name: 'codeforces_gym_standings',
      description: 'Read authenticated standings for a gym or mashup the connected account can access. For public regular contests use codeforces_contest_standings.',
      schema: z.object({ contestId: z.number().int().positive(), from: z.number().int().positive().default(1), count: z.number().int().min(1).max(100).default(20), showUnofficial: z.boolean().default(false) }),
      run: args => api.authenticatedCall('contest.standings', args),
    },
  ];
}
