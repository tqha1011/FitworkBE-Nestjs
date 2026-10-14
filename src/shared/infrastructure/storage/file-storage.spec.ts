import { ConfigService } from '@nestjs/config';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { FileStorage } from './file-storage';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://storage.test/signed'),
}));

describe('absolute demo upload deadlines', () => {
  let storage: FileStorage;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-14T00:00:00Z'));
    storage = new FileStorage(
      new ConfigService({
        S3_BUCKET_NAME: 'demo',
        S3_API_ENDPOINT: 'https://storage.test',
        S3_ACCESS_KEY_ID: 'test',
        S3_SECRET_ACCESS_KEY: 'test',
      }),
    );
    jest.mocked(getSignedUrl).mockClear();
  });
  afterEach(() => {
    storage.onModuleDestroy();
    jest.useRealTimers();
  });
  it('signs within the persisted deadline even after a reservation lock wait', async () => {
    const expiresAt = new Date(Date.now() + 2000);
    jest.advanceTimersByTime(1500);
    const result = await storage.getUploadUrl({
      key: 'user/a/cv.pdf',
      contentLength: 10,
      contentType: 'application/pdf',
      expiresInSeconds: 300,
      expiresAt,
    });
    // Less than one full signed second remains: never issue an untracked URL.
    expect(result.isErr()).toBe(true);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
  it('returns a conservative expiry at or before the tracked absolute deadline', async () => {
    const expiresAt = new Date(Date.now() + 60000);
    jest.advanceTimersByTime(30000);
    const result = (
      await storage.getUploadUrl({
        key: 'user/a/cv.pdf',
        contentLength: 10,
        contentType: 'application/pdf',
        expiresInSeconds: 300,
        expiresAt,
      })
    )._unsafeUnwrap();
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expiresAt.getTime());
    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { expiresIn: 30, signingDate: new Date('2026-10-14T00:00:30Z') },
    );
  });
});
