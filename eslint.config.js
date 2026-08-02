import harperConfig from '@harperdb/code-guidelines/eslint';

export default [
	...harperConfig,
	// Custom configuration for BigQuery sync plugin
	{
		ignores: [
			'dist/',
			'node_modules/',
			'coverage/',
			'tools/maritime-data-synthesizer/**',
			'examples/**',
			// integrationTests/ holds TypeScript suites run via the Harper test
			// harness plus a fixture component that is a copy of src/ — not part of
			// the linted application source.
			'integrationTests/**',
		],
	},
	{
		rules: {
			// Allow unused vars that start with underscore (intentional unused)
			'no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
				},
			],
			// Allow unused function parameters (common in callbacks)
			'@typescript-eslint/no-unused-vars': 'off',
		},
	},
];
