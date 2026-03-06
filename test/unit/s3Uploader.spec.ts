import {PutObjectCommand} from '@aws-sdk/client-s3'
import {uploadToS3} from '../../src/core/s3/s3Uploader'

jest.mock('../../src/core/s3/s3Client', () => ({
    s3Client: {send: jest.fn()}
}))

import {s3Client} from '../../src/core/s3/s3Client'

const mockSend = jest.mocked(s3Client.send)

describe('s3Uploader', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('uploads XML buffer to S3', async () => {
        mockSend.mockResolvedValueOnce(<never>{})

        await uploadToS3({
            bucketName: 'my-bucket',
            key: 'invoice.xml',
            body: Buffer.from('<xml/>'),
            contentType: 'application/xml'
        })

        expect(mockSend).toHaveBeenCalledTimes(1)

        const callArgs = <unknown[]>mockSend.mock.calls[0]
        expect(callArgs).toBeDefined()
        const command = <PutObjectCommand>callArgs[0]
        expect(command).toBeInstanceOf(PutObjectCommand)
        expect(command.input).toEqual(
            expect.objectContaining({
                Bucket: 'my-bucket',
                Key: 'invoice.xml',
                Body: Buffer.from('<xml/>'),
                ContentType: 'application/xml'
            })
        )
        expect(command.input.Metadata).toBeUndefined()
    })

    it('uploads PDF buffer with metadata to S3', async () => {
        mockSend.mockResolvedValueOnce(<never>{})

        await uploadToS3({
            bucketName: 'my-bucket',
            key: 'invoice.pdf',
            body: Buffer.from([1, 2, 3]),
            contentType: 'application/pdf',
            metadata: {source: 'unit-test', type: 'invoice'}
        })

        expect(mockSend).toHaveBeenCalledTimes(1)

        const callArgs = <unknown[]>mockSend.mock.calls[0]
        expect(callArgs).toBeDefined()
        const command = <PutObjectCommand>callArgs[0]
        expect(command.input).toEqual(
            expect.objectContaining({
                Bucket: 'my-bucket',
                Key: 'invoice.pdf',
                ContentType: 'application/pdf',
                Metadata: {source: 'unit-test', type: 'invoice'}
            })
        )
    })

    it('includes empty metadata object when provided', async () => {
        mockSend.mockResolvedValueOnce(<never>{})

        await uploadToS3({
            bucketName: 'my-bucket',
            key: 'invoice.xml',
            body: Buffer.from('<xml/>'),
            contentType: 'application/xml',
            metadata: {}
        })

        const callArgs = <unknown[]>mockSend.mock.calls[0]
        expect(callArgs).toBeDefined()
        const command = <PutObjectCommand>callArgs[0]
        expect(command.input.Metadata).toEqual({})
    })

    it('propagates S3 client errors', async () => {
        mockSend.mockRejectedValueOnce(<never>new Error('S3 failed'))

        await expect(
            uploadToS3({
                bucketName: 'my-bucket',
                key: 'invoice.xml',
                body: Buffer.from('<xml/>'),
                contentType: 'application/xml'
            })
        ).rejects.toThrow('S3 failed')
    })
})
