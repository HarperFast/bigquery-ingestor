// ============================================================================
// Harper BigQuery Sync Component - Production Implementation
// Learn more: https://harperdb.io | https://docs.harperdb.io
// Deploy easily on Fabric: https://fabric.harper.fast
// ============================================================================

// File: resources.js
// Component entry point with resource definitions

import { tables, Resource, server, logger } from 'harper';
import { globals } from './globals.js';

// Main data table resource
export class VesselMetadata extends tables.VesselMetadata {
	static async get(target, context) {
		logger.debug(`[VesselMetadata.get] Fetching record with id: ${target}`);
		const result = await super.get(target, context);
		logger.debug(`[VesselMetadata.get] Record ${result ? 'found' : 'not found'}`);
		return result;
	}

	static async search(params, context) {
		// This allows us to search on dynamic attributes.
		params.allowConditionsOnDynamicAttributes = true;
		logger.debug(`[VesselMetadata.search] Searching with params: ${JSON.stringify(params).substring(0, 200)}`);
		const results = await super.search(params, context);
		logger.info(`[VesselMetadata.search] Search returned ${results?.length} records`);
		return results;
	}
}

// Main data table resource
export class VesselPositions extends tables.VesselPositions {
	static async get(target, context) {
		logger.debug(`[VesselPositions.get] Fetching record with id: ${target}`);
		const result = await super.get(target, context);
		logger.debug(`[VesselPositions.get] Record ${result ? 'found' : 'not found'}`);
		return result;
	}

	static async search(params, context) {
		// This allows us to search on dynamic attributes.
		params.allowConditionsOnDynamicAttributes = true;
		logger.debug(`[VesselPositions.search] Searching with params: ${JSON.stringify(params).substring(0, 200)}`);
		const results = await super.search(params, context);
		logger.info(`[VesselPositions.search] Search returned ${results?.length} records`);
		return results;
	}
}

// Main data table resource
export class PortEvents extends tables.PortEvents {
	static async get(target, context) {
		logger.debug(`[PortEvents.get] Fetching record with id: ${target}`);
		const result = await super.get(target, context);
		logger.debug(`[PortEvents.get] Record ${result ? 'found' : 'not found'}`);
		return result;
	}

	static async search(params, context) {
		// This allows us to search on dynamic attributes.
		params.allowConditionsOnDynamicAttributes = true;
		logger.debug(`[PortEvents.search] Searching with params: ${JSON.stringify(params).substring(0, 200)}`);
		const results = await super.search(params, context);
		logger.info(`[PortEvents.search] Search returned ${results?.length} records`);
		return results;
	}
}

// Checkpoint resource
export class SyncCheckpoint extends tables.SyncCheckpoint {
	static async getForNode(nodeId) {
		logger.debug(`[SyncCheckpoint.getForNode] Fetching checkpoint for nodeId: ${nodeId}`);
		const checkpoint = await super.get(nodeId);
		logger.debug(`[SyncCheckpoint.getForNode] Checkpoint ${checkpoint ? 'found' : 'not found'}`);
		return checkpoint;
	}

	static async updateCheckpoint(nodeId, data) {
		logger.info(`[SyncCheckpoint.updateCheckpoint] Updating checkpoint for nodeId: ${nodeId}`);
		logger.debug(`[SyncCheckpoint.updateCheckpoint] Data: ${JSON.stringify(data).substring(0, 200)}`);
		const result = await super.put({ nodeId, ...data });
		logger.info(`[SyncCheckpoint.updateCheckpoint] Checkpoint updated successfully`);
		return result;
	}
}

// Audit resource
export class SyncAudit extends tables.SyncAudit {
	static async getRecent(hours = 24) {
		logger.debug(`[SyncAudit.getRecent] Fetching audit records from last ${hours} hours`);
		const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
		logger.debug(`[SyncAudit.getRecent] Cutoff timestamp: ${cutoff}`);
		const results = await super.search({
			conditions: [{ timestamp: { $gt: cutoff } }],
			orderBy: 'timestamp DESC',
		});
		logger.info(`[SyncAudit.getRecent] Retrieved ${results.length} audit records`);
		return results;
	}
}

// Control endpoint
export class SyncControl extends Resource {
	static async get(_target, _context) {
		logger.debug('[SyncControl.get] Status request received');

		const STATE_ID = 'sync-control';
		const globalState = await tables.SyncControlState.get(STATE_ID);
		const controlManager = globals.get('controlManager');

		// Handle case where controlManager not yet initialized (during startup)
		if (!controlManager) {
			logger.warn('[SyncControl.get] SyncControlManager not initialized yet');
			return {
				global: globalState || { command: 'unknown', version: 0 },
				worker: {
					nodeId: `${server.hostname}-${server.workerIndex}`,
					running: false,
					tables: [],
					failedEngines: [],
					status: 'initializing',
				},
				uptime: process.uptime(),
				version: '2.0.0',
			};
		}

		const workerStatus = controlManager.getStatus();

		const response = {
			global: globalState || { command: 'unknown', version: 0 },
			worker: {
				nodeId: `${server.hostname}-${server.workerIndex}`,
				running: workerStatus.currentState === 'start',
				tables: workerStatus.engines,
				failedEngines: workerStatus.failedEngines,
			},
			uptime: process.uptime(),
			version: '2.0.0',
		};

		logger.info(`[SyncControl.get] Status: ${globalState?.command} (v${globalState?.version})`);
		return response;
	}

	static async post(_target, data, _context) {
		const { action } = await data;
		logger.info(`[SyncControl.post] Control action received: ${action}`);

		const STATE_ID = 'sync-control';

		// Validate action
		if (!['start', 'stop', 'validate'].includes(action)) {
			throw new Error(`Unknown action: ${action}`);
		}

		// Check if controlManager is initialized (optional warning)
		const controlManager = globals.get('controlManager');
		if (!controlManager) {
			logger.warn(
				'[SyncControl.post] SyncControlManager not initialized on this worker yet. Command will be processed once initialization completes.'
			);
		}

		// Atomically increment version using a conditional-put retry loop to prevent
		// concurrent POSTs from computing the same nextVersion (TOCTOU race).
		let nextVersion;
		const MAX_RETRIES = 5;
		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			const current = await tables.SyncControlState.get(STATE_ID);
			const expectedVersion = current?.version || 0;
			nextVersion = expectedVersion + 1;

			try {
				await tables.SyncControlState.put(
					{
						id: STATE_ID,
						command: action,
						commandedAt: new Date().toISOString(),
						commandedBy: `${server.hostname}-${server.workerIndex}`,
						version: nextVersion,
					},
					{ ifVersion: expectedVersion }
				);
				break; // Write succeeded — exit retry loop
			} catch (err) {
				if (attempt < MAX_RETRIES - 1 && err?.code === 'VERSION_CONFLICT') {
					logger.warn(`[SyncControl.post] Version conflict on attempt ${attempt + 1}, retrying`);
					continue;
				}
				throw err;
			}
		}

		logger.info(`[SyncControl.post] Command '${action}' issued (v${nextVersion})`);

		return {
			message: `${action} command issued to cluster`,
			version: nextVersion,
		};
	}
}
