import { UserType } from 'generated/prisma/enums';
import { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import { demoConfig } from './demo-policy';

export type DemoLimits = ReturnType<typeof demoConfig>;
export type DemoLoginState = {
  id: string;
  expiresAt: Date;
  generation: number;
  user: { id: number; publicId: string; email: string; role: string };
};
export type DemoSessionView = {
  id: string;
  expiresAt: Date;
  userType: UserType;
  generation: number;
  ai: {
    used: number;
    limit: number;
    remaining: number;
    available: boolean;
    unavailableReason: string | null;
  };
  uploads: {
    used: number;
    limit: number;
    remaining: number;
    maxFileBytes: number;
  };
  jobs: Array<{ publicId: string; title: string; isFeatured: boolean }>;
  resumes: Array<{
    publicId: string;
    fileName: string;
    isPrimaryApplicant: boolean;
  }>;
  applications: Array<{
    publicId: string;
    jobPublicId: string;
    resumePublicId: string;
    applicantName: string;
    isPrimaryApplicant: boolean;
    status: string;
    sampleEvaluationPublicId: string | null;
    latestEvaluationPublicId: string | null;
    evaluations: Array<{
      publicId: string;
      source: string;
      status: string;
      overallScore: number | null;
    }>;
  }>;
};

export abstract class IDemoRepository {
  abstract principal(publicId: string): Promise<JwtPayload | null>;
  abstract canReadResume(
    publicId: string,
    resumePublicId: string,
  ): Promise<boolean>;
  abstract validateUpload(
    publicId: string,
    key: string,
    bytes: number,
    limits: DemoLimits,
  ): Promise<void>;
  abstract create(
    ipHash: string,
    userType: UserType,
    tokenHash: string,
    passwordHashed: string,
    sampleSizes: number[],
    limits: DemoLimits,
  ): Promise<DemoLoginState>;
  abstract switchRole(
    payload: JwtPayload,
    userType: UserType,
    tokenHash: string,
  ): Promise<DemoLoginState>;
  abstract refresh(
    tokenHash: string,
    nextTokenHash: string,
  ): Promise<DemoLoginState>;
  abstract revoke(payload?: JwtPayload, tokenHash?: string): Promise<void>;
  abstract authorize(payload: JwtPayload): Promise<void>;
  abstract authorizeResources(
    payload: JwtPayload,
    ids: Record<string, unknown>,
  ): Promise<void>;
  abstract rateLimit(payload: JwtPayload, limit: number): Promise<void>;
  abstract reserveUpload(
    payload: JwtPayload,
    key: string,
    expiresAt: Date,
    fileSize: number,
    limits: DemoLimits,
  ): Promise<void>;
  abstract view(
    payload: JwtPayload,
    limits: DemoLimits,
  ): Promise<DemoSessionView>;
}

export abstract class IDemoCleanup {
  abstract run(): Promise<void>;
}
