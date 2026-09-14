import { Result } from 'neverthrow';

export abstract class IResumeRepository {
  abstract resolvePublicIdToId(
    publicId: string,
  ): Promise<Result<number | null, Error>>;
}
