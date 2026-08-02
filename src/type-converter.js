/**
 * Type Converter
 * Converts BigQuery-specific types to JavaScript primitives and Date objects
 */
import { logger } from 'harper';

/**
 * Checks if a value is a BigQuery timestamp type
 * @param {*} value - Value to check
 * @returns {boolean} True if value is a BigQuery timestamp type
 * @private
 */
function isBigQueryTimestamp(value) {
	if (!value || typeof value !== 'object') return false;

	const constructorName = value.constructor?.name;
	return ['BigQueryTimestamp', 'BigQueryDatetime', 'BigQueryDate'].includes(constructorName);
}

/**
 * Checks if a string matches ISO 8601 date format
 * @param {string} str - String to check
 * @returns {boolean} True if string looks like an ISO date
 * @private
 */
function looksLikeISODate(str) {
	return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(str);
}

/**
 * Converts a BigQuery timestamp object to a JavaScript Date
 * @param {Object} value - BigQuery timestamp object
 * @returns {Date|*} Date object if conversion succeeds, original value otherwise
 */
export function convertBigQueryTimestamp(value) {
	logger.debug(`[convertBigQueryTimestamp] Converting BigQuery timestamp (constructor: ${value.constructor?.name})`);

	// Try .value property (contains ISO string)
	if (value.value) {
		const date = new Date(value.value);
		logger.debug(`[convertBigQueryTimestamp] Converted via .value property: ${date.toISOString()}`);
		return date;
	}

	// Try .toJSON() method
	if (typeof value.toJSON === 'function') {
		const jsonValue = value.toJSON();
		const date = new Date(jsonValue);
		logger.debug(`[convertBigQueryTimestamp] Converted via .toJSON(): ${date.toISOString()}`);
		return date;
	}

	// Unable to convert
	logger.warn('[convertBigQueryTimestamp] Unable to convert timestamp, returning original value');
	return value;
}

/**
 * Converts a BigInt to Number or String based on size
 * @param {BigInt} value - BigInt value to convert
 * @returns {number|string} Number if within safe integer range, String otherwise
 */
export function convertBigInt(value) {
	if (value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER) {
		logger.debug(`[convertBigInt] Converting BigInt ${value} to Number (within safe range)`);
		return Number(value);
	}
	logger.warn(`[convertBigInt] BigInt ${value} exceeds safe integer range, converting to String`);
	return value.toString();
}

/**
 * Converts a single value from BigQuery format to JavaScript format
 * @param {*} value - Value to convert
 * @returns {*} Converted value
 */
export function convertValue(value) {
	// Handle null/undefined
	if (value === null || value === undefined) {
		logger.debug(`[convertValue] Value is ${value}, no conversion needed`);
		return value;
	}

	// Handle BigInt
	if (typeof value === 'bigint') {
		logger.debug('[convertValue] Detected BigInt value, converting');
		return convertBigInt(value);
	}

	// Handle objects
	if (typeof value === 'object') {
		// BigQuery timestamp types
		if (isBigQueryTimestamp(value)) {
			logger.debug('[convertValue] Detected BigQuery timestamp, converting');
			return convertBigQueryTimestamp(value);
		}

		// Already a Date object
		if (value instanceof Date) {
			logger.debug('[convertValue] Value is already a Date object');
			return value;
		}

		// Object with toJSON method
		if (typeof value.toJSON === 'function') {
			const jsonValue = value.toJSON();

			// If it looks like an ISO date, convert to Date
			if (looksLikeISODate(jsonValue)) {
				logger.debug('[convertValue] Object.toJSON() returned ISO date string, converting to Date');
				return new Date(jsonValue);
			}

			logger.debug('[convertValue] Object.toJSON() returned non-date value');
			return jsonValue;
		}

		// Other objects - keep as-is
		logger.debug('[convertValue] Object has no special handling, keeping as-is');
		return value;
	}

	// Primitive types - keep as-is
	logger.debug(`[convertValue] Primitive value (${typeof value}), no conversion needed`);
	return value;
}

/**
 * Converts BigQuery record types to JavaScript primitives
 * All timestamp/datetime types are converted to Date objects for Harper's timestamp type
 * @param {Object} record - Record with BigQuery types
 * @returns {Object} Record with converted types
 */
export function convertBigQueryTypes(record) {
	if (!record || typeof record !== 'object') {
		logger.error('[convertBigQueryTypes] Invalid input: record must be an object');
		throw new Error('Record must be an object');
	}

	logger.debug(`[convertBigQueryTypes] Converting record with ${Object.keys(record).length} fields`);

	const converted = {};

	for (const [key, value] of Object.entries(record)) {
		converted[key] = convertValue(value);
	}

	logger.debug('[convertBigQueryTypes] Record conversion complete');
	return converted;
}

/**
 * Converts an array of BigQuery records
 * @param {Array<Object>} records - Array of records to convert
 * @returns {Array<Object>} Array of converted records
 */
export function convertBigQueryRecords(records) {
	if (!Array.isArray(records)) {
		logger.error('[convertBigQueryRecords] Invalid input: records must be an array');
		throw new Error('Records must be an array');
	}

	logger.info(`[convertBigQueryRecords] Converting ${records.length} records`);

	const converted = records.map((record) => convertBigQueryTypes(record));

	logger.info('[convertBigQueryRecords] Batch conversion complete');
	return converted;
}

export default {
	convertBigQueryTypes,
	convertBigQueryRecords,
	convertValue,
	convertBigInt,
	convertBigQueryTimestamp,
};
