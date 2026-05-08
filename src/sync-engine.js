// ============================================================================
// File: sync-engine.js
// Core synchronization engine with modulo-based partitioning

import { tables, logger, server, transaction } from 'harper';

import { createHash } from 'crypto';
import { BigQueryClient } from './bigquery-client.js';
import { globals as _globals } from './globals.js';
import { convertBigQueryTypes } from './type-converter.js';

export class SyncEngine {
	constructor(config) {
		logger.info('[SyncEngine] Constructor called - initializing sync engine');

		logger.info('Hostname: ' + server.hostname);
		logger.info('Worker Id: ' + server.workerIndex);
		logger.info('Worker Count: ' + (server.workerCount || 1));

		this.initialized = false;
		this.config = config;

		// Multi-table support: tableId and targetTable
		this.tableId = config.tableId || 'default';
		this.targetTable = config.targetTable || 'VesselPositions';
		this.timestampColumn = config.bigquery?.timestampColumn || config.timestampColumn || 'timestamp';

		// Composite checkpoint ID: {tableId}_{nodeId}
		// Will be set after cluster discovery determines nodeId
		this.checkpointId = null;

		this.client = new BigQueryClient(this.config);
		this.running = false;
		this.nodeId = null;
		this.clusterSize = null;
		this.currentPhase = 'initial';
		this.lastCheckpoint = null;
		this.pollTimer = null;

		logger.info(`[SyncEngine] Multi-table config - tableId: ${this.tableId}, targetTable: ${this.targetTable}`);
		logger.debug('[SyncEngine] Constructor complete - initial state set');
	}

	async initialize() {
		if (!this.initialized) {
			logger.info('[SyncEngine.initialize] Starting initialization process');

			// Discover cluster topology using Harper's native clustering
			logger.debug('[SyncEngine.initialize] Discovering cluster topology');
			const clusterInfo = await this.discoverCluster();
			logger.debug(clusterInfo);
			this.nodeId = clusterInfo.nodeId;
			this.clusterSize = clusterInfo.clusterSize;

			// Set composite checkpoint ID: {tableId}_{nodeId}
			this.checkpointId = `${this.tableId}_${this.nodeId}`;

			logger.info(
				`[SyncEngine.initialize] Node initialized: ID=${this.nodeId}, ClusterSize=${this.clusterSize}, CheckpointID=${this.checkpointId}`
			);

			// Load last checkpoint
			logger.debug('[SyncEngine.initialize] Loading checkpoint from database');
			this.lastCheckpoint = await this.loadCheckpoint();

			if (this.lastCheckpoint) {
				this.currentPhase = this.lastCheckpoint.phase || 'initial';
				logger.info(
					`[SyncEngine.initialize] Resuming from checkpoint: ${this.lastCheckpoint.lastTimestamp}, phase: ${this.currentPhase}`
				);
			} else {
				logger.info('[SyncEngine.initialize] No checkpoint found - starting fresh');
				// First run - start from beginning or configurable start time
				// Store as ISO string - matches BigQuery TIMESTAMP() parameter format
				const startTimestampString = this.config.sync.startTimestamp || '1970-01-01T00:00:00Z';

				// Validate it's parseable
				const testDate = new Date(startTimestampString);
				if (Number.isNaN(testDate.getTime())) {
					throw new Error(`Invalid startTimestamp in config: ${startTimestampString}`);
				}

				this.lastCheckpoint = {
					checkpointId: this.checkpointId,
					tableId: this.tableId,
					nodeId: this.nodeId,
					lastTimestamp: startTimestampString,
					recordsIngested: 0,
					phase: 'initial',
				};
				logger.debug(`[SyncEngine.initialize] Created new checkpoint starting at ${this.lastCheckpoint.lastTimestamp}`);
			}
			logger.info('[SyncEngine.initialize] Initialization complete');
			this.initialized = true;
		} else {
			logger.info('[SyncEngine.initialize] Object already initialized');
		}
	}

