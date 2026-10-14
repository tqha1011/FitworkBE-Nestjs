import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { demoCandidates } from '../../src/modules/demo/domain/demo-fixtures';

async function main() {
  if (process.env.DEMO_ENABLED !== 'true')
    throw new Error('Set DEMO_ENABLED=true in the dedicated demo environment');
  const required = (key: string) => {
    const value = process.env[key]?.trim();
    if (!value) throw new Error(`Missing ${key}`);
    return value;
  };
  const bucket = required('S3_BUCKET_NAME');
  if (required('DEMO_ASSET_BUCKET_CONFIRM') !== bucket)
    throw new Error(
      'DEMO_ASSET_BUCKET_CONFIRM must match the dedicated demo bucket',
    );
  const client = new S3Client({
    region: 'auto',
    forcePathStyle: true,
    endpoint: required('S3_API_ENDPOINT'),
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
  });
  try {
    for (const candidate of demoCandidates) {
      const key = `demo/samples/v1/${candidate.key}.pdf`;
      const body = await readFile(`assets/demo/cv/${candidate.key}.pdf`);
      let exists = false;
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        exists = true;
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode !== 404
        )
          throw new Error('Demo bucket is unavailable');
      }
      if (exists) {
        const object = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        const existing = Buffer.from(await object.Body!.transformToByteArray());
        if (
          createHash('sha256').update(existing).digest('hex') !==
          createHash('sha256').update(body).digest('hex')
        )
          throw new Error(
            `Sample asset mismatch: ${key}; use a new version prefix instead of overwriting`,
          );
      } else {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: 'application/pdf',
            ContentLength: body.length,
            IfNoneMatch: '*',
          }),
        );
      }
      process.stdout.write(`Ready: ${key}\n`);
    }
  } finally {
    client.destroy();
  }
}
void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Asset preparation failed'}\n`,
  );
  process.exitCode = 1;
});
