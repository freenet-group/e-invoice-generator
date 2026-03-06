const mockSend = jest.fn();

test('mockSend resolves with a valid body', async () => {
    const pdfBytes = new Uint8Array([1, 2, 3]);
    mockSend.mockResolvedValueOnce({
        Body: { transformToByteArray: jest.fn().mockResolvedValueOnce(pdfBytes) },
    });

    const result = await mockSend();
    expect(result.Body.transformToByteArray).toBeDefined();
    expect(await result.Body.transformToByteArray()).toEqual(pdfBytes);
});

test('mockSend resolves with undefined body', async () => {
    mockSend.mockResolvedValueOnce({ Body: undefined });

    const result = await mockSend();
    expect(result.Body).toBeUndefined();
});