export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Aperture Agent Service API',
    version: '0.1.0',
    description:
      'HTTP control plane for the autonomous Aperture agent. Manages the agent loop (start/stop), exposes running state and live activity feed. Each agent cycle compiles a policy, generates a RISC Zero ZK proof, executes x402/MPP payment flows, and anchors a batch attestation on Solana Devnet.',
  },
  servers: [
    { url: 'http://localhost:3004', description: 'Local development' },
  ],
  components: {
    schemas: {
      Health: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'healthy' },
          service: { type: 'string', example: 'agent-service' },
          version: { type: 'string', example: '0.1.0' },
        },
      },
      AgentStats: {
        type: 'object',
        properties: {
          totalX402: { type: 'integer' },
          totalMpp: { type: 'integer' },
          totalProofs: { type: 'integer' },
          totalViolations: { type: 'integer' },
          totalUsdcSpent: { type: 'number' },
          totalMppSpent: { type: 'number' },
          totalSessions: { type: 'integer' },
        },
      },
      StatusResponse: {
        type: 'object',
        properties: {
          running: { type: 'boolean' },
          operatorId: { type: 'string' },
          lastActivity: {
            oneOf: [
              { $ref: '#/components/schemas/ActivityRecord' },
              { type: 'null' },
            ],
          },
          stats: { $ref: '#/components/schemas/AgentStats' },
        },
      },
      ActivityRecord: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
          type: {
            type: 'string',
            enum: ['x402', 'mpp', 'attestation', 'policy_check', 'zk_proof', 'error'],
          },
          message: { type: 'string' },
          proofHash: { type: 'string', nullable: true },
          txSignature: { type: 'string', nullable: true },
          paymentIntentId: { type: 'string', nullable: true },
          success: { type: 'boolean' },
        },
      },
      ActivityResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/ActivityRecord' },
          },
        },
      },
      ControlResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string', nullable: true },
          error: { type: 'string', nullable: true },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        summary: 'Service health check',
        description: 'Returns service liveness information. Used by Docker healthcheck.',
        responses: {
          200: {
            description: 'Healthy',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } },
          },
        },
      },
    },
    '/status': {
      get: {
        summary: 'Agent runtime status',
        description: 'Current running state, operator identifier, last activity and aggregate stats.',
        responses: {
          200: {
            description: 'Status snapshot',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/StatusResponse' } },
            },
          },
        },
      },
    },
    '/activity': {
      get: {
        summary: 'Live activity feed',
        description: 'Returns the most recent activity records (capped at 200 in-memory).',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
        ],
        responses: {
          200: {
            description: 'Activity array',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ActivityResponse' } },
            },
          },
        },
      },
    },
    '/start': {
      post: {
        summary: 'Start the autonomous agent loop',
        description:
          'Performs pre-start validation: (1) at least one active policy must exist, (2) policy must allow `x402` and `mpp` endpoint categories, (3) prover service must respond to a health probe. If any check fails, returns HTTP 400 with a descriptive message.',
        responses: {
          200: {
            description: 'Agent started (or already running)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ControlResponse' } } },
          },
          400: {
            description: 'Pre-start validation failed',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ControlResponse' } } },
          },
          500: {
            description: 'Policy service unreachable',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ControlResponse' } } },
          },
        },
      },
    },
    '/stop': {
      post: {
        summary: 'Stop the agent loop',
        description:
          'Signals the loop to stop. Any in-flight cycle (proof generation, payment, anchoring) is allowed to finish before the next cycle is suppressed.',
        responses: {
          200: {
            description: 'Agent stopped (or already stopped)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ControlResponse' } } },
          },
        },
      },
    },
  },
} as const;
