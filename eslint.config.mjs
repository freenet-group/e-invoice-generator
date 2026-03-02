import {defineConfig} from 'eslint/config'
import eslint from '@eslint/js'
import tsEslint from 'typescript-eslint'
import unusedImports from 'eslint-plugin-unused-imports'

export default defineConfig([
  {
    ignores: ['eslint.config.mjs', 'dist/**', 'coverage/**', 'node_modules/**']
  },
  {
    files: ['**/*.ts'],
    extends: [eslint.configs.recommended, ...tsEslint.configs.recommendedTypeChecked],
    plugins: {
      'unused-imports': unusedImports
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-deprecated': 'warn',
      curly: 'error',
      'no-console': 'error',
      'no-constant-binary-expression': 'error',
      'no-return-await': 'off',
      'no-warning-comments': ['warn', {location: 'anywhere'}],
      semi: ['error', 'never'],
      'sort-imports': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/ban-ts-comment': ['error', {'ts-expect-error': 'allow-with-description'}],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/consistent-type-assertions': ['error', {assertionStyle: 'angle-bracket'}],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/parameter-properties': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unnecessary-qualifier': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          ignoreRestSiblings: true
        }
      ],
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/prefer-string-starts-ends-with': 'error',
      '@typescript-eslint/promise-function-async': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/restrict-plus-operands': 'error',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowAny: false,
          allowNullableBoolean: false,
          allowNullableNumber: false,
          allowNullableObject: false,
          allowNullableString: false,
          allowNumber: false,
          allowString: false
        }
      ],
      '@typescript-eslint/unified-signatures': 'error'
    }
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  }
])
