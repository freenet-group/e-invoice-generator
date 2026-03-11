import {publishEInvoiceCreated, type EInvoiceCreatedEventParams} from '../../../src/services/eInvoiceEventPublisher'

jest.mock('../../../src/core/sns/snsClient', () => ({
    snsClient: {send: jest.fn().mockResolvedValue({})}
}))

jest.mock('@aws-sdk/client-sns', () => ({
    PublishCommand: jest.fn().mockImplementation((input: unknown) => ({name: 'PublishCommand', input}))
}))

interface MockedSnsClient {
    snsClient: {send: jest.Mock}
}
interface MockedSnsSdk {
    PublishCommand: jest.Mock
}

const baseParams: EInvoiceCreatedEventParams = {
    billingDocumentId: 'INV-001',
    partyId: 'PARTY-123',
    billingAccountId: 'ACC-456',
    s3Key: 'e-invoices/INV-001.pdf',
    bucketName: 'my-bucket',
    profile: 'factur-x-en16931',
    source: 'MCBS',
    context: 'e-invoice-added',
    billingDocumentType: 'COMMERCIAL_INVOICE',
    mediaType: 'application/pdf',
    correlationId: 'corr-uuid-001'
}

describe('publishEInvoiceCreated', () => {
    let mockSend: jest.Mock
    let PublishCommand: jest.Mock

    beforeEach(() => {
        jest.clearAllMocks()
        const snsClientMock = jest.requireMock<MockedSnsClient>('../../../src/core/sns/snsClient')
        snsClientMock.snsClient.send.mockResolvedValue({})
        mockSend = snsClientMock.snsClient.send
        PublishCommand = jest.requireMock<MockedSnsSdk>('@aws-sdk/client-sns').PublishCommand
        process.env['E_INVOICE_TOPIC_ARN'] = 'arn:aws:sns:eu-central-1:123456789012:einvoice-topic'
    })

    afterEach(() => {
        delete process.env['E_INVOICE_TOPIC_ARN']
    })

    it('throws when E_INVOICE_TOPIC_ARN is not set', async () => {
        delete process.env['E_INVOICE_TOPIC_ARN']
        await expect(publishEInvoiceCreated(baseParams)).rejects.toThrow('E_INVOICE_TOPIC_ARN environment variable is not set')
        expect(mockSend).not.toHaveBeenCalled()
    })

    it('throws when E_INVOICE_TOPIC_ARN is empty string', async () => {
        process.env['E_INVOICE_TOPIC_ARN'] = ''
        await expect(publishEInvoiceCreated(baseParams)).rejects.toThrow('E_INVOICE_TOPIC_ARN environment variable is not set')
    })

    it('calls snsClient.send with PublishCommand', async () => {
        await publishEInvoiceCreated(baseParams)
        expect(mockSend).toHaveBeenCalledTimes(1)
        expect(PublishCommand).toHaveBeenCalledTimes(1)
    })

    it('constructs correct TopicArn and Subject', async () => {
        await publishEInvoiceCreated(baseParams)
        const commandInput = <Record<string, unknown>>(<unknown[][]>PublishCommand.mock.calls)[0]?.[0]
        expect(commandInput['TopicArn']).toBe('arn:aws:sns:eu-central-1:123456789012:einvoice-topic')
        expect(commandInput['Subject']).toBe('EInvoice Created')
    })

    it('constructs s3URI from bucketName and s3Key', async () => {
        await publishEInvoiceCreated(baseParams)
        const commandInput = <Record<string, unknown>>(<unknown[][]>PublishCommand.mock.calls)[0]?.[0]
        const message = <Record<string, unknown>>JSON.parse(<string>commandInput['Message'])
        expect(message['s3URI']).toBe('s3://my-bucket/e-invoices/INV-001.pdf')
    })

    it('includes all required message body fields', async () => {
        await publishEInvoiceCreated(baseParams)
        const commandInput = <Record<string, unknown>>(<unknown[][]>PublishCommand.mock.calls)[0]?.[0]
        const message = <Record<string, unknown>>JSON.parse(<string>commandInput['Message'])
        expect(message['correlationId']).toBe('corr-uuid-001')
        expect(message['billingDocumentType']).toBe('COMMERCIAL_INVOICE')
        expect(message['billingDocumentId']).toBe('INV-001')
        expect(message['partyId']).toBe('PARTY-123')
        expect(message['billingAccountId']).toBe('ACC-456')
        expect(message['profile']).toBe('factur-x-en16931')
        expect(message['mediaType']).toBe('application/pdf')
        expect(typeof message['eventDate']).toBe('string')
    })

    it('includes all MessageAttributes', async () => {
        await publishEInvoiceCreated(baseParams)
        const commandInput = <Record<string, unknown>>(<unknown[][]>PublishCommand.mock.calls)[0]?.[0]
        const attrs = <Record<string, {DataType: string; StringValue: string}>>commandInput['MessageAttributes']
        expect(attrs['eventType']?.StringValue).toBe('CustomerBill:DocumentCreated')
        expect(attrs['context']?.StringValue).toBe('e-invoice-added')
        expect(attrs['source']?.StringValue).toBe('MCBS')
        expect(attrs['billingDocumentType']?.StringValue).toBe('COMMERCIAL_INVOICE')
        expect(attrs['profile']?.StringValue).toBe('factur-x-en16931')
        expect(attrs['mediaType']?.StringValue).toBe('application/pdf')
    })

    it('sets eventType to CustomerBill:DocumentCreated for MCBS source', async () => {
        await publishEInvoiceCreated({...baseParams, source: 'MCBS'})
        const commandInput = <Record<string, unknown>>(<unknown[][]>PublishCommand.mock.calls)[0]?.[0]
        const attrs = <Record<string, {DataType: string; StringValue: string}>>commandInput['MessageAttributes']
        expect(attrs['eventType']?.StringValue).toBe('CustomerBill:DocumentCreated')
    })

    it('sets eventType to CustomerBill:DocumentCreated for AWS_BILLING source', async () => {
        await publishEInvoiceCreated({...baseParams, source: 'AWS_BILLING'})
        const commandInput = <Record<string, unknown>>(<unknown[][]>PublishCommand.mock.calls)[0]?.[0]
        const attrs = <Record<string, {DataType: string; StringValue: string}>>commandInput['MessageAttributes']
        expect(attrs['eventType']?.StringValue).toBe('CustomerBill:DocumentCreated')
    })

    it('sets eventType to BusinessPartnerSettlement:DocumentCreated for PARTNER_COMMISSION source', async () => {
        await publishEInvoiceCreated({...baseParams, source: 'PARTNER_COMMISSION'})
        const commandInput = <Record<string, unknown>>(<unknown[][]>PublishCommand.mock.calls)[0]?.[0]
        const attrs = <Record<string, {DataType: string; StringValue: string}>>commandInput['MessageAttributes']
        expect(attrs['eventType']?.StringValue).toBe('BusinessPartnerSettlement:DocumentCreated')
    })

    it('uses CREDIT_NOTE billingDocumentType correctly', async () => {
        await publishEInvoiceCreated({...baseParams, billingDocumentType: 'CREDIT_NOTE'})
        const commandInput = <Record<string, unknown>>(<unknown[][]>PublishCommand.mock.calls)[0]?.[0]
        const attrs = <Record<string, {DataType: string; StringValue: string}>>commandInput['MessageAttributes']
        expect(attrs['billingDocumentType']?.StringValue).toBe('CREDIT_NOTE')
        const message = <Record<string, unknown>>JSON.parse(<string>commandInput['Message'])
        expect(message['billingDocumentType']).toBe('CREDIT_NOTE')
    })
})
