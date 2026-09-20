import { CommonJobApplicantStatus } from 'src/shared/domain/enum';

const allowedTransitions: Record<
  CommonJobApplicantStatus,
  readonly CommonJobApplicantStatus[]
> = {
  [CommonJobApplicantStatus.PENDING]: [
    CommonJobApplicantStatus.ACCEPTED,
    CommonJobApplicantStatus.REJECTED,
  ],
  [CommonJobApplicantStatus.ACCEPTED]: [CommonJobApplicantStatus.COMPLETED],
  [CommonJobApplicantStatus.REJECTED]: [],
  [CommonJobApplicantStatus.COMPLETED]: [],
};

export function canTransitionJobApplicantStatus(
  currentStatus: CommonJobApplicantStatus,
  nextStatus: CommonJobApplicantStatus,
): boolean {
  return allowedTransitions[currentStatus].includes(nextStatus);
}
