# BigQuery Sync Plugin for Harper

**Production-ready distributed data ingestion from Google BigQuery to Harper.**

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

**About Harper:** Harper is a distributed application platform that unifies database, cache, and application server. [Learn more](https://harperdb.io)

**Quick Deploy:** Launch this component on [Harper Fabric](https://fabric.harper.fast) - no credit card required, free tier available.

## Features (v2.0)

- ✅ **Multi-table support** - Sync multiple BigQuery tables simultaneously with independent settings
- ✅ **Column selection** - Reduce costs by fetching only needed columns from BigQuery
- ✅ **Horizontal scalability** - Linear throughput increase with cluster size
- ✅ **Adaptive batch sizing** - Automatically adjusts based on sync lag (initial/catchup/steady phases)
- ✅ **Failure recovery** - Local checkpoints enable independent node recovery
- ✅ **Exponential backoff** - Smart retry logic with jitter for transient BigQuery errors
- ✅ **Production-ready** - Battle-tested with comprehensive logging for Grafana observability
- ✅ **No coordination overhead** - Each node independently determines its workload via modulo partitioning

## Quick Start

### 1. Install

Install Harper and add this plugin:

```bash
# Install Harper
# See https://docs.harperdb.io/docs/getting-started/quickstart

# Clone this plugin
cd your-harper-project
npm install @harperdb/bigquery-ingestor
```

### 2. Configure (Your Data)

Edit `config.yaml` with your BigQuery connection and tables:

```yaml
bigquery:
  projectId: your-gcp-project
  credentials: service-account-key.json
  location: US

  tables:
    # Example: Sync user events
    - id: user_events
      dataset: production
      table: user_events
      timestampColumn: event_time
      columns: [event_time, user_id, event_type, properties]
      targetTable: UserEvents
      sync:
        initialBatchSize: 10000
        catchupBatchSize: 1000
        steadyBatchSize: 500

    # Example: Sync application logs
    - id: app_logs
      dataset: production
      table: application_logs
      timestampColumn: timestamp
      columns: ['*'] # Fetch all columns
      targetTable: AppLogs
      sync:
        initialBatchSize: 5000
        catchupBatchSize: 500
        steadyBatchSize: 100
```

**Key Configuration Points:**

- `timestampColumn` - The timestamp field used for incremental sync (must be monotonically increasing)
- `columns` - Array of column names to fetch, or `['*']` for all columns
- `targetTable` - Harper table where data will be synced
- Each BigQuery table must sync to a **different** Harper table (see [Configuration](#configuration) for details)

### 3. Run

Start Harper with the plugin:

```bash
harper dev .
```

The plugin will:

1. Calculate worker IDs from cluster instances and thread counts
2. Determine this worker's partition assignments
3. Begin syncing data from BigQuery
4. Create checkpoints for recovery
5. Continuously poll for new data

Monitor sync status via the REST API:

```bash
curl http://localhost:9926/SyncControl
```

## Architecture

### How It Works

Each Harper worker in the cluster:

1. **Calculates worker ID** from cluster instances and thread counts per instance (deterministic ordering by hostname-workerIndex)
2. **Determines cluster size** from total workers across all instances
3. **Partitions workload** using modulo: pulls only records where `hash(timestamp) % clusterSize == workerID`
4. **Syncs independently** with local checkpoints
5. **Relies on Harper replication** for data distribution across the cluster

**Key Benefits:**

- No coordination between nodes (no distributed locks, no leader election)
- Linear scalability - add nodes to increase throughput proportionally
- Independent failure recovery - nodes restart without affecting others
- Deterministic partitioning - same timestamp always routes to same node

### Adaptive Batch Sizing

The plugin automatically adjusts batch sizes based on sync lag:

- **Initial phase** (lag > 1 hour): Large batches for fast catch-up
- **Catchup phase** (lag 10 min - 1 hour): Medium batches to close the gap
- **Steady phase** (lag < 10 min): Small batches for low latency

Poll intervals also adapt - faster during catch-up, slower when near real-time.

## Configuration

### Multi-Table Configuration

Sync multiple BigQuery tables to Harper simultaneously:

```yaml
bigquery:
  projectId: your-project
  credentials: service-account-key.json
  location: US

  # Optional retry configuration
  maxRetries: 5
  initialRetryDelay: 1000 # milliseconds

  tables:
    - id: orders
      dataset: ecommerce
      table: orders
      timestampColumn: created_at
      columns: [created_at, order_id, customer_id, total, status]
      targetTable: Orders
      sync:
        initialBatchSize: 10000
        catchupBatchSize: 1000
        steadyBatchSize: 500
        pollInterval: 30000 # 30 seconds

    - id: payments
      dataset: ecommerce
      table: payments
      timestampColumn: payment_time
      columns: ['*']
      targetTable: Payments
      sync:
        initialBatchSize: 5000
        catchupBatchSize: 500
        steadyBatchSize: 100
        pollInterval: 60000 # 60 seconds
```

**Important Constraints:**

Each BigQuery table **MUST** sync to a different Harper table. Multiple BigQuery tables syncing to the same Harper table will cause:

- Record ID collisions and data overwrites
- Validation failures (can only validate one source)
- Checkpoint confusion (different sync states)
- Schema conflicts (mixed field sets)

If you need to combine data from multiple BigQuery tables, sync them to separate Harper tables and join at query time.

### Column Selection

Reduce BigQuery costs by fetching only needed columns:

```yaml
tables:
  - id: large_table
    dataset: analytics
    table: events
    timestampColumn: event_time
    # Only fetch these 5 columns instead of all 50+
    columns: [event_time, user_id, event_type, page_url, session_id]
    targetTable: Events
```

**Rules:**

- `timestampColumn` MUST be included in the columns list
- Use `['*']` to fetch all columns (default if omitted)
- Column selection reduces network transfer and query costs

### Retry Configuration

The plugin implements exponential backoff with jitter for transient BigQuery errors:

```yaml
bigquery:
  maxRetries: 5 # Maximum retry attempts (default: 5)
  initialRetryDelay: 1000 # Initial delay in ms, doubles each retry (default: 1000)
```

**Retry Behavior:**

- **Retryable errors**: Rate limits, quota exceeded, internal errors, 503, 429
- **Non-retryable errors**: Invalid queries, permissions, schema mismatches - fail immediately
- **Backoff strategy**: Initial delay × 2^attempt with random jitter, capped at 30 seconds
- **Logging**: Warnings on retry attempts, errors on final failure

### Legacy Single-Table Configuration

For backward compatibility, the plugin still supports the single-table format:

```yaml
bigquery:
  projectId: your-project
  dataset: your_dataset
  table: your_table
  timestampColumn: timestamp
  credentials: service-account-key.json
  location: US
  columns: ['*']
```

This automatically converts to a multi-table configuration internally with `targetTable: BigQueryData`.

## Data Storage

BigQuery records are stored as-is in Harper tables:

```graphql
type YourTable @table {
	id: ID! @primaryKey # Generated from timestamp + hash
	_syncedAt: String @createdTime # When record was synced
	# All your BigQuery columns appear here at the top level
}
```

**Example stored record:**

```json
{
	"id": "a1b2c3d4e5f6g7h8",
	"_syncedAt": "2025-12-15T20:00:00Z",
	"event_time": "2025-12-15T19:59:00Z",
	"user_id": "user_12345",
	"event_type": "page_view",
	"page_url": "/products/widget",
	"session_id": "sess_abc123"
}
```

All BigQuery fields are directly queryable without nested paths, providing maximum flexibility.

## Maritime Test Data (Optional)

Want to test the plugin before connecting your own data? Use our maritime data synthesizer to generate realistic vessel tracking data.

The synthesizer creates production-like workloads with:

- 100,000+ vessels with realistic movement patterns
- Multiple related tables (positions, events, metadata)
- Global scale with 29 major ports worldwide
- Physics-based navigation
- Automatic retention management

**Quick Start:**

```bash
# Generate test data (writes TO BigQuery)
npx maritime-data-synthesizer initialize realistic

# Start the plugin (reads FROM BigQuery)
harper dev .
```

**Documentation:**

- [5-Minute Quick Start](docs/quickstart.md) - Start generating data immediately
- [Maritime Synthesizer Guide](docs/maritime-synthesizer.md) - Comprehensive documentation
- [System Overview](docs/system-overview.md) - How plugin + synthesizer work together
- [Why Maritime Data?](README.md#why-maritime-data) - Rationale for vessel tracking data

### Why Maritime Data?

The maritime synthesizer provides a **realistic, production-grade test environment**. Vessel tracking data mirrors common BigQuery workloads:

- ✅ **High volume continuous flow** - 144K+ records/day sustained
- ✅ **Temporal ordering constraints** - Chronological data with late arrivals
- ✅ **Complex schema** - Geospatial coords, metadata, multi-table relationships
- ✅ **Production use case** - Matches IoT streams, event tracking, time-series data

Perfect for testing sync performance, multi-table coordination, and distributed workload partitioning before production deployment.

## Monitoring & Operations

### Distributed Sync Control

The plugin provides cluster-wide sync control via REST API. All commands replicate across nodes automatically.

**Available Commands:**

```bash
# Get current status (GET)
curl http://localhost:9926/SyncControl \
  -u admin:HarperRocks!

# Start sync across entire cluster (POST)
curl -X POST http://localhost:9926/SyncControl \
  -u admin:HarperRocks! \
  -H "Content-Type: application/json" \
  -d '{"action": "start"}'

# Stop sync across entire cluster (POST)
curl -X POST http://localhost:9926/SyncControl \
  -u admin:HarperRocks! \
  -H "Content-Type: application/json" \
  -d '{"action": "stop"}'

# Run validation across cluster (POST)
curl -X POST http://localhost:9926/SyncControl \
  -u admin:HarperRocks! \
  -H "Content-Type: application/json" \
  -d '{"action": "validate"}'
```

**Status Response Format:**

```json
{
	"global": {
		"command": "start",
		"commandedAt": "2025-12-16T20:30:00Z",
		"commandedBy": "node1-0",
		"version": 42
	},
	"worker": {
		"nodeId": "node1-0",
		"running": true,
		"tables": [
			{ "tableId": "vessel_positions", "running": true, "phase": "steady" },
			{ "tableId": "port_events", "running": true, "phase": "catchup" }
		],
		"failedEngines": []
	},
	"uptime": 3600,
	"version": "2.0.0"
}
```

- **global**: Cluster-wide sync command state (replicated across all nodes via Harper)
- **worker**: This specific worker thread's status
- **nodeId**: Identifies worker as `hostname-workerIndex`
- **tables**: Status per sync engine (one per configured table)
- **failedEngines**: Any engines that failed to start

### Data Validation

Run validation to verify data integrity across the cluster:

```bash
curl -X POST http://localhost:9926/SyncControl \
  -u admin:HarperRocks! \
  -H "Content-Type: application/json" \
  -d '{"action": "validate"}'
```

**Validation performs three checks per table:**

1. **Progress Check** - Verifies sync is advancing, checks for stalled workers
   - Status: `healthy`, `lagging`, `severely_lagging`, `stalled`, `no_checkpoint`

2. **Smoke Test** - Confirms recent data (last 5 minutes) is queryable
   - Status: `healthy`, `no_recent_data`, `query_failed`, `table_not_found`

3. **Spot Check** - Validates data integrity bidirectionally
   - Checks if Harper records exist in BigQuery (detects phantom records)
   - Checks if BigQuery records exist in Harper (detects missing records)
   - Status: `healthy`, `issues_found`, `no_data`, `check_failed`

**View validation results:**

```bash
# Get recent validation audits
curl http://localhost:9926/SyncAudit/ \
  -u admin:HarperRocks!
```

Each validation run creates audit records with:

- `timestamp` - When validation ran
- `nodeId` - Which worker performed the validation
- `status` - Overall status: `healthy`, `issues_detected`, or `error`
- `checkResults` - JSON with detailed results per table and check

### View Checkpoints

```bash
# REST API
curl http://localhost:9926/SyncCheckpoint/ \
  -u admin:HarperRocks!
```

Or query via SQL:

```sql
-- Check sync progress per node
SELECT * FROM SyncCheckpoint ORDER BY nodeId;

-- Calculate current lag
SELECT
  nodeId,
  lastTimestamp,
  (UNIX_TIMESTAMP(NOW()) - UNIX_TIMESTAMP(lastTimestamp)) as lag_seconds,
  phase
FROM SyncCheckpoint;
```

### Access Synced Data

All synced tables are accessible via REST API:

```bash
# Query vessel positions (note trailing slash)
curl http://localhost:9926/VesselPositions/ \
  -u admin:HarperRocks!

# Query port events
curl http://localhost:9926/PortEvents/ \
  -u admin:HarperRocks!

# Query vessel metadata
curl http://localhost:9926/VesselMetadata/ \
  -u admin:HarperRocks!
```

**Important:** REST endpoints require a trailing slash (`/TableName/`) to return data arrays. Without the trailing slash, you get table metadata instead of records.

### Postman Collection

A comprehensive Postman collection is included for testing all endpoints:

```bash
# Import into Postman
bigquery-ingestor_postman.json
```

**Collection includes:**

- **Cluster Control** - Start, stop, validate commands
- **Status Monitoring** - Check sync status and worker health
- **Data Verification** - Query PortEvents, VesselMetadata, VesselPositions
- **Checkpoint Inspection** - View sync progress per node
- **Audit Review** - Check validation results

**Authentication:** Uses Basic Auth with default credentials (admin / HarperRocks!). Update the collection variables if using different credentials.

### Query Synced Data

```sql
-- Query your synced data
SELECT * FROM UserEvents
WHERE event_time > '2025-12-01T00:00:00Z'
ORDER BY event_time DESC
LIMIT 100;

-- Check sync latency
SELECT
  id,
  event_time as source_time,
  _syncedAt as synced_time,
  TIMESTAMPDIFF(SECOND, event_time, _syncedAt) as latency_seconds
FROM UserEvents
ORDER BY _syncedAt DESC
LIMIT 10;
```

## Troubleshooting

### Node Not Ingesting

**Symptoms:** Node shows as running but no new records appear

**Checks:**

1. Verify BigQuery credentials are valid
2. Check network connectivity to BigQuery API
3. Query checkpoint table for errors: `SELECT * FROM SyncCheckpoint WHERE nodeId = 'your-node'`
4. Check logs for permission errors or API failures

### High Lag

**Symptoms:** Sync lag increasing over time

**Solutions:**

1. **Increase batch sizes** in config for faster catch-up
2. **Add more nodes** to the cluster for horizontal scaling
3. **Benchmark your workload** - use the benchmarking tool to determine optimal cluster sizing
4. **Reduce columns** - fetch only needed columns to reduce network transfer

### Data Drift Detected

**Symptoms:** Validation shows missing records

**Causes:**

1. Partition key collisions (rare, hash-based)
2. Some nodes not running or stuck
3. Checkpoint corruption

**Resolution:**

1. Check all nodes are running: `SELECT DISTINCT nodeId FROM SyncCheckpoint`
2. Review checkpoint timestamps for anomalies
3. Check validation logs for specific issues: `SELECT * FROM SyncAudit WHERE status = 'failed'`

### BigQuery API Errors

**Symptoms:** Repeated API failures in logs

**Common Issues:**

| Error                     | Cause                             | Solution                                                 |
| ------------------------- | --------------------------------- | -------------------------------------------------------- |
| `403 Permission Denied`   | Service account lacks permissions | Add `bigquery.jobs.create` and `bigquery.tables.getData` |
| `429 Too Many Requests`   | Rate limit exceeded               | Reduce batch sizes or poll frequency                     |
| `503 Service Unavailable` | Temporary BigQuery outage         | Plugin will automatically retry with backoff             |
| `Invalid query`           | Schema mismatch                   | Verify `timestampColumn` exists and is correct type      |

### Configuration Issues

**Symptoms:** Plugin fails to start or sync doesn't begin

**Common Mistakes:**

1. **timestampColumn not in columns list** - Must include timestamp in columns array
2. **Multiple tables → same targetTable** - Each BigQuery table needs unique Harper table
3. **Invalid credentials path** - Ensure service account key file exists at specified path
4. **Missing location** - Defaults to US, but must match your BigQuery dataset location

## Performance Tuning

### Benchmarking Your Workload

To determine the optimal cluster size and configuration for your specific use case, use the **bq-benchmark** tool included in this repository. The tool measures:

- Sustained ingestion throughput (records/min, MB/min) from BigQuery to Harper
- Query availability throughput (how fast data becomes queryable)
- Replication lag between ingestion and query availability
- Latency percentiles (P50, P95, P99)
- Resource utilization (CPU, memory)

**Quick Start:**

```bash
cd tools/bq-benchmark
npm install
node cli.js setup --verify    # Verify connectivity
node cli.js run               # Run benchmark with defaults (2min warmup, 5min measure, 1min cooldown)
node cli.js run --json        # Also generate JSON report
```

The benchmark uses a three-phase approach (warmup, measurement, cooldown) with sliding window averages to provide accurate measurements excluding startup artifacts and eventual consistency delays.

See [tools/bq-benchmark/README.md](tools/bq-benchmark/README.md) for complete documentation.

**Note:** Harper doesn't autoscale. Add/remove nodes manually via Fabric UI or self-hosted configuration. Cluster size changes require workload rebalancing (see Limitations).

Learn more about [Harper's storage architecture](https://docs.harperdb.io/docs/reference/storage-algorithm)

### Batch Size Recommendations

Adjust based on your workload:

| Record Size     | Network | Initial Batch | Catchup Batch | Steady Batch  |
| --------------- | ------- | ------------- | ------------- | ------------- |
| Small (<1KB)    | Fast    | 10000         | 1000          | 500           |
| Medium (1-10KB) | Fast    | 5000          | 500           | 100           |
| Large (>10KB)   | Fast    | 1000          | 100           | 50            |
| Any             | Slow    | Reduce by 50% | Reduce by 50% | Reduce by 50% |

## BigQuery Setup

### Required Permissions

Your service account needs:

- `bigquery.jobs.create` - Create query jobs
- `bigquery.tables.getData` - Read table data

[BigQuery IAM documentation](https://cloud.google.com/bigquery/docs/access-control)

### Cost Optimization

1. **Column selection** - Fetch only needed columns to reduce query costs
2. **Polling intervals** - Adjust `pollInterval` based on latency requirements
3. **Batch sizes** - Larger batches = fewer queries = lower costs (but higher latency)
4. **Partitioned tables** - Use timestamp partitioning in BigQuery for faster queries

## Limitations

- **Stable cluster topology** - Adding/removing nodes requires workload rebalancing (v3.0 will add dynamic rebalancing)
- **Monotonic timestamps** - Timestamp column must be monotonically increasing for correct partitioning
- **Schema evolution** - Adding columns works, but removing/renaming requires manual intervention
- **One direction** - Plugin syncs FROM BigQuery TO Harper (not bidirectional)

## Roadmap

See [ROADMAP.md](ROADMAP.md) for future plans.

### Next (v3.0)

- Dynamic rebalancing for autoscaling
- Enhanced monitoring dashboards
- Dynamic Harper table creation via Operations API

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

**Areas we'd love help with:**

- Production deployment documentation
- Integration tests
- Performance benchmarks
- Video tutorials
- More real-world configuration examples

## Support

- **Issues**: [GitHub Issues](https://github.com/HarperFast/bigquery-sync/issues)
- **Discussions**: [GitHub Discussions](https://github.com/HarperFast/bigquery-sync/discussions)
- **Email**: opensource@harperdb.io

## License

Apache 2.0 - See [LICENSE](LICENSE)

---

**Get Started:** Deploy on [Harper Fabric](https://fabric.harper.fast) - free tier available, no credit card required.

**Learn More:** [Harper Documentation](https://docs.harperdb.io) | [harperdb.io](https://harperdb.io)
