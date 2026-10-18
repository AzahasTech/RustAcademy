import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppModule } from './app.module';
import request from 'supertest';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = module.get<AppController>(AppController);
  });

  describe('getHello', () => {
    it('should return the service greeting', () => {
      expect(appController.getHello()).toBe('RustAcademy BackendAcademy API');
    });
  });
});

describe('Request body size limit (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should reject oversized JSON bodies with 413 Payload Too Large', async () => {
    // Create a payload larger than the default 1MB limit
    const oversizedPayload = { data: 'x'.repeat(2 * 1024 * 1024) }; // 2MB

    const response = await request(app.getHttpServer())
      .post('/api/test')
      .send(oversizedPayload)
      .expect(413);

    expect(response.body).toHaveProperty('message');
    expect(response.body.message).toContain('payload too large');
  });

  it('should accept JSON bodies within the size limit', async () => {
    // Create a payload well within the 1MB limit
    const validPayload = { data: 'x'.repeat(100) };

    // Note: This endpoint may not exist, but the body size limit
    // middleware should still allow the request through (possibly 404)
    const response = await request(app.getHttpServer())
      .post('/api/test')
      .send(validPayload);

    // Should not be 413 (Payload Too Large)
    expect(response.status).not.toBe(413);
  });
});
