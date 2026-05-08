// ============================================================================
// File: validation.js
// Validation service for data integrity checks
// NOTE: Avoids count-based validation since Harper counts are estimates

import { server, tables, logger } from 'harper';

import { BigQueryClient } from './bigquery-client.js';
import { createHash } from 'node:crypto';

export class ValidationService {
	constructor(config) {
		this.config = config;
		logger.info('[ValidationService] Constructor called - initializing validation service');

		// For multi-table support, store table-specific configs
		this.tables = config.bigquery?.tables || [];

		// Create BigQueryClient for each table
		this.bigqueryClients = new Map();
		if (this.tables.length > 0) {
			for (const tableConfig of this.tables) {
				const clientConfig = {
					bigquery: {
						projectId: config.bigquery.projectId,
						dataset: tableConfig.dataset,
						table: tableConfig.table,
						timestampColumn: tableConfig.timestampColumn,
						columns: tableConfig.columns,
						credentials: config.bigquery.credentials,
						location: config.bigquery.location,
					},
				};
				this.bigqueryClients.set(tableConfig.id, {
					client: new BigQueryClient(clientConfig),
					targetTable: tableConfig.targetTable,
					timestampColumn: tableConfig.timestampColumn,
				});
				logger.debug(`[ValidationService] BigQuery client initialized for table: ${tableConfig.id}`);
			}
		}

		logger.info(`[ValidationService] Validation service initialized for ${this.tables.length} tables`);
	}

	async runValidation() {
		logger.info('[ValidationService.runValidation] Starting validation suite');

		const results = {
			timestamp: new Date().toISOString(),
			tables: {},
		};

		try {
			// Validate each table independently
			for (const tableConfig of this.tables) {
				logger.info(`[ValidationService.runValidation] Validating table: ${tableConfig.id}`);

				results.tables[tableConfig.id] = {
					checks: {},
				};

				// 1. Checkpoint progress monitoring
				logger.debug(`[ValidationService.runValidation] Running checkpoint progress validation for ${tableConfig.id}`);
				results.tables[tableConfig.id].checks.progress = await this.validateProgress(tableConfig.id);
				logger.info(
					`[ValidationService.runValidation] Progress check for ${tableConfig.id}: ${results.tables[tableConfig.id].checks.progress.status}`
				);

				// 2. Smoke test - can we query recent data?
				logger.debug(`[ValidationService.runValidation] Running smoke test for ${tableConfig.id}`);
				results.tables[tableConfig.id].checks.smokeTest = await this.smokeTest(
					tableConfig.id,
					tableConfig.targetTable,
					tableConfig.timestampColumn
				);
				logger.info(
					`[ValidationService.runValidation] Smoke test for ${tableConfig.id}: ${results.tables[tableConfig.id].checks.smokeTest.status}`
				);

				// 3. Spot check random records
				logger.debug(`[ValidationService.runValidation] Running spot check for ${tableConfig.id}`);
				results.tables[tableConfig.id].checks.spotCheck = await this.spotCheckRecords(tableConfig.id);
				logger.info(
					`[ValidationService.runValidation] Spot check for ${tableConfig.id}: ${results.tables[tableConfig.id].checks.spotCheck.status}`
				);

				// Determine per-table status
				const tableChecks = results.tables[tableConfig.id].checks;
				const tableHealthy = Object.values(tableChecks).every(
					(check) => check.status === 'healthy' || check.status === 'ok'
				);
				results.tables[tableConfig.id].overallStatus = tableHealthy ? 'healthy' : 'issues_detected';
			}

			// Determine overall status across all tables
			const allTablesHealthy = Object.values(results.tables).every((table) => table.overallStatus === 'healthy');

			results.overallStatus = allTablesHealthy ? 'healthy' : 'issues_detected';
			logger.info(`[ValidationService.runValidation] Overall validation status: ${results.overallStatus}`);

			// Log to audit table
			logger.debug('[ValidationService.runValidation] Logging validation results to audit table');
			await this.logAudit(results);

			return results;
		} catch (error) {
			logger.error(`[ValidationService.runValidation] Validation failed: ${error.message}`, error);
			results.overallStatus = 'error';
			results.error = error.message;
			await this.logAudit(results);
			throw error;
		}
	}

