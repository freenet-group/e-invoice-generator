describe('logger', () => {
    afterEach(() => {
        delete process.env['LOG_LEVEL']
        delete process.env['NODE_ENV']
        jest.resetModules()
    })

    // ── Zeilen 4-7: LOG_LEVEL und NODE_ENV aus Env ──
    it('uses LOG_LEVEL from environment (Zeile 4-7)', async () => {
        process.env['LOG_LEVEL'] = 'debug'
        process.env['NODE_ENV'] = 'test'
        const {logger} = await import('../../src/core/logger')
        expect(logger.level).toBe('debug')
    })

    it('uses default log level when LOG_LEVEL is not set', async () => {
        delete process.env['LOG_LEVEL']
        const {logger} = await import('../../src/core/logger')
        expect(logger.level).toBe('info')
    })
})
