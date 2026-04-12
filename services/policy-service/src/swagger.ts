import swaggerJsdoc from 'swagger-jsdoc';
import { config } from './config.js';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Aperture Policy Service API',
      version: '0.1.0',
      description: 'Policy CRUD API for Aperture ZK compliance layer. Manages operator spending policies for AI agent payments on Solana.',
      contact: {
        name: 'Aperture Team',
      },
    },
    servers: [
      {
        url: `http://localhost:${config.port}`,
        description: 'Local development',
      },
    ],
    components: {
      schemas: {
        TimeRestriction: {
          type: 'object',
          required: ['allowed_days', 'allowed_hours_start', 'allowed_hours_end', 'timezone'],
          properties: {
            allowed_days: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
              },
            },
            allowed_hours_start: { type: 'integer', minimum: 0, maximum: 23 },
            allowed_hours_end: { type: 'integer', minimum: 0, maximum: 23 },
            timezone: { type: 'string', example: 'UTC' },
          },
        },
        PolicyInput: {
          type: 'object',
          required: [
            'operator_id', 'name', 'max_daily_spend', 'max_per_transaction',
            'allowed_endpoint_categories', 'blocked_addresses', 'time_restrictions', 'token_whitelist',
          ],
          properties: {
            operator_id: { type: 'string', format: 'uuid' },
            name: { type: 'string', maxLength: 255 },
            description: { type: 'string', maxLength: 1000 },
            max_daily_spend: { type: 'number', exclusiveMinimum: 0 },
            max_per_transaction: { type: 'number', exclusiveMinimum: 0 },
            allowed_endpoint_categories: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
            },
            blocked_addresses: {
              type: 'array',
              items: { type: 'string' },
            },
            time_restrictions: {
              type: 'array',
              items: { $ref: '#/components/schemas/TimeRestriction' },
            },
            token_whitelist: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
            },
            is_active: { type: 'boolean', default: true },
          },
        },
        PolicyUpdate: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 255 },
            description: { type: 'string', maxLength: 1000 },
            max_daily_spend: { type: 'number', exclusiveMinimum: 0 },
            max_per_transaction: { type: 'number', exclusiveMinimum: 0 },
            allowed_endpoint_categories: { type: 'array', items: { type: 'string' } },
            blocked_addresses: { type: 'array', items: { type: 'string' } },
            time_restrictions: { type: 'array', items: { $ref: '#/components/schemas/TimeRestriction' } },
            token_whitelist: { type: 'array', items: { type: 'string' } },
            is_active: { type: 'boolean' },
          },
        },
        Policy: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            operator_id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            max_daily_spend: { type: 'number' },
            max_per_transaction: { type: 'number' },
            allowed_endpoint_categories: { type: 'array', items: { type: 'string' } },
            blocked_addresses: { type: 'array', items: { type: 'string' } },
            time_restrictions: { type: 'array', items: { $ref: '#/components/schemas/TimeRestriction' } },
            token_whitelist: { type: 'array', items: { type: 'string' } },
            is_active: { type: 'boolean' },
            version: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        PolicyResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { $ref: '#/components/schemas/Policy' },
            error: { type: 'string', nullable: true },
          },
        },
        ApiError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            data: { type: 'null' },
            error: { type: 'string' },
            details: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.ts', './dist/routes/*.js'],
};

export const swaggerSpec = swaggerJsdoc(options);
