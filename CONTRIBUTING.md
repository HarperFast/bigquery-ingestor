# Contributing to Harper BigQuery Sync

Thank you for your interest in contributing! This document provides guidelines for contributing to both the BigQuery Plugin and Maritime Data Synthesizer components.

## Code of Conduct

Be respectful, inclusive, and constructive. We're all here to build great software together.

## Getting Started

### Prerequisites

- Node.js >= 20
- Google Cloud Platform account (for testing)
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/harperdb/bigquery-sync.git
cd bigquery-sync

# Install dependencies
npm install

# Copy environment example
cp .env.example .env

# Configure your test credentials
# Edit config.yaml with your test project settings
```

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### 2. Make Changes

- Write clear, concise code
- Follow existing code style
- Add comments for complex logic
- Update documentation as needed

### 3. Test Your Changes

```bash
# Run examples to verify functionality
node examples/test-config.js
node examples/test-generator.js

# Test CLI commands
npx maritime-data-synthesizer help
```

### 4. Commit

Use conventional commit messages:

```bash
git commit -m "feat: add new vessel type"
git commit -m "fix: correct bearing calculation"
git commit -m "docs: update quickstart guide"
git commit -m "chore: update dependencies"
```

**Commit Types**:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### 5. Push and Create PR

```bash
git push origin your-branch-name
```

Then create a Pull Request on GitHub with:

- Clear title and description
- Reference any related issues
- Screenshots/examples if applicable

## Code Style

### JavaScript

- Use ES modules (`import`/`export`)
- Prefer `const` over `let`, avoid `var`
- Use async/await over promises
- Add JSDoc comments for public APIs
- Keep functions focused and small

**Example**:

```javascript
/**
 * Generate vessel position data
 * @param {number} count - Number of positions to generate
 * @param {number} timestampOffset - Offset in milliseconds
 * @returns {Array<Object>} Array of vessel position records
 */
generateBatch(count, timestampOffset = 0) {
  // Implementation...
}
```

### Documentation

- Use clear, simple language
- Include code examples
- Keep line length reasonable (~80-100 chars)
- Use headings and sections
- Add links to related docs

## Testing

We have comprehensive unit tests for core functionality. When adding or modifying features:

1. Run the test suite: `npm test`
2. Add tests for new functionality in `test/` directory
3. Ensure all tests pass before submitting PR
4. Test coverage includes:
   - BigQuery client with retry logic
   - Config loader for single and multi-table formats
   - Sync engine with phase calculation
   - Maritime data generators
   - Multi-table orchestrator

**Example test run:**

```bash
npm test
# All tests should pass (91 tests currently)
```

## Documentation

If your change affects user-facing features:

1. Update relevant documentation in `docs/`
2. Update command help text if applicable
3. Add examples if introducing new features
4. Update CHANGELOG.md

## Areas for Contribution

### High Priority

1. **Production Operations**
   - Deployment documentation for Fabric and self-hosted
   - Monitoring dashboard templates (Grafana, CloudWatch)
   - Operational runbooks for common scenarios

2. **Testing Expansion**
   - Integration tests for end-to-end sync validation
   - Performance benchmarks
   - Multi-node cluster testing

3. **Documentation**
   - Video tutorials (setup, configuration, troubleshooting)
   - More real-world configuration examples
   - Architecture diagrams

### Medium Priority

1. **Features**
   - Additional vessel types
   - Custom port definitions
   - Data export formats

2. **Performance**
   - Optimization opportunities
   - Batch processing improvements
   - Memory usage reduction

3. **Developer Experience**
   - Better CLI output
   - Progress indicators
   - Debug mode

### Good First Issues

Look for issues labeled `good-first-issue` on GitHub. These are great entry points for new contributors.

## Plugin Development

The BigQuery plugin integrates with Harper. When modifying plugin code:

1. Understand Harper plugin architecture
2. Test with a local Harper instance
3. Verify clustering behavior
4. Check data consistency

**Key Files**:

- `src/index.js` - Plugin entry point and Harper integration
- `src/sync-engine.js` - Core sync engine with adaptive batch sizing
- `src/bigquery-client.js` - BigQuery API client with retry logic
- `src/validation.js` - Data validation and auditing
- `src/query-builder.js` - SQL query construction
- `src/config-loader.js` - Configuration parsing (single/multi-table)
- `schema/bigquery-ingestor.graphql` - GraphQL schema
- `test/` - Unit tests for all core functionality

## Synthesizer Development

The maritime data synthesizer generates test data. When modifying:

1. Ensure data remains realistic
2. Test with different configurations
3. Verify BigQuery integration
4. Check rolling window behavior

**Key Files**:

- `src/generator.js` - Data generation (single-table)
- `src/maritime-synthesizer.js` - Maritime synthesizer wrapper
- `tools/maritime-data-synthesizer/cli.js` - CLI interface
- `tools/maritime-data-synthesizer/multi-table-orchestrator.js` - Multi-table orchestration
- `tools/maritime-data-synthesizer/generators/` - Multi-table data generators

## Release Process

(For maintainers)

1. Update CHANGELOG.md
2. Update version in package.json
3. Create git tag: `git tag v1.x.x`
4. Push tag: `git push origin v1.x.x`
5. GitHub Actions publishes to npm

## Getting Help

- **Questions**: Open a discussion on GitHub
- **Bugs**: Create an issue with reproduction steps
- **Features**: Open an issue for discussion first
- **Urgent**: Email opensource@harperdb.io

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.

## Recognition

Contributors will be:

- Listed in package.json contributors
- Acknowledged in release notes
- Credited in documentation for major features

Thank you for contributing! 🚢
