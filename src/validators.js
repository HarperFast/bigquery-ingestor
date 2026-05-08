/**
 * Centralized Validation Module
 * Provides validation functions for configuration and data
 */
import { logger } from 'harper';

/**
 * Validates BigQuery configuration
 * @param {Object} config - The bigquery configuration object
 * @throws {Error} If configuration is invalid
 */
export function validateBigQueryConfig(config) {
	if (!config) {
		throw new Error('BigQuery configuration is required');
	}

	const requiredFields = ['projectId', 'dataset', 'table', 'timestampColumn'];
	const missingFields = requiredFields.filter((field) => !config[field]);

	if (missingFields.length > 0) {
		throw new Error(`Missing required BigQuery config fields: ${missingFields.join(', ')}`);
	}

	// Validate credentials path
	if (!config.credentials) {
		throw new Error('BigQuery credentials file path is required');
	}

	return true;
}

/**
 * Validates and normalizes column configuration
 * @param {Array|string|undefined} columns - Column configuration (array, "*", or undefined)
 * @param {string} timestampColumn - The timestamp column name (required in column list)
 * @param {boolean} hasCustomQuery - Whether a custom query is being used
 * @returns {Array<string>} Normalized column array
 * @throws {Error} If column configuration is invalid
 */
export function validateAndNormalizeColumns(columns, timestampColumn, hasCustomQuery = false) {
	// If using custom query, columns are optional (query defines the columns)
	if (hasCustomQuery) {
		// Return ['*'] as a placeholder - custom query defines actual columns
		return ['*'];
	}

	// Case 1: columns not specified (undefined/null) -> SELECT *
	if (columns === undefined || columns === null) {
		return ['*'];
	}

	// Case 2: columns is "*" string -> SELECT *
	if (columns === '*') {
		return ['*'];
	}

	// Case 3: columns is an array
	if (Array.isArray(columns)) {
		if (columns.length === 0) {
			throw new Error('Column array cannot be empty. Use "*" or omit for SELECT *');
		}

		// Check if array contains only "*"
		if (columns.length === 1 && columns[0] === '*') {
			return ['*'];
		}

		// Validate all columns are strings
		const nonStringColumns = columns.filter((col) => typeof col !== 'string');
		if (nonStringColumns.length > 0) {
			throw new Error('All columns must be strings');
		}

		// Validate no empty strings
		const emptyColumns = columns.filter((col) => col.trim() === '');
		if (emptyColumns.length > 0) {
			throw new Error('Column names cannot be empty strings');
		}

		// Ensure timestamp column is included (unless using SELECT *)
		if (!columns.includes(timestampColumn)) {
			throw new Error(
				`Timestamp column '${timestampColumn}' must be included in columns list. ` +
					`Add it to the array or use "*" to select all columns.`
			);
		}

		// Return trimmed columns
		return columns.map((col) => col.trim());
	}

	// Invalid type
	throw new Error(`Invalid columns type: ${typeof columns}. Expected array of strings, "*", or undefined.`);
}

/**
 * Validates sync configuration
 * @param {Object} syncConfig - The sync configuration object
 * @throws {Error} If sync configuration is invalid
 */
export function validateSyncConfig(syncConfig) {
	if (!syncConfig) {
		throw new Error('Sync configuration is required');
	}

	// Validate batch sizes are positive integers
	const batchSizeFields = ['initialBatchSize', 'catchupBatchSize', 'steadyBatchSize'];
	for (const field of batchSizeFields) {
		if (syncConfig[field] !== undefined) {
			if (!Number.isInteger(syncConfig[field]) || syncConfig[field] <= 0) {
				throw new Error(`${field} must be a positive integer`);
			}
		}
	}

	// Validate thresholds are positive numbers
	const thresholdFields = ['catchupThreshold', 'steadyThreshold'];
	for (const field of thresholdFields) {
		if (syncConfig[field] !== undefined) {
			if (typeof syncConfig[field] !== 'number' || syncConfig[field] <= 0) {
				throw new Error(`${field} must be a positive number`);
			}
		}
	}

	// Validate poll interval
	if (syncConfig.pollInterval !== undefined) {
		if (!Number.isInteger(syncConfig.pollInterval) || syncConfig.pollInterval <= 0) {
			throw new Error('pollInterval must be a positive integer');
		}
	}

	return true;
}

/**
 * Validates retry configuration
 * @param {Object} retryConfig - The retry configuration object
 * @throws {Error} If retry configuration is invalid
 */
