export const DASHBOARD_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Dashboard Data',
  type: 'object',
  required: ['updated_at', 'global', 'pipeline', 'fleet'],
  properties: {
    updated_at: { type: 'string', format: 'date-time' },
    global: {
      type: 'object',
      required: ['mrr_total', 'burn_rate_est', 'active_agents'],
      properties: {
        mrr_total: { type: 'number' },
        burn_rate_est: { type: 'number' },
        active_agents: { type: 'integer' },
        total_users: { type: 'integer' }
      }
    },
    pipeline: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'status', 'score'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          status: { type: 'string' },
          score: { type: 'number' },
          bluf: { type: 'string' }
        }
      }
    },
    fleet: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'health', 'status'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          health: { type: 'string', enum: ['green', 'yellow', 'red'] },
          status: { type: 'string' },
          mrr: { type: 'number' }
        }
      }
    }
  }
};
