# BigQuery Plugin + Maritime Synthesizer - System Overview

This project contains two complementary components that work together:

## 1. BigQuery Ingestor Plugin (for Harper)

**Purpose**: Syncs data FROM BigQuery INTO Harper

**What it does**:

- Connects to BigQuery and monitors a source table
- Fetches new/updated records based on timestamp
- Ingests data into Harper with validation
- Handles different sync modes (initial, catchup, steady-state)
- Provides GraphQL API for querying synced data

**Configuration** (in `config.yaml`):

```yaml
bigquery:
  projectId: your-gcp-project-id
  dataset: maritime_tracking # Reads from here
  table: vessel_positions
  timestampColumn: timestamp
  credentials: service-account-key.json
  location: US

  # Column selection (optional) - fetch only specific columns
  # Omit or use "*" to fetch all columns (default behavior)
  # When specified, timestampColumn MUST be included
  columns: [timestamp, mmsi, vessel_name, latitude, longitude]
  # OR
  # columns: "*"  # Fetch all columns (default)
```

## 2. Maritime Vessel Data Synthesizer

**Purpose**: Generates synthetic data and writes it TO BigQuery

**What it does**:

- Creates realistic vessel tracking data at global scale
- Generates 100,000+ vessel positions with movement patterns
- Writes to BigQuery with proper schema and partitioning
- Maintains rolling window retention (auto-cleanup)
- Can be used to test the plugin or for other purposes

**Configuration** (in `config.yaml`):

```yaml
synthesizer:
  dataset: maritime_tracking # Writes to here
  table: vessel_positions
  totalVessels: 100000
  batchSize: 100
  generationIntervalMs: 60000
  retentionDays: 30
  cleanupIntervalHours: 24
```

## How They Work Together

### Shared Configuration

Both components use the **same** BigQuery connection:

- Same GCP project
- Same credentials (`service-account-key.json`)
- Same location (e.g., `US`)
- By default, same dataset and table (synthesizer writes, plugin reads)

This keeps setup simple - configure once, use everywhere!

### Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Google BigQuery                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           maritime_tracking.vessel_positions         │   │
│  │                                                       │   │
│  │  [Synthesizer Writes] ──→ [Plugin Reads]            │   │
│  │                                                       │   │
│  └──────────▲─────────────────────────┬─────────────────┘   │
│             │                          │                     │
└─────────────┼──────────────────────────┼─────────────────────┘
              │                               │
              │ Reads                         │ Writes
              │                               │
┌─────────────▼───────────────┐   ┌──────────┴────────────────┐
│  BigQuery Plugin            │   │  Maritime Synthesizer      │
│                             │   │                            │
│  - Monitors for new data    │   │  - Generates vessel data   │
│  - Fetches incrementally    │   │  - Simulates movement      │
│  - Validates records        │   │  - Manages retention       │
│  - Ingests to Harper      │   │  - Auto-cleanup            │
│                             │   │                            │
│  GraphQL API ──────────────▶│   │  CLI Tool                  │
└─────────────┬───────────────┘   └────────────────────────────┘
              │
              │ Stores
              ▼
┌─────────────────────────────┐
│        Harper             │
│                             │
│  - Local database           │
│  - Fast queries             │
│  - REST/GraphQL APIs        │
└─────────────────────────────┘
```

## Use Case: Testing the Plugin

The maritime synthesizer is perfect for testing the BigQuery plugin:

### 1. Generate Test Data

```bash
# Create 30 days of synthetic vessel data
npx maritime-data-synthesizer initialize 30

# Start continuous generation
npx maritime-data-synthesizer start
```

This creates a BigQuery table with millions of realistic records.

### 2. Point Plugin at Test Data

Update `config.yaml`:

```yaml
bigquery:
  projectId: irjudson-demo
  dataset: maritime_tracking # Point to synthetic data
  table: vessel_positions
  timestampColumn: timestamp # Use 'timestamp' field
  credentials: service-account-key.json
  location: US
```

### 3. Run Plugin

Start Harper with the plugin, and it will:

- Sync vessel positions from BigQuery
- Make them queryable via GraphQL
- Keep data up-to-date as synthesizer generates new records

## Use Case: Production Setup

For production, keep them separate:

### Plugin Configuration (production data)

```yaml
bigquery:
  dataset: production_data
  table: real_events
  timestampColumn: event_time
