import {loadXmlFromS3, loadXmlFromS3OrLocal} from '../../src/core/s3/s3XmlLoader'
import {readFile} from 'node:fs/promises'

jest.mock('../../src/core/s3/s3Client', () => ({
    s3Client: {send: jest.fn()}
}))

jest.mock('node:fs/promises', () => ({
    readFile: jest.fn()
}))

import {s3Client} from '../../src/core/s3/s3Client'

const mockSend = <jest.MockedFunction<() => Promise<unknown>>>(<unknown>jest.mocked(s3Client.send))
const mockReadFile = jest.mocked(readFile)

describe('s3XmlLoader', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    // ── loadXmlFromS3 ──────────────────────────────────────────────

    it('returns XML string when S3 returns valid body', async () => {
        const xmlContent = '<?xml version="1.0"?><root/>'
        mockSend.mockResolvedValueOnce({
            Body: {transformToString: jest.fn().mockResolvedValueOnce(xmlContent)}
        })
        const result = await loadXmlFromS3('my-bucket', 'my-key.xml')
        expect(result).toBe(xmlContent)
    })

    it('returns null when S3 Body is undefined', async () => {
        mockSend.mockResolvedValueOnce({Body: undefined})
        const result = await loadXmlFromS3('my-bucket', 'my-key.xml')
        expect(result).toBeNull()
    })

    it('returns null when S3 returns empty string', async () => {
        mockSend.mockResolvedValueOnce({
            Body: {transformToString: jest.fn().mockResolvedValueOnce('')}
        })
        const result = await loadXmlFromS3('my-bucket', 'my-key.xml')
        expect(result).toBeNull()
    })

    it('returns null when S3 throws NoSuchKey error', async () => {
        const error = Object.assign(new Error('NoSuchKey'), {name: 'NoSuchKey'})
        mockSend.mockRejectedValueOnce(error)
        const result = await loadXmlFromS3('my-bucket', 'missing-key.xml')
        expect(result).toBeNull()
    })

    it('rethrows unknown errors', async () => {
        mockSend.mockRejectedValueOnce(new Error('Network failure'))
        await expect(loadXmlFromS3('my-bucket', 'my-key.xml')).rejects.toThrow('Network failure')
    })

    // ── loadXmlFromS3OrLocal (Zeile 16, 25, 30) ───────────────────

    it('loads XML from local file when filePath is given', async () => {
        const xmlContent = '<?xml version="1.0"?><root/>'
        mockReadFile.mockResolvedValueOnce(xmlContent)
        const result = await loadXmlFromS3OrLocal({filePath: '/tmp/test.xml'})
        expect(result).toBe(xmlContent)
        expect(mockReadFile).toHaveBeenCalledWith('/tmp/test.xml', {encoding: 'utf-8'})
    })

    it('loads XML from S3 when bucket and key are given', async () => {
        const xmlContent = '<?xml version="1.0"?><root/>'
        mockSend.mockResolvedValueOnce({
            Body: {transformToString: jest.fn().mockResolvedValueOnce(xmlContent)}
        })
        const result = await loadXmlFromS3OrLocal({bucket: 'my-bucket', key: 'my-key.xml'})
        expect(result).toBe(xmlContent)
    })

    it('throws when S3 returns empty body in loadXmlFromS3OrLocal', async () => {
        mockSend.mockResolvedValueOnce({Body: undefined})
        await expect(loadXmlFromS3OrLocal({bucket: 'my-bucket', key: 'my-key.xml'})).rejects.toThrow('Empty response from S3')
    })

    it('throws when neither filePath nor bucket+key are provided', async () => {
        await expect(loadXmlFromS3OrLocal({})).rejects.toThrow('Either filePath or bucket+key must be provided')
    })
})
