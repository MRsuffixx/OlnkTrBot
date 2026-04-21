import { BotError } from './BotError.js';

export class PermissionError extends BotError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'PERMISSION_DENIED', 'errors:permission_denied', context, true);
  }
}

export class RateLimitError extends BotError {
  public readonly retryAfter: number;

  constructor(message: string, retryAfter: number, context: Record<string, unknown> = {}) {
    super(message, 'RATE_LIMITED', 'errors:rate_limited', context, true);
    this.retryAfter = retryAfter;
  }
}

export class CooldownError extends BotError {
  public readonly remaining: number;

  constructor(message: string, remaining: number, context: Record<string, unknown> = {}) {
    super(message, 'ON_COOLDOWN', 'errors:on_cooldown', context, true);
    this.remaining = remaining;
  }
}

export class BlacklistError extends BotError {
  public readonly reason: string;
  public readonly expiresAt: Date | null;

  constructor(
    message: string,
    reason: string,
    expiresAt: Date | null,
    context: Record<string, unknown> = {},
  ) {
    super(message, 'BLACKLISTED', 'errors:blacklisted', context, true);
    this.reason = reason;
    this.expiresAt = expiresAt;
  }
}

export class MaintenanceError extends BotError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'MAINTENANCE', 'errors:maintenance', context, true);
  }
}

export class ValidationError extends BotError {
  public readonly field: string;
  public readonly expected: string;

  constructor(
    message: string,
    field: string,
    expected: string,
    context: Record<string, unknown> = {},
  ) {
    super(message, 'VALIDATION_FAILED', 'errors:validation_failed', context, true);
    this.field = field;
    this.expected = expected;
  }
}

export class ExternalServiceError extends BotError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'EXTERNAL_SERVICE_ERROR', 'errors:external_service_error', context, false);
  }
}

export class ConfigurationError extends BotError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'CONFIGURATION_ERROR', 'errors:configuration_error', context, false);
  }
}

export {
  BotError,
};