import { Result } from 'neverthrow';

export type ArrangementData = {
  id: number;
  name: string;
};

export abstract class IArrangementRepository {
  abstract getAllArrangements(): Promise<Result<ArrangementData[], Error>>;
  abstract arrangementExists(
    arrangementId: number,
  ): Promise<Result<boolean, Error>>;
}