export function validateRetryConfig(retryConfig) {
	if (!retryConfig) {
		return true; // Retry config is optional
	}

	if (retryConfig.maxAttempts !== undefined) {
		if (!Number.isInteger(retryConfig.maxAttempts) || retryConfig.maxAttempts < 0) {
			throw new Error('maxAttempts must be a non-negative integer');
		}
	}

	if (retryConfig.backoffMultiplier !== undefined) {
		if (typeof retryConfig.backoffMultiplier !== 'number' || retryConfig.backoffMultiplier <= 0) {
			throw new Error('backoffMultiplier must be a positive number');
		}
	}

	if (retryConfig.initialDelay !== undefined) {
		if (!Number.isInteger(retryConfig.initialDelay) || retryConfig.initialDelay < 0) {
			throw new Error('initialDelay must be a non-negative integer');
		}
	}

	return true;
}

/**
 * Validates proxy configuration
 * @param {Object} proxyConfig - The proxy configuration object
 * @throws {Error} If proxy configuration is invalid
 */
export function validateProxyConfig(proxyConfig) {
	if (!proxyConfig) {
		return true; // Proxy config is optional
	}

	// enabled is required if proxy section exists
	if (typeof proxyConfig.enabled !== 'boolean') {
		throw new Error('proxy.enabled must be a boolean (true or false)');
	}

	// If enabled, url is required
	if (proxyConfig.enabled) {
		if (!proxyConfig.url || typeof proxyConfig.url !== 'string') {
			throw new Error('proxy.url is required when proxy is enabled');
		}

		// Basic URL validation - should start with http:// or https://
		const url = proxyConfig.url.trim();
		if (!url.startsWith('http://') && !url.startsWith('https://')) {
			throw new Error('proxy.url must start with http:// or https://');
		}

		// Validate URL format (basic check)
		try {
			new URL(url);
		} catch (error) {
			throw new Error(`Invalid proxy.url format: ${error.message}`);
		}
	}

	return true;
}

/**
 * Validates custom query configuration
 * @param {string} customQuery - The custom SQL query
 * @param {string} _timestampColumn - The timestamp column name (must be in query results)
 * @throws {Error} If custom query is invalid
 */
export function validateCustomQuery(customQuery, _timestampColumn) {
	if (!customQuery) {
		return true; // Custom query is optional
	}

	if (typeof customQuery !== 'string') {
		throw new Error('customQuery must be a string');
	}

	const trimmedQuery = customQuery.trim();
	if (trimmedQuery.length === 0) {
		throw new Error('customQuery cannot be empty');
	}

	// Validate query starts with SELECT (case insensitive)
	if (!trimmedQuery.match(/^\s*SELECT\s+/i)) {
		throw new Error('customQuery must start with SELECT');
	}

	// Check if query contains @lastTimestamp variable (required for incremental sync)
	if (!trimmedQuery.includes('@lastTimestamp')) {
		throw new Error(
			'customQuery must include @lastTimestamp variable in WHERE clause for incremental sync. ' +
				'Example: WHERE event_time > TIMESTAMP(@lastTimestamp)'
		);
	}

	// Warn if query contains ORDER BY or LIMIT (we add these automatically)
	if (trimmedQuery.match(/\bORDER\s+BY\b/i)) {
		logger?.warn(
			'[validators.validateCustomQuery] customQuery contains ORDER BY clause. ' +
				'This will be wrapped and an outer ORDER BY will be added for partitioning.'
		);
	}

	if (trimmedQuery.match(/\bLIMIT\b/i)) {
		logger?.warn(
			'[validators.validateCustomQuery] customQuery contains LIMIT clause. ' +
				'This will be wrapped and an outer LIMIT will be added for batch control.'
		);
	}

	return true;
}

/**
 * Validates the entire configuration object
 * @param {Object} config - The full configuration object
 * @throws {Error} If any part of the configuration is invalid
 */
export function validateFullConfig(config) {
	if (!config) {
		throw new Error('Configuration object is required');
	}

	// Validate BigQuery config
	validateBigQueryConfig(config.bigquery);

	// Validate proxy config if present
	if (config.bigquery.proxy) {
		validateProxyConfig(config.bigquery.proxy);
	}

	// Validate and normalize columns
	const hasCustomQuery = !!config.bigquery.customQuery;
	const normalizedColumns = validateAndNormalizeColumns(
		config.bigquery.columns,
		config.bigquery.timestampColumn,
		hasCustomQuery
	);

	// Validate custom query if present
	if (config.bigquery.customQuery) {
		validateCustomQuery(config.bigquery.customQuery, config.bigquery.timestampColumn);
	}

	// Validate sync config
	if (config.sync) {
		validateSyncConfig(config.sync);
	}

	// Validate retry config
	if (config.retry) {
		validateRetryConfig(config.retry);
	}

	return {
		isValid: true,
		normalizedColumns,
	};
}

export default {
	validateBigQueryConfig,
	validateAndNormalizeColumns,
	validateSyncConfig,
	validateRetryConfig,
	validateProxyConfig,
	validateCustomQuery,
	validateFullConfig,
};