	async discoverCluster() {
		logger.debug('[SyncEngine.discoverCluster] Querying Harper cluster API');
		const currentNodeId = [server.hostname, server.workerIndex].join('-');
		logger.info(`[SyncEngine.discoverCluster] Current node ID: ${currentNodeId}`);
		logger.info(`[SyncEngine.discoverCluster] server.hostname: ${server.hostname}`);
		logger.info(`[SyncEngine.discoverCluster] server.workerIndex: ${server.workerIndex}`);
		logger.info(`[SyncEngine.discoverCluster] server.workerCount: ${server.workerCount}`);
		logger.info(
			`[SyncEngine.discoverCluster] server.nodes: ${server.nodes ? JSON.stringify(server.nodes) : 'undefined'}`
		);

		let nodes = [];
		const workerCount = server.workerCount || 1;

		// Check if running in a multi-node cluster
		if (server.nodes && Array.isArray(server.nodes) && server.nodes.length > 0) {
			// Multi-node cluster: enumerate all nodes and their workers
			logger.info(
				`[SyncEngine.discoverCluster] Multi-node cluster: ${server.nodes.length} other nodes, ${workerCount} workers per node`
			);

			// IMPORTANT: server.nodes only contains OTHER nodes, not the current node
			// We must add the current node to the list

			// Add current node first
			for (let i = 0; i < workerCount; i++) {
				nodes.push(`${server.hostname}-${i}`);
			}

			// Add other cluster nodes from server.nodes
			for (const node of server.nodes) {
				const hostname = node.name || node.hostname || node.host || node.id;

				if (!hostname) {
					logger.warn(`[SyncEngine.discoverCluster] Node missing name property: ${JSON.stringify(node)}`);
					continue;
				}

				for (let i = 0; i < workerCount; i++) {
					nodes.push(`${hostname}-${i}`);
				}
			}
			logger.info(
				`[SyncEngine.discoverCluster] Total cluster size: ${nodes.length} workers across ${server.nodes.length + 1} nodes`
			);
		} else {
			// Single node: generate workers for current node only
			logger.info(`[SyncEngine.discoverCluster] Single node with ${workerCount} workers`);

			for (let i = 0; i < workerCount; i++) {
				nodes.push(`${server.hostname}-${i}`);
			}
		}

		// Sort deterministically (lexicographic)
		nodes.sort();
		logger.info(`[SyncEngine.discoverCluster] Sorted nodes: ${nodes.join(', ')}`);

		// Find our position
		const nodeIndex = nodes.findIndex((n) => n === currentNodeId);

		if (nodeIndex === -1) {
			logger.error(
				`[SyncEngine.discoverCluster] Current node '${currentNodeId}' not found in cluster nodes: ${nodes.join(', ')}`
			);
			throw new Error(`Current node ${currentNodeId} not found in cluster`);
		}

		logger.info(
			`[SyncEngine.discoverCluster] Node position determined: index=${nodeIndex}, clusterSize=${nodes.length}`
		);
		return {
			nodeId: nodeIndex,
			clusterSize: nodes.length,
			nodes: nodes,
		};
	}

