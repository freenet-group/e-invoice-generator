import { loadPdfFromS3 } from '../../src/core/s3/s3PdfLoader'

jest.mock('../../src/core/s3/s3Client', () => ({
    s3Client: { send: jest.fn() },
}))

import { s3Client } from '../../src/core/s3/s3Client'

const mockSend = <jest.Mock>s3Client.send

describe('s3PdfLoader', () => {

    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('returns Buffer when S3 returns valid body', async () => {
        const pdfBytes = Buffer.from('%PDF-1.4')
        mockSend.mockResolvedValueOnce(<never>{
            Body: <never>{ transformToByteArray: jest.fn().mockResolvedValueOnce(pdfBytes) },
        })
        const result = await loadPdfFromS3('my-bucket', 'my-file.pdf')
        expect(result).toEqual(pdfBytes)
    })

    it('returns null when S3 Body is undefined (Zeile 15)', async () => {
        mockSend.mockResolvedValueOnce(<never>{ Body: undefined })
        const result = await loadPdfFromS3('my-bucket', 'my-file.pdf')
        expect(result).toBeNull()
    })

    it('returns null when file content is not a PDF (e.g. XML)', async () => {
        const xmlBytes = Buffer.from('<?xml version="1.0"?><DOCUMENT/>')
        mockSend.mockResolvedValueOnce(<never>{
            Body: <never>{ transformToByteArray: jest.fn().mockResolvedValueOnce(xmlBytes) },
        })
        const result = await loadPdfFromS3('my-bucket', 'raw/invoice.xml')
        expect(result).toBeNull()
    })

    it('returns null on S3 error', async () => {
        mockSend.mockRejectedValueOnce(<never>new Error('NoSuchKey'))
        const result = await loadPdfFromS3('my-bucket', 'missing.pdf')
        expect(result).toBeNull()
    })
})