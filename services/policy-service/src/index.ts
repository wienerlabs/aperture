import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import policyRouter from './routes/policy.js';
import healthRouter from './routes/health.js';
import squadsRouter from './routes/squads.js';
import onchainRouter from './routes/onchain.js';
import authRouter from './routes/auth.js';
import { swaggerSpec } from './swagger.js';

const app = express();

app.use(helmet());
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3333'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api-docs.json', (_req, res) => {
  res.json(swaggerSpec);
});

app.use('/health', healthRouter);
app.use('/api/v1/policies', policyRouter);
app.use('/api/v1/squads', squadsRouter);
app.use('/api/v1/onchain', onchainRouter);
app.use('/api/v1/auth', authRouter);

app.use(errorHandler);

const server = app.listen(config.port, () => {
  logger.info(`Policy Service running on port ${config.port}`, {
    port: config.port,
    env: config.nodeEnv,
    swagger: `http://localhost:${config.port}/api-docs`,
  });
});

function gracefulShutdown(signal: string): void {
  logger.info(`Received ${signal}, shutting down gracefully`);
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
