import { CommonJobApplicantStatus } from 'src/shared/domain/enum';
import { canTransitionJobApplicantStatus } from './job-applicant-status-transition';

describe('canTransitionJobApplicantStatus', () => {
  it.each([
    [CommonJobApplicantStatus.PENDING, CommonJobApplicantStatus.ACCEPTED],
    [CommonJobApplicantStatus.PENDING, CommonJobApplicantStatus.REJECTED],
    [CommonJobApplicantStatus.ACCEPTED, CommonJobApplicantStatus.COMPLETED],
  ])('allows %s to %s', (currentStatus, nextStatus) => {
    expect(canTransitionJobApplicantStatus(currentStatus, nextStatus)).toBe(
      true,
    );
  });

  it.each([
    [CommonJobApplicantStatus.PENDING, CommonJobApplicantStatus.COMPLETED],
    [CommonJobApplicantStatus.ACCEPTED, CommonJobApplicantStatus.PENDING],
    [CommonJobApplicantStatus.ACCEPTED, CommonJobApplicantStatus.REJECTED],
    [CommonJobApplicantStatus.REJECTED, CommonJobApplicantStatus.ACCEPTED],
    [CommonJobApplicantStatus.REJECTED, CommonJobApplicantStatus.COMPLETED],
    [CommonJobApplicantStatus.COMPLETED, CommonJobApplicantStatus.REJECTED],
  ])('rejects %s to %s', (currentStatus, nextStatus) => {
    expect(canTransitionJobApplicantStatus(currentStatus, nextStatus)).toBe(
      false,
    );
  });
});