	async validateProgress(tableId) {
		logger.debug(`[ValidationService.validateProgress] Validating checkpoint progress for table: ${tableId}`);
		const clusterInfo = await this.discoverCluster();
		logger.debug(
			`[ValidationService.validateProgress] Cluster info - nodeId: ${clusterInfo.nodeId}, clusterSize: ${clusterInfo.clusterSize}`
		);

		// Use composite checkpoint ID: {tableId}_{nodeId}
		const checkpointId = `${tableId}_${clusterInfo.nodeId}`;
		logger.debug(`[ValidationService.validateProgress] Looking up checkpoint: ${checkpointId}`);

		const checkpoint = await tables.SyncCheckpoint.get(checkpointId);

		if (!checkpoint) {
			logger.warn(
				`[ValidationService.validateProgress] No checkpoint found for ${tableId} - table may not have started syncing`
			);
			return {
				status: 'no_checkpoint',
				message: `No checkpoint found for table ${tableId} - may not have started`,
				tableId,
			};
		}

		logger.debug(
			`[ValidationService.validateProgress] Checkpoint found for ${tableId} - lastTimestamp: ${checkpoint.lastTimestamp}, recordsIngested: ${checkpoint.recordsIngested}`
		);

		const timeSinceLastSync = Date.now() - new Date(checkpoint.lastSyncTime).getTime();
		const lagSeconds = (Date.now() - new Date(checkpoint.lastTimestamp).getTime()) / 1000;

		logger.debug(
			`[ValidationService.validateProgress] ${tableId} - Time since last sync: ${timeSinceLastSync}ms, lag: ${lagSeconds.toFixed(2)}s`
		);

		// Alert if no progress in 10 minutes
		if (timeSinceLastSync > 600000) {
			logger.warn(
				`[ValidationService.validateProgress] ${tableId} sync appears STALLED - no progress in ${(timeSinceLastSync / 1000 / 60).toFixed(2)} minutes`
			);
			return {
				status: 'stalled',
				message: 'No ingestion progress in 10+ minutes',
				timeSinceLastSync,
				lastTimestamp: checkpoint.lastTimestamp,
				tableId,
			};
		}

		// Check lag
		let lagStatus = 'healthy';
		if (lagSeconds > 3600) lagStatus = 'severely_lagging';
		else if (lagSeconds > 300) lagStatus = 'lagging';

		logger.info(
			`[ValidationService.validateProgress] ${tableId} progress validation complete - status: ${lagStatus}, lag: ${lagSeconds.toFixed(2)}s`
		);

		return {
			status: lagStatus,
			lagSeconds,
			recordsIngested: checkpoint.recordsIngested,
			phase: checkpoint.phase,
			lastTimestamp: checkpoint.lastTimestamp,
			tableId,
		};
	}

	async smokeTest(tableId, targetTable, timestampColumn) {
		logger.debug(`[ValidationService.smokeTest] Running smoke test for table: ${tableId} (${targetTable})`);
		const fiveMinutesAgo = new Date(Date.now() - 300000).toISOString();
		logger.debug(`[ValidationService.smokeTest] Looking for ${targetTable} records after ${fiveMinutesAgo}`);

		try {
			// Can we query recent data from the target Harper table?
			logger.debug(`[ValidationService.smokeTest] Querying ${targetTable} table for recent records`);

			// Dynamic table access
			const targetTableObj = tables[targetTable];
			if (!targetTableObj) {
				logger.error(`[ValidationService.smokeTest] Target table ${targetTable} not found in schema`);
				return {
					status: 'table_not_found',
					message: `Target table ${targetTable} not found`,
					tableId,
				};
			}

			const recentRecords = await targetTableObj.search({
				conditions: [{ [timestampColumn]: { $gt: fiveMinutesAgo } }],
				limit: 1,
				orderBy: `${timestampColumn} DESC`,
			});

			logger.debug(`[ValidationService.smokeTest] ${tableId} - Query returned ${recentRecords.length} records`);

			if (recentRecords.length === 0) {
				logger.warn(`[ValidationService.smokeTest] ${tableId} - No recent data found in last 5 minutes`);
				return {
					status: 'no_recent_data',
					message: 'No records found in last 5 minutes',
					tableId,
				};
			}

			const latestRecord = recentRecords[0];
			const recordLagSeconds = (Date.now() - new Date(latestRecord[timestampColumn]).getTime()) / 1000;

			logger.info(
				`[ValidationService.smokeTest] ${tableId} smoke test passed - latest record is ${Math.round(recordLagSeconds)}s old`
			);

			return {
				status: 'healthy',
				latestTimestamp: latestRecord[timestampColumn],
				lagSeconds: recordLagSeconds,
				message: `Latest record is ${Math.round(recordLagSeconds)}s old`,
				tableId,
			};
		} catch (error) {
			logger.error(`[ValidationService.smokeTest] ${tableId} query failed: ${error.message}`, error);
			return {
				status: 'query_failed',
				message: 'Failed to query Harper',
				error: error.message,
				tableId,
			};
		}
	}

