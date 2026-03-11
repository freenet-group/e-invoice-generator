import {InvoiceAdapter, RawInvoiceData} from '../../../src/adapters/invoiceAdapter'
import {AdapterRegistry} from '../../../src/adapters/adapterRegistry'
import {CommonInvoice, InvoiceType, TaxCategoryCode} from '../../../src/models/commonInvoice'

function createInvoice(): CommonInvoice {
    return {
        invoiceNumber: 'INV-1',
        invoiceDate: '2026-02-22',
        invoiceType: InvoiceType.COMMERCIAL,
        currency: 'EUR',
        source: {system: 'MCBS', id: 'id-1', timestamp: '2026-02-22T00:00:00Z', billingAccountId: 'BA-001'},
        seller: {
            name: 'Seller',
            postalAddress: {postalCode: '1', cityName: 'A', countryCode: 'DE'}
        },
        buyer: {
            name: 'Buyer',
            postalAddress: {postalCode: '2', cityName: 'B', countryCode: 'DE'}
        },
        lineItems: [
            {
                id: 1,
                name: 'Item',
                quantity: 1,
                unitCode: 'C62',
                unitPrice: 10,
                netAmount: 10,
                tax: {typeCode: 'VAT', categoryCode: TaxCategoryCode.STANDARD, rate: 19}
            }
        ],
        paymentMeans: [{typeCode: '58'}],
        taxes: [{typeCode: 'VAT', categoryCode: TaxCategoryCode.STANDARD, rate: 19, basisAmount: 10, calculatedAmount: 1.9}],
        totals: {lineTotal: 10, taxBasisTotal: 10, taxTotal: 1.9, grandTotal: 11.9, duePayable: 11.9}
    }
}

function createRawData(): RawInvoiceData {
    return {
        source: 'MCBS',
        data: {},
        metadata: {
            id: 'raw-id',
            timestamp: '2026-02-22T00:00:00Z'
        }
    }
}

describe('AdapterRegistry', () => {
    it('registers and resolves adapters', async () => {
        const registry = new AdapterRegistry()
        const invoice = createInvoice()
        const rawData = createRawData()

        const adapter: InvoiceAdapter = {
            loadInvoiceData: jest.fn().mockResolvedValue(rawData),
            mapToCommonModel: jest.fn().mockResolvedValue(invoice),
            loadPDF: jest.fn().mockResolvedValue(null)
        }

        registry.register('custom.mcbs', () => adapter)

        expect(registry.hasAdapter('custom.mcbs')).toBe(true)
        expect(registry.getSources()).toEqual(['custom.mcbs'])

        const resolved = registry.getAdapter('custom.mcbs')
        await expect(resolved.loadInvoiceData({})).resolves.toEqual(rawData)
        await expect(resolved.mapToCommonModel(rawData)).resolves.toEqual(invoice)
    })

    it('throws when source is not registered', () => {
        const registry = new AdapterRegistry()

        expect(() => registry.getAdapter('unknown.source')).toThrow('No adapter registered for source: unknown.source')
    })
})
