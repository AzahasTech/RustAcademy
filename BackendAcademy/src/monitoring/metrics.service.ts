import { Injectable } from '@nestjs/common';
import { InjectMetric, makeCounterProvider } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';

export const HTTP_REQUESTS_METRIC = 'app_http_requests_total';
export const DOMAIN_EVENTS_METRIC = 'app_domain_events_total';
export const ERROR_EVENTS_METRIC = 'app_error_events_total';

export const httpRequestsCounterProvider = makeCounterProvider({
  name: HTTP_REQUESTS_METRIC,
  help: 'Total number of HTTP requests received by the application',
  labelNames: ['method', 'route', 'status_code'],
});

export const domainEventsCounterProvider = makeCounterProvider({
  name: DOMAIN_EVENTS_METRIC,
  help: 'Total number of domain/business events emitted by the application',
  labelNames: ['event_type', 'source'],
});

export const errorEventsCounterProvider = makeCounterProvider({
  name: ERROR_EVENTS_METRIC,
  help: 'Total number of error events emitted by the application',
  labelNames: ['source', 'reason'],
});

/**
 * Thin wrapper service so other modules (e.g. PaymentsController) can record
 * metrics without reaching into raw prom-client counters directly.
 *
 * Issue #412 follow-up: webhook processing records domain events for every
 * legitimate state transition, and error events for rejected duplicate or
 * illegal-transition callbacks, so bad provider behavior (or bugs) shows up
 * in dashboards/alerts instead of silently corrupting payment state.
 */
@Injectable()
export class MetricsService {
  constructor(
    @InjectMetric(HTTP_REQUESTS_METRIC) private readonly httpRequestsCounter: Counter<string>,
    @InjectMetric(DOMAIN_EVENTS_METRIC) private readonly domainEventsCounter: Counter<string>,
    @InjectMetric(ERROR_EVENTS_METRIC) private readonly errorEventsCounter: Counter<string>,
  ) {}

  recordHttpRequest(method: string, route: string, statusCode: number): void {
    this.httpRequestsCounter.inc({ method, route, status_code: String(statusCode) });
  }

  recordDomainEvent(eventType: string, source: string): void {
    this.domainEventsCounter.inc({ event_type: eventType, source });
  }

  recordErrorEvent(source: string, reason: string): void {
    this.errorEventsCounter.inc({ source, reason });
  }
}
