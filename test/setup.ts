// Jest Setup File
// Wird vor allen Tests ausgeführt

// Set test environment variables
process.env['NODE_ENV'] = 'test'
process.env['AWS_REGION'] = 'eu-central-1'
process.env['DEDUP_TABLE_NAME'] = 'test-dedup-table'
process.env['BUCKET_NAME'] = 'test-bucket'

// Logger in Tests stumm schalten
process.env['LOG_LEVEL'] = 'silent'

// Mock console für cleaner Test Output
globalThis.console = {
    ...console,
    // Behalte error und warn
    error: jest.fn(),
    warn: jest.fn(),
    // Aber unterdrücke log und debug in Tests
    log: jest.fn(),
    debug: jest.fn()
}
