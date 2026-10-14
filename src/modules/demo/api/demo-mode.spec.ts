import { ConfigService } from '@nestjs/config';
import { DemoAccessService } from '../application/demo-access.service';
import { IDemoRepository } from '../domain/demo.repo.interface';
import { DemoOrdinaryAuthGuard } from './demo.controller';
import { CommonUserRole } from 'src/shared/domain/enum';
import { JwtPayload } from 'src/shared/common/jwt.payload.interface';

describe('demo deployment kill switch', () => {
  const payload: JwtPayload = {
    sub: '7c859056-1579-4dd3-ae6a-14d67a5e6f70',
    email: 'test@example.invalid',
    role: CommonUserRole.ROLE_APPLICANT,
  };
  it('keeps a dedicated demo deployment closed to ordinary auth when demo creation is off', async () => {
    const access = new DemoAccessService(
      {} as IDemoRepository,
      new ConfigService({ DEMO_ENABLED: 'false', DEMO_ONLY: 'true' }),
    );
    expect(() => new DemoOrdinaryAuthGuard(access).canActivate()).toThrow();
    await expect(access.authorize(payload)).rejects.toThrow(
      'Only demo sessions are allowed',
    );
  });
  it('preserves ordinary authentication in the normal application', async () => {
    const access = new DemoAccessService(
      {} as IDemoRepository,
      new ConfigService({ DEMO_ENABLED: 'false', DEMO_ONLY: 'false' }),
    );
    expect(new DemoOrdinaryAuthGuard(access).canActivate()).toBe(true);
    await expect(access.authorize(payload)).resolves.toBeUndefined();
  });
});