	async loadCheckpoint() {
		logger.debug(`[SyncEngine.loadCheckpoint] Attempting to load checkpoint for checkpointId=${this.checkpointId}`);
		try {
			const checkpoint = await tables.SyncCheckpoint.get(this.checkpointId);
			logger.debug(`[SyncEngine.loadCheckpoint] Checkpoint found: ${JSON.stringify(checkpoint)}`);

			// Validate that lastTimestamp is a valid ISO string
			if (checkpoint && checkpoint.lastTimestamp) {
				const testDate = new Date(checkpoint.lastTimestamp);
				if (Number.isNaN(testDate.getTime())) {
					logger.error(
						`[SyncEngine.loadCheckpoint] Checkpoint contains invalid timestamp: ${checkpoint.lastTimestamp} - deleting corrupted checkpoint`
					);
					await tables.SyncCheckpoint.delete(this.checkpointId);
					return null;
				}
			}

			return checkpoint;
		} catch (error) {
			// If checkpoint not found, return null; otherwise log and rethrow so callers can handle it.
			if (error && (error.code === 'NOT_FOUND' || /not\s*found/i.test(error.message || ''))) {
				logger.debug('[SyncEngine.loadCheckpoint] No checkpoint found in database (first run)');
				return null;
			}
			logger.error(`[SyncEngine.loadCheckpoint] Error loading checkpoint: ${error.message}`, error);
			throw error;
		}
	}

	async start() {
		logger.info('[SyncEngine.start] Start method called');
		if (this.running) {
			logger.warn('[SyncEngine.start] Sync already running - ignoring duplicate start request');
			return;
		}

		this.running = true;
		logger.info('[SyncEngine.start] Starting sync loop');
		this.schedulePoll();
		logger.debug('[SyncEngine.start] First poll scheduled');
	}

	async stop() {
		logger.info('[SyncEngine.stop] Stop method called');
		this.running = false;
		if (this.pollTimer) {
			logger.debug('[SyncEngine.stop] Clearing poll timer');
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}
		logger.info('[SyncEngine.stop] Sync stopped');
	}

	schedulePoll() {
		if (!this.running) {
			logger.debug('[SyncEngine.schedulePoll] Not running - skipping poll schedule');
			return;
		}

		const interval = this.calculatePollInterval();
		logger.debug(`[SyncEngine.schedulePoll] Scheduling next poll in ${interval}ms (phase: ${this.currentPhase})`);
		this.pollTimer = setTimeout(() => this.runSyncCycle(), interval);
	}

	calculatePollInterval() {
		logger.debug(`[SyncEngine.calculatePollInterval] Calculating interval for phase: ${this.currentPhase}`);
		// Adaptive polling based on phase
		let interval;
		switch (this.currentPhase) {
			case 'initial':
				interval = 1000; // 1 second - aggressive catch-up
				break;
			case 'catchup':
				interval = 5000; // 5 seconds
				break;
			case 'steady':
				interval = this.config.sync.pollInterval || 30000; // 30 seconds
				break;
			default:
				interval = 10000;
		}
		logger.debug(`[SyncEngine.calculatePollInterval] Interval calculated: ${interval}ms`);
		return interval;
	}

	async runSyncCycle() {
		logger.info(`[SyncEngine.runSyncCycle] Starting sync cycle for node ${this.nodeId}, phase: ${this.currentPhase}`);
		try {
			const batchSize = this.calculateBatchSize();
			logger.debug(`[SyncEngine.runSyncCycle] Batch size: ${batchSize}`);

			// Pull records for this node's partition
			logger.info(
				`[SyncEngine.runSyncCycle] Pulling partition data from BigQuery - nodeId: ${this.nodeId}, clusterSize: ${this.clusterSize}, lastTimestamp: ${this.lastCheckpoint.lastTimestamp}, batchSize: ${batchSize}`
			);
			const records = await this.client.pullPartition({
				nodeId: this.nodeId,
				clusterSize: this.clusterSize,
				lastTimestamp: this.lastCheckpoint.lastTimestamp,
				batchSize,
			});
			logger.info(`[SyncEngine.runSyncCycle] Received ${records.length} records from BigQuery`);

			if (records.length === 0) {
				logger.info(`[SyncEngine.runSyncCycle] No new records found - transitioning to steady state`);
				this.currentPhase = 'steady';
			} else {
				// Write to Harper
				logger.debug(`[SyncEngine.runSyncCycle] Ingesting ${records.length} records into Harper`);
				await this.ingestRecords(records);
				logger.debug('[SyncEngine.runSyncCycle] Ingest complete');

				// Update checkpoint
				logger.debug('[SyncEngine.runSyncCycle] Updating checkpoint');
				await this.updateCheckpoint(records);
				logger.debug('[SyncEngine.runSyncCycle] Checkpoint updated');

				// Update phase based on lag
				logger.debug('[SyncEngine.runSyncCycle] Updating phase based on lag');
				await this.updatePhase();
				logger.debug(`[SyncEngine.runSyncCycle] Phase after update: ${this.currentPhase}`);
			}

			logger.info(`[SyncEngine.runSyncCycle] Sync cycle complete`);
		} catch (error) {
			logger.error(`[SyncEngine.runSyncCycle] Sync cycle error: ${error.message}`, error);
			// Continue despite errors - don't crash the component
		} finally {
			// Schedule next poll
			logger.debug('[SyncEngine.runSyncCycle] Scheduling next poll');
			this.schedulePoll();
		}
	}