	async spotCheckRecords(tableId) {
		logger.debug(`[ValidationService.spotCheckRecords] Starting spot check validation for table: ${tableId}`);
		const clusterInfo = await this.discoverCluster();
		logger.debug(
			`[ValidationService.spotCheckRecords] ${tableId} - Using nodeId: ${clusterInfo.nodeId}, clusterSize: ${clusterInfo.clusterSize}`
		);
		const issues = [];

		try {
			const clientInfo = this.bigqueryClients.get(tableId);
			if (!clientInfo) {
				logger.error(`[ValidationService.spotCheckRecords] No BigQuery client found for table: ${tableId}`);
				return {
					status: 'config_error',
					message: `No BigQuery client found for table ${tableId}`,
					tableId,
				};
			}

			const { client: bigqueryClient, targetTable, timestampColumn } = clientInfo;

			// Dynamic table access
			const targetTableObj = tables[targetTable];
			if (!targetTableObj) {
				logger.error(`[ValidationService.spotCheckRecords] Target table ${targetTable} not found in schema`);
				return {
					status: 'table_not_found',
					message: `Target table ${targetTable} not found`,
					tableId,
				};
			}

			// Get 5 recent records from Harper
			logger.debug(`[ValidationService.spotCheckRecords] ${tableId} - Fetching 5 recent records from ${targetTable}`);
			const harperSample = await targetTableObj.search({
				limit: 5,
				orderBy: `${timestampColumn} DESC`,
			});

			logger.debug(
				`[ValidationService.spotCheckRecords] ${tableId} - Retrieved ${harperSample.length} records from Harper`
			);

			if (harperSample.length === 0) {
				logger.warn(`[ValidationService.spotCheckRecords] ${tableId} - No records found in Harper for validation`);
				return {
					status: 'no_data',
					message: 'No records in Harper to validate',
					tableId,
				};
			}

			// Verify each exists in BigQuery
			logger.debug(
				`[ValidationService.spotCheckRecords] ${tableId} - Verifying ${harperSample.length} Harper records exist in BigQuery`
			);
			for (const record of harperSample) {
				logger.trace(
					`[ValidationService.spotCheckRecords] ${tableId} - Verifying Harper record: id=${record.id}, ${timestampColumn}=${record[timestampColumn]}`
				);
				const recordWithTimestamp = { ...record, timestamp: record[timestampColumn] };
				const exists = await bigqueryClient.verifyRecord(recordWithTimestamp);
				if (!exists) {
					logger.warn(`[ValidationService.spotCheckRecords] ${tableId} - Phantom record found: ${record.id}`);
					issues.push({
						type: 'phantom_record',
						timestamp: record[timestampColumn],
						id: record.id,
						message: 'Record exists in Harper but not in BigQuery',
						tableId,
					});
				}
			}

			// Reverse check: verify recent BigQuery records exist in Harper
			const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
			logger.debug(
				`[ValidationService.spotCheckRecords] ${tableId} - Fetching recent BigQuery records (after ${oneHourAgo})`
			);
			const bqSample = await bigqueryClient.pullPartition({
				nodeId: clusterInfo.nodeId,
				clusterSize: clusterInfo.clusterSize,
				lastTimestamp: oneHourAgo,
				batchSize: 5,
			});

			logger.debug(
				`[ValidationService.spotCheckRecords] ${tableId} - Retrieved ${bqSample.length} records from BigQuery for reverse check`
			);

			for (const record of bqSample) {
				const id = this.generateRecordId(record, timestampColumn);
				logger.trace(
					`[ValidationService.spotCheckRecords] ${tableId} - Checking if BigQuery record exists in Harper: id=${id}`
				);
				const exists = await targetTableObj.get(id);
				if (!exists) {
					logger.warn(`[ValidationService.spotCheckRecords] ${tableId} - Missing record: ${id}`);
					issues.push({
						type: 'missing_record',
						timestamp: record[timestampColumn],
						id,
						message: 'Record exists in BigQuery but not in Harper',
						tableId,
					});
				}
			}

			const totalChecked = harperSample.length + bqSample.length;
			const status = issues.length === 0 ? 'healthy' : 'issues_found';
			logger.info(
				`[ValidationService.spotCheckRecords] ${tableId} spot check complete - status: ${status}, checked: ${totalChecked} records, issues: ${issues.length}`
			);

			return {
				status,
				samplesChecked: totalChecked,
				issues,
				message:
					issues.length === 0 ? `Checked ${totalChecked} records, all match` : `Found ${issues.length} mismatches`,
				tableId,
			};
		} catch (error) {
			logger.error(`[ValidationService.spotCheckRecords] ${tableId} spot check failed: ${error.message}`, error);
			return {
				status: 'check_failed',
				message: 'Spot check failed',
				error: error.message,
				tableId,
			};
		}
	}

