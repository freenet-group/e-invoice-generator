import pino from 'pino'

export const logger = pino({
    level: process.env['LOG_LEVEL'] ?? 'info',
    base: {
        service: 'mcbs-zugferd-converter',
        env: process.env['STAGE'] ?? process.env['NODE_ENV'] ?? 'unknown'
    }
})