	calculateBatchSize() {
		logger.debug(`[SyncEngine.calculateBatchSize] Calculating batch size for phase: ${this.currentPhase}`);
		let batchSize;
		switch (this.currentPhase) {
			case 'initial':
				batchSize = this.config.sync.initialBatchSize || 10000;
				break;
			case 'catchup':
				batchSize = this.config.sync.catchupBatchSize || 1000;
				break;
			case 'steady':
				batchSize = this.config.sync.steadyBatchSize || 500;
				break;
			default:
				batchSize = 1000;
		}
		logger.debug(`[SyncEngine.calculateBatchSize] Batch size: ${batchSize}`);
		return batchSize;
	}

	async ingestRecords(records) {
		logger.trace(`[SyncEngine.ingestRecords] Processing records: ${JSON.stringify(records)} records for ingestion`);
		logger.debug(`[SyncEngine.ingestRecords] Processing ${records.length} records for ingestion`);
		const validRecords = [];
		const timestampColumn = this.config.bigquery.timestampColumn;

		for (const record of records) {
			try {
				// Log first raw record from BigQuery to see structure
				if (validRecords.length === 0) {
					logger.info(`[SyncEngine.ingestRecords] First raw BigQuery record keys: ${Object.keys(record).join(', ')}`);
					logger.info(
						`[SyncEngine.ingestRecords] First raw BigQuery record sample: ${JSON.stringify(record).substring(0, 200)}`
					);
				}

				// Convert BigQuery types to JavaScript primitives using type-converter utility
				const convertedRecord = convertBigQueryTypes(record);

				// Log first converted record
				if (validRecords.length === 0) {
					logger.info(
						`[SyncEngine.ingestRecords] First converted record keys: ${Object.keys(convertedRecord).join(', ')}`
					);
					logger.info(
						`[SyncEngine.ingestRecords] First converted record sample: ${JSON.stringify(convertedRecord).substring(0, 200)}`
					);
				}

				logger.trace(`[SyncEngine.ingestRecords] Converted record: ${JSON.stringify(convertedRecord)}`);

				// Validate timestamp exists
				if (!convertedRecord[timestampColumn]) {
					logger.warn(
						`[SyncEngine.ingestRecords] Missing timestamp column '${timestampColumn}', skipping record: ${JSON.stringify(convertedRecord).substring(0, 100)}`
					);
					await this.logSkippedRecord(convertedRecord, `missing_${timestampColumn}`);
					continue;
				}

				// Generate deterministic ID for indexing
				// Use hash of timestamp + deterministic fields for uniqueness
				const timestamp = convertedRecord[timestampColumn];
				const hashInput = `${timestamp}-${JSON.stringify(convertedRecord)}`;
				const hash = createHash('sha256').update(hashInput).digest();
				// Convert first 8 bytes of hash to positive integer within safe range
				const bigIntId = hash.readBigInt64BE(0);
				const numericId = Number(bigIntId < 0n ? -bigIntId : bigIntId) % Number.MAX_SAFE_INTEGER;
				// Convert to string as required by Harper
				const id = String(numericId);

				// Store BigQuery record with string ID
				const mappedRecord = {
					id, // String primary key (required by Harper)
					...convertedRecord, // All BigQuery fields at top level
					_syncedAt: new Date(), // Add sync timestamp
				};

				// Log first mapped record to see what's being written to Harper
				if (validRecords.length === 0) {
					logger.info(`[SyncEngine.ingestRecords] First mapped record keys: ${Object.keys(mappedRecord).join(', ')}`);
					logger.info(
						`[SyncEngine.ingestRecords] First mapped record sample: ${JSON.stringify(mappedRecord).substring(0, 200)}`
					);
				}

				validRecords.push(mappedRecord);
			} catch (error) {
				logger.error(`[SyncEngine.ingestRecords] Error processing record: ${error.message}`, error);
				logger.error(`[SyncEngine.ingestRecords] Error stack: ${error.stack}`);
				await this.logSkippedRecord(record, `processing_error: ${error.message}`);
			}
		}

		logger.info(`[SyncEngine.ingestRecords] Validated ${validRecords.length}/${records.length} records`);

		// Batch write to Harper
		if (validRecords.length > 0) {
			logger.info(
				`[SyncEngine.ingestRecords] Writing ${validRecords.length} records to Harper table: ${this.targetTable}`
			);

			let _lastResult;
			transaction((_txn) => {
				try {
					// Dynamic table access for multi-table support
					const targetTableObj = tables[this.targetTable];
					if (!targetTableObj) {
						throw new Error(`Target table '${this.targetTable}' not found in schema`);
					}

					for (const rec of validRecords) {
						// Use put (upsert) instead of create to handle duplicate IDs gracefully
						_lastResult = targetTableObj.put(rec);
					}
				} catch (error) {
					logger.error(`[SyncEngine.ingestRecords] Harper put failed: ${error.message}`, error);
					if (error.errors) {
						error.errors.forEach((e) => logger.error(`  ${e.reason} at ${e.location}: ${e.message}`));
					}
				}
			});
			logger.info(`[SyncEngine.ingestRecords] Successfully wrote ${validRecords.length} records`);
		} else {
			logger.warn('[SyncEngine.ingestRecords] No valid records to write');
		}
	}