```

### Synthesizer Configuration (test data)

```yaml
synthesizer:
  dataset: test_data
  table: synthetic_vessels
```

Both use the same credentials, but read/write different datasets.

## Key Benefits

### Unified Configuration

- Single `config.yaml` for both components
- Shared BigQuery connection settings
- No duplicate credential management

### Flexible Usage

- Use synthesizer independently for data generation
- Use plugin independently for any BigQuery table
- Combine them for end-to-end testing

### Realistic Test Data

- Synthesizer creates production-like workloads
- Millions of records with realistic patterns
- Perfect for load testing and validation

### Cost Optimization

- Both use BigQuery free tier efficiently
- Load jobs instead of streaming inserts
- Automatic cleanup of old data
- **Column selection reduces data transfer costs** - fetch only needed fields

### Column Selection (New!)

- Select specific columns to sync from BigQuery
- Reduces network transfer and query costs
- Improves sync performance for large tables
- Backward compatible - defaults to all columns
- Example: Only sync `[timestamp, id, status]` instead of 50+ fields

## Configuration Reference

### Required (shared by both)

```yaml
bigquery:
  projectId: your-project-id # GCP project
  credentials: key.json # Service account key
  location: US # BigQuery region
```

### Plugin-specific

```yaml
bigquery:
  dataset: source_dataset # Where to read from
  table: source_table
  timestampColumn: timestamp_field

  # Optional: Select specific columns to reduce data transfer
  columns: [timestamp_field, id, name, status] # Must include timestampColumn
  # OR
  # columns: "*"  # Fetch all columns (default)

sync:
  initialBatchSize: 10000
  catchupBatchSize: 1000
  steadyBatchSize: 500
  pollInterval: 30000
```

### Synthesizer-specific

```yaml
synthesizer:
  dataset: target_dataset # Where to write to
  table: target_table
  totalVessels: 100000
  batchSize: 100
  generationIntervalMs: 60000
  retentionDays: 30
  cleanupIntervalHours: 24
```

## File Structure

```
bigquery-ingestor/
├── config.yaml                      # Unified configuration
├── service-account-key.json         # Shared credentials
│
├── src/                             # Plugin source code
│   ├── index.js                     # Plugin entry point
│   ├── sync-engine.js               # BigQuery sync engine
│   ├── bigquery-client.js           # BigQuery API client with column selection
│   ├── query-builder.js             # SQL query construction (NEW)
│   ├── type-converter.js            # BigQuery type conversion (NEW)
│   ├── validators.js                # Centralized validation (NEW)
│   ├── validation.js                # Data validation
│   ├── generator.js                 # Vessel data generator
│   ├── bigquery.js                  # BigQuery writer
│   ├── service.js                   # Synthesizer orchestrator
│   ├── maritime-synthesizer.js      # Synthesizer exports
│   └── config-loader.js             # Shared config loader
│
├── bin/
│   └── cli.js                       # Synthesizer CLI
│
├── schema/
│   └── bigquery-ingestor.graphql # Plugin GraphQL schema
│
└── docs/
    ├── QUICKSTART.md                # 5-minute setup guide
    ├── SYSTEM-OVERVIEW.md           # This file
    └── maritime-data-synthesizer.md # Full synthesizer docs
```

## Quick Commands

### Synthesizer

```bash
# Generate test data
npx maritime-data-synthesizer initialize 30
npx maritime-data-synthesizer start
npx maritime-data-synthesizer stats

# Reset
npx maritime-data-synthesizer reset 30
```

### Plugin

```bash
# Runs as Harper plugin
# See Harper documentation for setup
```

## Next Steps

1. **Quick Start**: Read `docs/QUICKSTART.md` for 5-minute setup
2. **Test**: Generate data and sync it through the plugin
3. **Customize**: Modify vessel types, ports, or data schemas
4. **Deploy**: Use in production with real BigQuery data

## Support

- Plugin issues: See Harper documentation
- Synthesizer issues: Check `docs/maritime-data-synthesizer.md`
- Configuration: All settings documented in `config.yaml`

---

**The power of synthetic data + cloud data pipelines** 🚀
