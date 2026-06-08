# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- None yet

### Changed

- None yet

### Fixed

- None yet

## [2.0.0] - 2025-12-15

### Added

- **Multi-table support** - Sync multiple BigQuery tables simultaneously with independent settings
- **Column selection** - Reduce costs by fetching only needed columns from BigQuery
- **Per-table configuration** - Independent batch sizes, sync intervals, and strategies per table
- **Exponential backoff retry logic** - Smart retry with jitter for transient BigQuery errors
- **Comprehensive logging** - Structured logging throughout codebase for Grafana observability
- **Optional streaming insert API** - Configurable streaming inserts for production deployments
- **Multi-table validation** - Independent validation and monitoring per table
- **Multi-table maritime synthesizer** - Generate realistic data for multiple related tables
- Rolling window mode for automatic data window maintenance
- `clear` command to truncate table without deleting schema
- Automatic backfill on service start
- Self-healing capability after service restart
- Comprehensive documentation suite
- Example scripts demonstrating all features
- Maritime vessel data synthesizer with 100K+ vessels
- 6 vessel types with realistic movement patterns
- 29 major ports with weighted traffic distribution
- Physics-based navigation (Haversine, bearing calculations)
- Configurable rolling N-day data window
- Automatic retention management and cleanup
- CLI with 7 commands (initialize, start, stats, clear, clean, reset, help)
- Shared configuration between plugin and synthesizer
- Event-driven architecture with 15+ event types
- Progress tracking for all operations

### Changed

- `start` command now auto-backfills by default (rolling window mode)
- Documentation reorganized into logical sections
- Improved error messages and retry handling
- Enhanced BigQuery client with smart retry logic
- Better organization of codebase (src/ vs tools/)
- Improved error messages and user feedback

### Fixed

- Memory leak in journey tracking system
- Checkpoint timestamp handling edge cases
- Prettier formatting for markdown documentation
- Configuration loading from config.yaml
- BigQuery credential handling
- Service account key path resolution

### Documentation

- Added streaming insert API design document
- Enhanced logging analysis and research
- Project history documentation
- Multi-table configuration examples
- "Why Maritime Data?" rationale section
- Backward compatibility maintained with single-table format

## [1.0.0] - 2024-XX-XX

### Added

- Initial release of BigQuery Plugin for Harper
- Modulo-based partitioning for distributed ingestion
- Adaptive batch sizing based on sync lag
- Node discovery via Harper clustering
- Independent failure recovery
- Continuous validation (progress + spot checks)
- GraphQL API for querying synced data
- REST endpoints for sync control
- Time partitioning and clustering in BigQuery
- Configurable sync phases (initial, catchup, steady)

### Plugin Features

- Horizontal scalability with linear throughput
- No coordination overhead between nodes
- Deterministic partition assignments
- Automatic topology discovery
- Local checkpoints per node
- Native Harper replication
- Generic storage for any BigQuery schema

### Documentation

- Comprehensive design document
- Blog post explaining architecture evolution
- System overview showing component interaction
- API reference

---

## Version History

### Versioning Strategy

This project follows [Semantic Versioning](https://semver.org/):

- **MAJOR** version: Incompatible API changes
- **MINOR** version: New functionality (backward compatible)
- **PATCH** version: Bug fixes (backward compatible)

### Release Schedule

- **Major releases**: As needed for breaking changes
- **Minor releases**: Monthly for new features
- **Patch releases**: As needed for critical fixes

### Deprecation Policy

Features will be deprecated with:

1. Warning in release notes
2. Deprecation notice in code
3. Minimum 2 minor versions before removal
4. Migration guide provided

---

## Upgrade Guide

### From Pre-Release to 1.0.0

No migration needed - first official release.

### Future Upgrades

See specific version sections above for migration instructions.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute changes.

## Support

- **Issues**: https://github.com/harperdb/bigquery-sync/issues
- **Discussions**: https://github.com/harperdb/bigquery-sync/discussions
- **Email**: opensource@harperdb.io