	async updateCheckpoint(records) {
		logger.debug(`[SyncEngine.updateCheckpoint] Updating checkpoint with ${records.length} records`);
		const lastRecord = records.at(-1);
		const timestampColumn = this.config.bigquery.timestampColumn;
		const lastTimestamp = lastRecord[timestampColumn];

		if (!lastTimestamp) {
			logger.error(`[SyncEngine.updateCheckpoint] Last record missing timestamp column '${timestampColumn}'`);
			throw new Error(`Missing timestamp column in last record: ${timestampColumn}`);
		}

		// Extract ISO string for BigQuery TIMESTAMP() parameter
		// BigQuery returns various timestamp types - extract the ISO string representation
		let lastTimestampString;

		if (typeof lastTimestamp === 'string') {
			// Already a string, use as-is
			lastTimestampString = lastTimestamp;
		} else if (lastTimestamp instanceof Date) {
			// JavaScript Date object - convert to ISO
			lastTimestampString = lastTimestamp.toISOString();
		} else if (lastTimestamp && typeof lastTimestamp === 'object') {
			// BigQuery timestamp object - try .value or .toJSON()
			if (lastTimestamp.value) {
				lastTimestampString = lastTimestamp.value;
			} else if (typeof lastTimestamp.toJSON === 'function') {
				lastTimestampString = lastTimestamp.toJSON();
			} else {
				// Last resort - try to stringify
				lastTimestampString = String(lastTimestamp);
			}
		} else {
			lastTimestampString = String(lastTimestamp);
		}

		// Validate it's a parseable timestamp
		const testDate = new Date(lastTimestampString);
		if (Number.isNaN(testDate.getTime())) {
			logger.error(
				`[SyncEngine.updateCheckpoint] Invalid timestamp value: ${lastTimestamp} (type: ${typeof lastTimestamp})`
			);
			throw new Error(`Invalid timestamp in last record: ${lastTimestampString}`);
		}

		logger.debug(`[SyncEngine.updateCheckpoint] Last record timestamp: ${lastTimestampString}`);

		// Store ISO string - matches BigQuery TIMESTAMP() parameter format
		this.lastCheckpoint = {
			checkpointId: this.checkpointId,
			tableId: this.tableId,
			nodeId: this.nodeId,
			lastTimestamp: lastTimestampString,
			recordsIngested: this.lastCheckpoint.recordsIngested + records.length,
			lastSyncTime: new Date().toISOString(),
			phase: this.currentPhase,
			batchSize: this.calculateBatchSize(),
		};

		logger.debug(`[SyncEngine.updateCheckpoint] New checkpoint: ${JSON.stringify(this.lastCheckpoint)}`);
		await tables.SyncCheckpoint.put(this.lastCheckpoint);
		logger.info(
			`[SyncEngine.updateCheckpoint] Checkpoint saved - total records ingested: ${this.lastCheckpoint.recordsIngested}`
		);
	}

