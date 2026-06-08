// Integration tests for the BigQuery ingestor Harper component.
//
// SCOPE: These tests verify the parts of the component that do NOT require
// Google BigQuery credentials or network access:
//   - the Harper app boots with the component's GraphQL schema and REST layer,
//   - the schema tables (VesselPositions, PortEvents, VesselMetadata,
//     SyncCheckpoint, SyncAudit, SyncControlState, SchemaLock) load,
//   - the REST/data layer works against locally-seeded data (PUT/GET/DELETE,
//     search, the custom resource get/search overrides in src/resources.js).
//
// The actual BigQuery sync pipeline (handleApplication -> BigQueryClient ->
// SyncEngine) is intentionally NOT exercised here: it needs real BigQuery
// credentials/network that cannot be provided in CI. The fixture config omits
// `pluginModule` so the sync engine never boots; a placeholder test below is
// t.skip()'d with a clear diagnostic to make that boundary explicit.

import { suite, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { setupHarperWithFixture, teardownHarper, type ContextWithHarper } from '@harperfast/integration-testing';

const require = createRequire(import.meta.url);
// harper's `exports` map only exposes ".", so 'harper/dist/bin/harper.js' is not
// resolvable via require.resolve. Resolve the CLI from the exported main entry
// and pass it explicitly as harperBinPath (documented harness escape hatch).
const harperBinPath = resolve(dirname(require.resolve('harper')), 'bin/harper.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, 'fixtures', 'bigquery-ingestor');

suite('bigquery-ingestor component (no external BigQuery creds)', (ctx: ContextWithHarper) => {
	before(async () => {
		await setupHarperWithFixture(ctx, FIXTURE_PATH, { harperBinPath });
	});

	after(async () => {
		await teardownHarper(ctx);
	});

	const auth = () => {
		const { username, password } = ctx.harper.admin;
		return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
	};

	test('Harper boots and the component schema tables are reachable over REST', async () => {
		// Each @table in the GraphQL schema gets an auto REST endpoint. A GET on a
		// table root should return 200 (empty result set) once the schema loaded.
		for (const table of ['VesselPositions', 'PortEvents', 'VesselMetadata']) {
			const res = await fetch(`${ctx.harper.httpURL}/${table}/`, {
				headers: { Authorization: auth(), Accept: 'application/json' },
			});
			assert.equal(res.status, 200, `${table} endpoint should be reachable`);
			await res.text();
		}
	});

	test('VesselPositions: PUT then GET round-trips a record through the data layer', async () => {
		const record = {
			id: 'mmsi-12345',
			mmsi: 12345,
			vessel_name: 'Test Vessel',
			latitude: 47.6,
			longitude: -122.3,
			speed_knots: 12.5,
		};

		const putRes = await fetch(`${ctx.harper.httpURL}/VesselPositions/${record.id}`, {
			method: 'PUT',
			headers: { 'Authorization': auth(), 'Content-Type': 'application/json' },
			body: JSON.stringify(record),
		});
		assert.ok(putRes.status >= 200 && putRes.status < 300, `PUT should succeed, got ${putRes.status}`);
		await putRes.text();

		// GET routes through the VesselPositions resource's static get() override.
		const getRes = await fetch(`${ctx.harper.httpURL}/VesselPositions/${record.id}`, {
			headers: { Authorization: auth(), Accept: 'application/json' },
		});
		assert.equal(getRes.status, 200, 'GET should return the stored record');
		const body = (await getRes.json()) as Record<string, unknown>;
		assert.equal(body.id, record.id);
		assert.equal(body.vessel_name, 'Test Vessel');
		assert.equal(body.mmsi, 12345);
	});

	test('VesselPositions: search override returns seeded records', async () => {
		// Seed a couple of records.
		for (const id of ['search-a', 'search-b']) {
			const res = await fetch(`${ctx.harper.httpURL}/VesselPositions/${id}`, {
				method: 'PUT',
				headers: { 'Authorization': auth(), 'Content-Type': 'application/json' },
				body: JSON.stringify({ id, mmsi: 999, vessel_name: id }),
			});
			await res.text();
		}

		// Query the collection endpoint; routes through the search() override.
		const res = await fetch(`${ctx.harper.httpURL}/VesselPositions/?mmsi=999`, {
			headers: { Authorization: auth(), Accept: 'application/json' },
		});
		assert.equal(res.status, 200);
		const results = (await res.json()) as Array<Record<string, unknown>>;
		assert.ok(Array.isArray(results), 'search should return an array');
		const names = results.map((r) => r.vessel_name);
		assert.ok(names.includes('search-a') && names.includes('search-b'), 'both seeded records should be found');
	});

	test('SyncControlState singleton table accepts a control record', async () => {
		// This is the table the SyncControl REST resource reads/writes; verify the
		// data layer for it works independently of the sync engine.
		const id = 'sync-control';
		const putRes = await fetch(`${ctx.harper.httpURL}/SyncControlState/${id}`, {
			method: 'PUT',
			headers: { 'Authorization': auth(), 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id,
				command: 'stop',
				commandedAt: new Date().toISOString(),
				commandedBy: 'integration-test',
				version: 1,
			}),
		});
		assert.ok(putRes.status >= 200 && putRes.status < 300, `PUT should succeed, got ${putRes.status}`);
		await putRes.text();

		const getRes = await fetch(`${ctx.harper.httpURL}/SyncControlState/${id}`, {
			headers: { Authorization: auth(), Accept: 'application/json' },
		});
		assert.equal(getRes.status, 200);
		const body = (await getRes.json()) as Record<string, unknown>;
		assert.equal(body.command, 'stop');
		assert.equal(body.version, 1);
	});

	test('DELETE removes a record from the data layer', async () => {
		const id = 'to-delete';
		await (
			await fetch(`${ctx.harper.httpURL}/VesselPositions/${id}`, {
				method: 'PUT',
				headers: { 'Authorization': auth(), 'Content-Type': 'application/json' },
				body: JSON.stringify({ id, mmsi: 1 }),
			})
		).text();

		const delRes = await fetch(`${ctx.harper.httpURL}/VesselPositions/${id}`, {
			method: 'DELETE',
			headers: { Authorization: auth() },
		});
		assert.ok(delRes.status >= 200 && delRes.status < 300, `DELETE should succeed, got ${delRes.status}`);
		await delRes.text();

		const getRes = await fetch(`${ctx.harper.httpURL}/VesselPositions/${id}`, {
			headers: { Authorization: auth(), Accept: 'application/json' },
		});
		assert.equal(getRes.status, 404, 'record should be gone after DELETE');
		await getRes.text();
	});

	test('BigQuery sync pipeline (handleApplication/SyncEngine) — requires real BigQuery creds', (t) => {
		t.skip(
			'Skipped: exercising the BigQuery sync pipeline requires real Google BigQuery ' +
				'credentials (service-account-key.json) and network access, which are not ' +
				'available in CI. The fixture config omits pluginModule so the sync engine ' +
				'does not boot. This is covered by the unit tests under test/ (mocked BigQuery).'
		);
	});
});
