import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { ConfigService } from '@nestjs/config';

describe('application authentication routes (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    app.get(ConfigService).set('DEMO_ENABLED', 'false');
  });

  it('hides demo routes in the normal application', () => {
    return request(app.getHttpServer()).get('/api/demo/session').expect(404);
  });
  it('requires a token to search jobs', () => {
    return request(app.getHttpServer()).get('/api/job').expect(401);
  });

  afterEach(async () => {
    await app.close();
  });
});