	generateRecordId(record, timestampColumn) {
		const timestamp = record[timestampColumn];
		logger.trace(
			`[ValidationService.generateRecordId] Generating ID for validation - ${timestampColumn}: ${timestamp}`
		);
		// Match the ID generation in sync-engine.js
		// Note: Adapt this to match your record's unique identifier strategy
		const hash = createHash('sha256')
			.update(`${timestamp}-${record.id || ''}`)
			.digest('hex');
		const id = hash.substring(0, 16);
		logger.trace(`[ValidationService.generateRecordId] Generated ID: ${id}`);
		return id;
	}

	async logAudit(results) {
		logger.debug('[ValidationService.logAudit] Logging validation audit results');
		const auditEntry = {
			id: `validation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			timestamp: results.timestamp,
			nodeId: (await this.discoverCluster()).nodeId,
			status: results.overallStatus,
			checkResults: JSON.stringify(results.tables),
			message: results.error || 'Validation completed',
		};
		logger.debug(`[ValidationService.logAudit] Audit entry: ${JSON.stringify(auditEntry).substring(0, 200)}...`);
		await tables.SyncAudit.put(auditEntry);
		logger.info('[ValidationService.logAudit] Validation audit logged to SyncAudit table');
	}

	async discoverCluster() {
		logger.trace('[ValidationService.discoverCluster] Discovering cluster topology for validation');
		const currentNodeId = [server.hostname, server.workerIndex].join('-');
		logger.trace(`[ValidationService.discoverCluster] Current node ID: ${currentNodeId}`);

		let nodes = [];
		const workerCount = server.workerCount || 1;

		// Check if running in a multi-node cluster
		if (server.nodes && Array.isArray(server.nodes) && server.nodes.length > 0) {
			// Multi-node cluster: enumerate all nodes and their workers
			logger.trace(
				`[ValidationService.discoverCluster] Multi-node cluster: ${server.nodes.length} other nodes, ${workerCount} workers per node`
			);

			// Add current node first
			for (let i = 0; i < workerCount; i++) {
				nodes.push(`${server.hostname}-${i}`);
			}

			// Add other cluster nodes
			for (const node of server.nodes) {
				const hostname = node.name || node.hostname || node.host || node.id;
				if (!hostname) {
					logger.warn(`[ValidationService.discoverCluster] Node missing name property: ${JSON.stringify(node)}`);
					continue;
				}
				for (let i = 0; i < workerCount; i++) {
					nodes.push(`${hostname}-${i}`);
				}
			}
		} else {
			// Single node: generate workers for current node only
			logger.trace(`[ValidationService.discoverCluster] Single node with ${workerCount} workers`);
			for (let i = 0; i < workerCount; i++) {
				nodes.push(`${server.hostname}-${i}`);
			}
		}

		// Sort deterministically
		nodes.sort();
		const nodeIndex = nodes.findIndex((n) => n === currentNodeId);

		if (nodeIndex === -1) {
			logger.error(
				`[ValidationService.discoverCluster] Current node '${currentNodeId}' not found in cluster nodes: ${nodes.join(', ')}`
			);
			throw new Error(`Current node ${currentNodeId} not found in cluster`);
		}

		logger.trace(
			`[ValidationService.discoverCluster] Current node: ${currentNodeId}, index: ${nodeIndex}, clusterSize: ${nodes.length}`
		);

		return {
			nodeId: nodeIndex,
			clusterSize: nodes.length,
		};
	}
}
