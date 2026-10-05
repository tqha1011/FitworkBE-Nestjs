import { errorDiagnostics, redactDiagnosticText } from './error-diagnostics';

describe('diagnostic redaction', () => {
  it.each([
    ['accessToken=private refreshToken=private apiKey=private', 'private'],
    ['Authorization: Bearer private', 'private'],
    ['Cookie: session=private; auth=private', 'private'],
    ['{"cookie":"session=private; auth=private"}', 'private'],
    ['{"authorization":"Basic dXNlcjpwYXNz"}', 'dXNlcjpwYXNz'],
    ['{"password":"private"}', 'private'],
    ['phone=+84 912 345 678', '912'],
    ['https://user:private@host/path?token=private', 'private'],
  ])('redacts credentials and identifiers in %s', (input, secret) => {
    expect(redactDiagnosticText(input)).not.toContain(secret);
  });

  it('keeps useful diagnostics containing ordinary words resembling SQL', () => {
    expect(
      errorDiagnostics(new Error('Failed with ECONNREFUSED')).error_message,
    ).toBe('Failed with ECONNREFUSED');
  });

  it('caps the cause chain even when more than four distinct errors exist', () => {
    let failure = new Error('root');
    for (let i = 0; i < 10; i++)
      failure = new Error(`wrapper ${i}`, { cause: failure });
    expect(JSON.parse(errorDiagnostics(failure).error_causes)).toHaveLength(4);
  });

  it('omits Prisma validation query dumps and unsafe schema metadata', () => {
    const failure = Object.assign(
      new Error('Invalid invocation:\nresume: private CV\nSELECT private'),
      {
        name: 'PrismaClientValidationError',
        meta: { modelName: 'Job', column: 'private CV' },
      },
    );
    const output = errorDiagnostics(failure);
    expect(output.error_type).toBe('PrismaClientValidationError');
    expect(output.error_message).toContain('modelName=Job');
    expect(JSON.stringify(output)).not.toContain('private');
    expect(JSON.stringify(output)).not.toContain('SELECT');
  });
});
