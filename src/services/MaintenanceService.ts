import { injectable, inject } from 'tsyringe';
import { ConfigService } from '../config/ConfigService.js';
import { LoggerService } from './LoggerService.js';
import { CacheService } from './CacheService.js';

export interface MaintenanceState {
  enabled: boolean;
  message: string | null;
  estimatedEndTime: Date | null;
  enabledAt: Date;
}

@injectable()
export class MaintenanceService {
  private readonly logger: ReturnType<LoggerService['child']>;
  private readonly cacheKey: string;
  private readonly defaultMessage: string = 'The bot is currently undergoing maintenance. Please try again later.';

  constructor(
    @inject(ConfigService) private readonly configService: ConfigService,
    @inject(LoggerService) private readonly loggerService: LoggerService,
    @inject(CacheService) private readonly cacheService: CacheService,
  ) {
    this.logger = this.loggerService.child('MaintenanceService');
    this.cacheKey = 'maintenance:state';
  }

  public async initialize(): Promise<void> {
    const maintenanceMode = this.configService.maintenanceMode;

    if (maintenanceMode) {
      this.logger.warn('Maintenance mode enabled via environment variable');
      await this.enable(this.defaultMessage);
      return;
    }

    // Check for persisted maintenance state from previous session
    const persistedState = await this.getState();
    if (persistedState?.enabled) {
      this.logger.warn('Restoring maintenance mode from previous session', {
        message: persistedState.message,
        enabledAt: persistedState.enabledAt,
      });
    }
  }

  public async isEnabled(): Promise<boolean> {
    const state = await this.getState();
    return state?.enabled ?? false;
  }

  public async enable(message?: string, estimatedEndTime?: Date): Promise<void> {
    const state: MaintenanceState = {
      enabled: true,
      message: message ?? this.defaultMessage,
      estimatedEndTime: estimatedEndTime ?? null,
      enabledAt: new Date(),
    };

    await this.cacheService.set(this.cacheKey, state);
    this.logger.warn('Maintenance mode enabled', {
      message: state.message,
      estimatedEndTime: state.estimatedEndTime?.toISOString(),
    });
  }

  public async disable(): Promise<void> {
    await this.cacheService.delete(this.cacheKey);
    this.logger.info('Maintenance mode disabled');
  }

  public async getState(): Promise<MaintenanceState | null> {
    try {
      const state = await this.cacheService.get<MaintenanceState>(this.cacheKey);
      if (!state) {
        return null;
      }

      // Ensure dates are properly reconstructed
      return {
        ...state,
        estimatedEndTime: state.estimatedEndTime ? new Date(state.estimatedEndTime) : null,
        enabledAt: new Date(state.enabledAt),
      };
    } catch (error) {
      this.logger.error('Failed to retrieve maintenance state', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  public async getStatusMessage(): Promise<string> {
    const state = await this.getState();
    if (!state?.enabled) {
      return '';
    }

    let message = state.message ?? this.defaultMessage;

    if (state.estimatedEndTime) {
      const now = new Date();
      const endTime = new Date(state.estimatedEndTime);
      
      if (endTime > now) {
        const diffMs = endTime.getTime() - now.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        
        if (diffHours > 0) {
          message += ` Estimated completion: ${diffHours}h ${diffMinutes}m`;
        } else if (diffMinutes > 0) {
          message += ` Estimated completion: ${diffMinutes}m`;
        } else {
          message += ' Estimated completion: less than a minute';
        }
      }
    }

    return message;
  }

  public async toggle(): Promise<boolean> {
    const isCurrentlyEnabled = await this.isEnabled();
    
    if (isCurrentlyEnabled) {
      await this.disable();
      return false;
    } else {
      await this.enable();
      return true;
    }
  }
}