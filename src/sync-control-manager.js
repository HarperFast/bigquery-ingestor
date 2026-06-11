// ============================================================================
// File: sync-control-manager.js
// Manages cluster-wide sync control via replicated state table
// ============================================================================

import { logger, tables } from 'harper';
import { globals } from './globals.js';

export class SyncControlManager {
	constructor(syncEngines) {
		logger.info('[SyncControlManager] Constructor called');
		this.syncEngines = syncEngines;
		this.lastProcessedVersion = 0;
		this.currentState = 'stopped';
		this.isProcessing = false;
		this.subscription = null;
		this.failedEngines = [];
		logger.info(`[SyncControlManager] Initialized with ${syncEngines.length} engines`);
	}

	async initialize() {
		logger.info('[SyncControlManager.initialize] Starting initialization');
		const STATE_ID = 'sync-control';

		// Load current state from table
		const currentState = await tables.SyncControlState.get(STATE_ID);

		if (currentState) {
			logger.info(
				`[SyncControlManager.initialize] Found existing state: ${currentState.command} (v${currentState.version})`
			);
			this.lastProcessedVersion = currentState.version;
			// Apply current state to engines
			await this.processCommand(currentState);
		} else {
			// Initialize state on first run
			logger.info('[SyncControlManager.initialize] No state found, initializing to stopped');
			await tables.SyncControlState.put({
				id: STATE_ID,
				command: 'stop',
				commandedAt: new Date(),
				commandedBy: 'system-init',
				version: 0,
			});
		}

		// Subscribe to future changes
		logger.info('[SyncControlManager.initialize] Setting up subscription');
		this.subscription = await tables.SyncControlState.subscribe({ id: STATE_ID });
		this.startSubscriptionLoop().catch((err) =>
			logger.error('[SyncControlManager] startSubscriptionLoop rejected unexpectedly', err)
		);

		logger.info('[SyncControlManager.initialize] Initialization complete');
	}

	async processCommand(state) {
		if (this.isProcessing) {
			logger.debug('[SyncControlManager.processCommand] Already processing, skipping');
			return;
		}

		this.isProcessing = true;

		try {
			logger.info(`[SyncControlManager.processCommand] Processing command: ${state.command}`);

			switch (state.command) {
				case 'start':
					await this.startAllEngines();
					break;
				case 'stop':
					await this.stopAllEngines();
					break;
				case 'validate':
					await this.runValidation();
					break;
				default:
					logger.warn(`[SyncControlManager.processCommand] Unknown command: ${state.command}`);
			}

			this.currentState = state.command;
			logger.info(`[SyncControlManager.processCommand] Command completed: ${state.command}`);
		} catch (error) {
			logger.error('[SyncControlManager.processCommand] Error processing command:', error);
		} finally {
			this.isProcessing = false;
		}
	}

	async startAllEngines() {
		logger.info(`[SyncControlManager.startAllEngines] Starting ${this.syncEngines.length} engines`);

		const results = await Promise.allSettled(this.syncEngines.map((engine) => engine.start()));

		// Track failures for status reporting
		this.failedEngines = results
			.map((result, i) => ({ engine: this.syncEngines[i], result }))
			.filter(({ result }) => result.status === 'rejected')
			.map(({ engine, result }) => ({
				tableId: engine.tableId,
				error: result.reason?.message || String(result.reason),
			}));

		if (this.failedEngines.length > 0) {
			logger.error(
				`[SyncControlManager.startAllEngines] ${this.failedEngines.length} engines failed to start:`,
				this.failedEngines
			);
		}

		const successCount = this.syncEngines.length - this.failedEngines.length;
		logger.info(`[SyncControlManager.startAllEngines] Started ${successCount}/${this.syncEngines.length} engines`);
	}

	async stopAllEngines() {
		logger.info(`[SyncControlManager.stopAllEngines] Stopping ${this.syncEngines.length} engines`);

		await Promise.allSettled(this.syncEngines.map((engine) => engine.stop()));

		this.failedEngines = []; // Clear failures on stop
		logger.info('[SyncControlManager.stopAllEngines] All engines stopped');
	}

	async runValidation() {
		logger.info('[SyncControlManager.runValidation] Running validation');
		const validator = globals.get('validator');

		if (validator) {
			await validator.runValidation();
			logger.info('[SyncControlManager.runValidation] Validation completed');
		} else {
			logger.warn('[SyncControlManager.runValidation] Validator not available');
		}
	}

	async startSubscriptionLoop() {
		logger.info('[SyncControlManager.startSubscriptionLoop] Starting subscription loop');

		const STATE_ID = 'sync-control';

		try {
			for await (const _update of this.subscription) {
				// Subscription event received - fetch the actual record
				const state = await tables.SyncControlState.get(STATE_ID);

				if (!state) {
					logger.warn('[SyncControlManager.startSubscriptionLoop] State record not found after update');
					continue;
				}

				logger.info(`[SyncControlManager.startSubscriptionLoop] Received update: ${state.command} (v${state.version})`);

				// Only process if version is newer
				if (state.version > this.lastProcessedVersion) {
					await this.processCommand(state);
					this.lastProcessedVersion = state.version;
				} else {
					logger.debug(
						`[SyncControlManager.startSubscriptionLoop] Skipping old version ${state.version} (last: ${this.lastProcessedVersion})`
					);
				}
			}
		} catch (error) {
			logger.error('[SyncControlManager.startSubscriptionLoop] Subscription failed, restarting in 5s:', error);
			setTimeout(() => this.initialize(), 5000);
		}
	}

	getStatus() {
		return {
			currentState: this.currentState,
			lastProcessedVersion: this.lastProcessedVersion,
			engines: this.syncEngines.map((engine) => ({
				tableId: engine.tableId,
				running: engine.running,
				phase: engine.currentPhase,
			})),
			failedEngines: this.failedEngines,
			isProcessing: this.isProcessing,
		};
	}
}