	async updatePhase() {
		logger.debug('[SyncEngine.updatePhase] Calculating sync lag and updating phase');
		// Calculate lag in seconds
		const now = Date.now();
		const lastTimestamp = new Date(this.lastCheckpoint.lastTimestamp).getTime();
		const lagSeconds = (now - lastTimestamp) / 1000;

		logger.debug(`[SyncEngine.updatePhase] Current lag: ${lagSeconds.toFixed(2)} seconds`);
		const oldPhase = this.currentPhase;

		// Update phase based on lag thresholds
		if (lagSeconds > (this.config.sync.catchupThreshold || 3600)) {
			this.currentPhase = 'initial';
		} else if (lagSeconds > (this.config.sync.steadyThreshold || 300)) {
			this.currentPhase = 'catchup';
		} else {
			this.currentPhase = 'steady';
		}

		if (oldPhase !== this.currentPhase) {
			logger.info(
				`[SyncEngine.updatePhase] Phase transition: ${oldPhase} -> ${this.currentPhase} (lag: ${lagSeconds.toFixed(2)}s)`
			);
		} else {
			logger.debug(`[SyncEngine.updatePhase] Phase unchanged: ${this.currentPhase}`);
		}
	}

	async logSkippedRecord(record, reason) {
		logger.warn(`[SyncEngine.logSkippedRecord] Logging skipped record - reason: ${reason}`);
		// Log to audit table for monitoring
		const auditEntry = {
			id: `skip-${Date.now()}-${Math.random()}`,
			timestamp: new Date().toISOString(),
			nodeId: this.nodeId,
			status: 'skipped',
			reason,
			recordSample: JSON.stringify(record).substring(0, 500),
		};
		logger.debug(`[SyncEngine.logSkippedRecord] Audit entry: ${JSON.stringify(auditEntry)}`);
		await tables.SyncAudit.put(auditEntry);
		logger.debug('[SyncEngine.logSkippedRecord] Skipped record logged to audit table');
	}

	async getStatus() {
		logger.debug('[SyncEngine.getStatus] Status requested');
		const status = {
			nodeId: this.nodeId,
			clusterSize: this.clusterSize,
			running: this.running,
			phase: this.currentPhase,
			lastCheckpoint: this.lastCheckpoint,
		};
		logger.debug(`[SyncEngine.getStatus] Returning status: ${JSON.stringify(status)}`);
		return status;
	}
}

// Export additional classes for use in resources.js
export { BigQueryClient } from './bigquery-client.js';
