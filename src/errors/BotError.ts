export class BotError extends Error {
  public readonly code: string;
  public readonly userMessageKey: string;
  public readonly context: Record<string, unknown>;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    code: string,
    userMessageKey: string,
    context: Record<string, unknown> = {},
    isOperational: boolean = true,
  ) {
    super(message);
    this.name = 'BotError';
    this.code = code;
    this.userMessageKey = userMessageKey;
    this.context = context;
    this.isOperational = isOperational;

    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, BotError.prototype);
  }

  public toString(): string {
    return `[${this.code}] ${this.message} (${JSON.stringify(this.context)})`;
  }
}