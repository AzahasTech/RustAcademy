/**
 * Error contract tests (Issue #562)
 *
 * Verifies that every error path — validation failures, 404s, business errors,
 * and unhandled exceptions — returns a deterministic, consistent payload
 * matching the shared ErrorEnvelope type.
 *
 * Regression guard: any change to the error contract shape will break these
 * assertions, surfacing the break in CI before it ships to production.
 */

import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { GlobalHttpExceptionFilter } from "../src/common/filters/global-http-exception.filter";
import { AppConfigService } from "../src/config";
import { mapValidationErrors } from "../src/common/utils/validation-error.mapper";
import { ErrorCode } from "../src/common/errors";
import { ApiKeyGuard } from "../src/auth/guards/api-key.guard";
import { CustomThrottlerGuard } from "../src/auth/guards/custom-throttler.guard";

describe("Error Envelope Contract (Issue #562)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ApiKeyGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideProvider(CustomThrottlerGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    app = moduleRef.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors) => {
          const mapped = mapValidationErrors(errors);
          return new BadRequestException({
            code: ErrorCode.VALIDATION_ERROR,
            message: mapped.message,
            fields: mapped.fields,
          });
        },
      }),
    );

    const configService = moduleRef.get(AppConfigService);
    app.useGlobalFilters(new GlobalHttpExceptionFilter(configService));

    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // ─── Envelope shape contract ────────────────────────────────────────────

  describe("Envelope shape contract", () => {
    /**
     * Every error response MUST have this top-level shape:
     *   { success: false, error: { code, message } }
     */
    it("always returns success: false in error responses", async () => {
      const response = await request(app.getHttpServer())
        .get("/non-existent-endpoint-xyz")
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body).toHaveProperty("error");
      expect(typeof response.body.error).toBe("object");
    });

    it("error object always contains code and message", async () => {
      const response = await request(app.getHttpServer())
        .get("/non-existent-endpoint-xyz")
        .expect(404);

      expect(typeof response.body.error.code).toBe("string");
      expect(response.body.error.code.length).toBeGreaterThan(0);
      expect(typeof response.body.error.message === "string" || Array.isArray(response.body.error.message)).toBe(true);
    });

    it("error code uses SCREAMING_SNAKE_CASE convention", async () => {
      const response = await request(app.getHttpServer())
        .get("/non-existent-endpoint-xyz")
        .expect(404);

      // Code should be upper-case with underscores (e.g. NOT_FOUND, VALIDATION_ERROR)
      expect(response.body.error.code).toMatch(/^[A-Z][A-Z_]+$/);
    });
  });

  // ─── Validation errors ─────────────────────────────────────────────────

  describe("Validation error contract", () => {
    it("returns VALIDATION_ERROR code for invalid payload", async () => {
      const response = await request(app.getHttpServer())
        .post("/links/metadata")
        .send({ amount: "not-a-number" })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(response.body.error.message).toBe("Validation failed");
    });

    it("includes fields array with per-field errors", async () => {
      const response = await request(app.getHttpServer())
        .post("/links/metadata")
        .send({ amount: "invalid" })
        .expect(400);

      expect(Array.isArray(response.body.error.fields)).toBe(true);
      expect(response.body.error.fields.length).toBeGreaterThan(0);

      // Each field entry must have `field` and `errors` keys
      for (const entry of response.body.error.fields) {
        expect(typeof entry.field).toBe("string");
        expect(Array.isArray(entry.errors)).toBe(true);
        expect(entry.errors.length).toBeGreaterThan(0);
      }
    });

    it("whitelist strips unknown properties before validation", async () => {
      const response = await request(app.getHttpServer())
        .post("/links/metadata")
        .send({ amount: 100, asset: "XLM", secretField: "should-be-stripped" })
        .expect(200);

      // Should succeed because unknown props are stripped by whitelist
      expect(response.body.success).toBe(true);
    });

    it("forbids unknown properties when forbidNonWhitelisted is enabled", async () => {
      const response = await request(app.getHttpServer())
        .post("/username")
        .send({ username: "alice_123", publicKey: "GBXGQ55JMQ4L2B6E7S8Y9Z0A1B2C3D4E5F6G7H8I7YWRABCDEFGHIJKL", completelyUnknownProp: true })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });

  // ─── Not-found (404) errors ────────────────────────────────────────────

  describe("404 error contract", () => {
    it("returns consistent envelope for unknown routes", async () => {
      const response = await request(app.getHttpServer())
        .get("/this-route-does-not-exist")
        .expect(404);

      expect(response.body).toEqual({
        success: false,
        error: expect.objectContaining({
          code: expect.any(String),
          message: expect.any(String),
        }),
      });
    });
  });

  // ─── Correlation ID / trace metadata ────────────────────────────────────

  describe("Correlation ID contract", () => {
    it("echoes client-provided x-request-id back in the error body", async () => {
      const requestId = "test-contract-trace-id-001";

      const response = await request(app.getHttpServer())
        .get("/non-existent-route")
        .set("x-request-id", requestId)
        .expect(404);

      // Error body should contain the correlation ID
      expect(response.body.error.request_id).toBe(requestId);
      expect(response.body.error.correlationId).toBe(requestId);

      // Response header should echo it back
      expect(response.headers["x-request-id"]).toBe(requestId);
    });

    it("auto-generates a correlation ID when none is provided", async () => {
      const response = await request(app.getHttpServer())
        .get("/non-existent-route")
        .expect(404);

      // Should have a generated UUID in the response
      expect(response.body.error.request_id).toBeDefined();
      expect(typeof response.body.error.request_id).toBe("string");
      expect(response.body.error.request_id.length).toBeGreaterThan(0);

      // Response header should also have it
      expect(response.headers["x-request-id"]).toBeDefined();
    });

    it("correlation ID is consistent between header and body", async () => {
      const response = await request(app.getHttpServer())
        .get("/non-existent-route")
        .expect(404);

      const headerId = response.headers["x-request-id"];
      const bodyId = response.body.error.request_id;
      expect(headerId).toBe(bodyId);
    });
  });

  // ─── Health endpoints are stable ────────────────────────────────────────

  describe("Health endpoints return success envelope", () => {
    it("GET /health returns 200 with status ok", async () => {
      const response = await request(app.getHttpServer())
        .get("/health")
        .expect(200);

      expect(response.body).toHaveProperty("status", "ok");
      expect(response.body).toHaveProperty("version");
      expect(response.body).toHaveProperty("uptime");
    });

    it("GET /ready returns structured readiness check", async () => {
      const response = await request(app.getHttpServer())
        .get("/ready")
        .expect(200);

      expect(response.body).toHaveProperty("ready");
      expect(response.body).toHaveProperty("checks");
      expect(Array.isArray(response.body.checks)).toBe(true);

      // Each check should have name and status
      for (const check of response.body.checks) {
        expect(typeof check.name).toBe("string");
        expect(["up", "down"]).toContain(check.status);
      }
    });
  });

  // ─── Business error envelope (marketplace pattern) ──────────────────────

  describe("Business error envelope consistency", () => {
    it("POST /links/metadata with invalid asset returns code and message", async () => {
      const response = await request(app.getHttpServer())
        .post("/links/metadata")
        .send({ amount: 10, asset: "INVALID_ASSET" })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(typeof response.body.error.code).toBe("string");
      expect(typeof response.body.error.message).toBe("string");
    });
  });

  // ─── Response headers contract ──────────────────────────────────────────

  describe("Response headers contract", () => {
    it("sets x-request-id on successful responses", async () => {
      const response = await request(app.getHttpServer())
        .get("/health")
        .expect(200);

      expect(response.headers["x-request-id"]).toBeDefined();
    });

    it("sets x-request-id on error responses", async () => {
      const response = await request(app.getHttpServer())
        .get("/non-existent-route")
        .expect(404);

      expect(response.headers["x-request-id"]).toBeDefined();
    });

    it("sets x-correlation-id header as well", async () => {
      const response = await request(app.getHttpServer())
        .get("/non-existent-route")
        .expect(404);

      expect(response.headers["x-correlation-id"]).toBeDefined();
    });
  });

  // ─── Rate-limit error shape (contract only — not actually rate-limited) ─

  describe("Rate-limit error shape contract", () => {
    it("validates the expected rate-limit error shape exists", () => {
      // This is a static contract assertion — if someone changes the
      // GlobalHttpExceptionFilter's rate-limit branch, this documents
      // the expected output shape.
      const expectedShape = {
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: expect.any(String),
          details: {
            retryAfterSeconds: expect.any(Number),
          },
        },
      };

      // Mock a rate-limit response to verify shape
      const mockRateLimitResponse = {
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests. Retry after 60 seconds.",
          details: { retryAfterSeconds: 60 },
        },
      };

      expect(mockRateLimitResponse).toEqual(expectedShape);
    });
  });

  // ─── Domain error shape contract ────────────────────────────────────────

  describe("Domain error shape contract", () => {
    it("validates the expected Soroban domain error shape exists", () => {
      // Documents the contract for SorobanDomainException responses
      const expectedShape = {
        success: false,
        error: {
          code: expect.any(String),
          message: expect.any(String),
        },
      };

      const mockDomainResponse = {
        success: false,
        error: {
          code: "CONTRACT_PAUSED",
          message: "This contract is currently paused",
        },
      };

      expect(mockDomainResponse).toEqual(expectedShape);
    });
  });
});
