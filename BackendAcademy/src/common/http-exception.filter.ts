import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
  } from '@nestjs/common';
  import { Request, Response } from 'express';
import { MonitoringService } from '../monitoring/monitoring.service';
  
  /**
   * Global exception filter. Normalizes every thrown error into a consistent
   * JSON shape: { error, message, statusCode, path, timestamp }. Also emits
   * an error-event metric so operational regressions (like a spike in
   * missing/unpublished lesson lookups) show up on dashboards without
   * anyone having to grep logs.
   */
  @Catch()
  export class HttpExceptionFilter implements ExceptionFilter {
    constructor(private readonly monitoring: MonitoringService) {}
  
    catch(exception: unknown, host: ArgumentsHost): void {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse<Response>();
      const request = ctx.getRequest<Request>();
  
      const isHttpException = exception instanceof HttpException;
      const statusCode = isHttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
  
      const rawBody = isHttpException ? exception.getResponse() : null;
  
      const { error, message } = this.normalize(rawBody, exception);
      this.monitoring.recordError(
        request.route?.path ?? request.url,
        error,
      );
  
      response.status(statusCode).json({
        error,
        message,
        statusCode,
        path: request.url,
        timestamp: new Date().toISOString(),
      });
    }
  
    private normalize(
      rawBody: unknown,
      exception: unknown,
    ): { error: string; message: string } {
      // Exceptions thrown as `new NotFoundException({ error, message })`
      // (the pattern used throughout CourseService/LessonService) already
      // carry a structured body — pass it through as-is.
      if (
        rawBody &&
        typeof rawBody === 'object' &&
        'error' in rawBody &&
        'message' in rawBody
      ) {
        return {
          error: String((rawBody as any).error),
          message: String((rawBody as any).message),
        };
      }
  
      if (typeof rawBody === 'string') {
        return { error: 'HTTP_EXCEPTION', message: rawBody };
      }
  
      // Anything else (unexpected runtime errors) is masked with a generic
      // message so internals never leak to the client.
      return {
        error: 'INTERNAL_ERROR',
        message:
          exception instanceof Error
            ? 'An unexpected error occurred'
            : 'An unknown error occurred',
      };
    }
  }