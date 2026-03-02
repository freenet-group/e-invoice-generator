import type { SQSEvent } from 'aws-lambda'

const mockRegister = jest.fn()
const mockProcessBatch = jest.fn()
const mockInfo = jest.fn()
const mockError = jest.fn()
const mockChild = jest.fn(() => ({ info: mockInfo, error: mockError }))
const mockMCBSAdapterCtor = jest.fn()

jest.mock('../../../src/adapters/adapterRegistry', () => ({
    AdapterRegistry: jest.fn().mockImplementation(() => ({
        register: mockRegister,
    })),
}))

jest.mock('../../../src/adapters/mcbs/mcbsInvoiceAdapter', () => ({
    MCBSAdapter: jest.fn().mockImplementation((options: unknown) => {
        mockMCBSAdapterCtor(options)
        return { options }
    }),
}))

jest.mock('../../../src/services/eInvoiceProcessingService', () => ({
    EInvoiceProcessingService: jest.fn().mockImplementation(() => ({
        processBatch: mockProcessBatch,
    })),
}))

jest.mock('../../../src/core/logger', () => ({
    logger: {
        child: mockChild,
    },
}))

describe('unified-e-invoice.handler', () => {
    beforeEach(() => {
        jest.resetModules()
        jest.clearAllMocks()
        delete process.env['ACTIVE_ADAPTER']
    })

    it('registriert default Adapter und verarbeitet Batch erfolgreich', async () => {
        mockProcessBatch.mockResolvedValue({ batchItemFailures: [] })

        await jest.isolateModulesAsync(async () => {
            const mod = await import('../../../src/handlers/unifiedEInvoiceProcessor')
            const event: SQSEvent = {
                Records: [
                    <SQSEvent['Records'][number]>{ messageId: 'm1' },
                    <SQSEvent['Records'][number]>{ messageId: 'm2' },
                ],
            }

            const result = await mod.handler(event)

            expect(result).toEqual({ batchItemFailures: [] })
            expect(mockRegister).toHaveBeenCalledWith('custom.mcbs', expect.any(Function))
            expect(mockProcessBatch).toHaveBeenCalledWith(event.Records)

            expect(mockInfo).toHaveBeenCalled()
            expect(mockError).not.toHaveBeenCalled()

            const factory = <() => unknown>((<unknown[]>mockRegister.mock.calls[0])[1])
            factory()
            const calls = <unknown[][]>mockMCBSAdapterCtor.mock.calls
            const options = <{
                resolvePrimaryKey: (pdfKey: string) => string
            }>calls[0]?.[0]
            expect(options.resolvePrimaryKey('invoice.PDF')).toBe('invoice.xml')
        })
    })

    it('loggt Fehler bei fehlgeschlagenen Items', async () => {
        mockProcessBatch.mockResolvedValue({
            batchItemFailures: [{ itemIdentifier: 'msg-1' }],
        })

        await jest.isolateModulesAsync(async () => {
            const mod = await import('../../../src/handlers/unifiedEInvoiceProcessor')
            const event: SQSEvent = {
                Records: [<SQSEvent['Records'][number]>{ messageId: 'msg-1' }],
            }

            const result = await mod.handler(event)

            expect(result.batchItemFailures).toHaveLength(1)
            expect(mockError).toHaveBeenCalled()
        })
    })

    it('wirft bei nicht unterstütztem Adapter', async () => {
        process.env['ACTIVE_ADAPTER'] = 'unknown.adapter'

        await jest.isolateModulesAsync(async () => {
            await expect(
                import('../../../src/handlers/unifiedEInvoiceProcessor')
            ).rejects.toThrow("Adapter 'unknown.adapter' not yet implemented")
        })
    })
})