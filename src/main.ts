import { shutdownInstrumentation } from './instrumentation';
import 'reflect-metadata';
import { createShutdown } from './shutdown';
import type { INestApplication } from '@nestjs/common';
/**
 * This is the main entry point of the application. It sets up the NestJS application, applies global validation pipes, and configures Swagger for API documentation. Finally, it starts the server on the specified port.
 */
import { ValidationPipe } from '@nestjs/common/pipes/validation.pipe';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { StructuredLogger } from './shared/observability/structured-logger';

let application: INestApplication | undefined;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    abortOnError: false,
  });
  application = app;
  app.useLogger(app.get(StructuredLogger));
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
    }),
  );

  const options = new DocumentBuilder()
    .setTitle('Fitwork API')
    .setDescription('API documentation for Fitwork application')
    .setVersion('1.0')
    .addTag('auth', 'Authentication related endpoints')
    .addTag('users', 'User management endpoints')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      displayRequestDuration: true,
    },
  });
  app.enableCors({
    origin: [
      'http://localhost:5173',
      'http://localhost:3000',
      'https://fit-work-fe.vercel.app',
    ], // default react dev server port
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3000);
}

// Register before asynchronous startup so signals during startup also drain safely.
const shutdown = createShutdown(
  async () => {
    try {
      await startup;
    } finally {
      await application?.close();
    }
  },
  shutdownInstrumentation,
  (code) => process.exit(code),
);
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
const startup = bootstrap();
void startup.catch(() => {
  process.stderr.write('application.startup_failed\n');
  void shutdown();
});
